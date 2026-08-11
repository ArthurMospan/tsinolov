type ProductPresentation = {
    displayWeight?: string;
    price_unit?: string;
};

function scalarText(value: unknown): string {
    if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
    if (!value || typeof value !== 'object') return '';
    const object = value as Record<string, unknown>;
    for (const key of ['shortName', 'short_name', 'abbreviation', 'symbol', 'name', 'label', 'title', 'text', 'value', 'code']) {
        if (typeof object[key] === 'string' || typeof object[key] === 'number') return String(object[key]).trim();
    }
    return '';
}

function nestedFieldValues(root: any, fieldNames: string[], maxDepth = 5): unknown[] {
    const names = new Set(fieldNames.map(name => name.toLowerCase()));
    const values: unknown[] = [];
    const visited = new Set<any>();
    const visit = (value: any, depth: number): void => {
        if (!value || typeof value !== 'object' || depth > maxDepth || visited.has(value)) return;
        visited.add(value);
        if (Array.isArray(value)) {
            value.forEach(item => visit(item, depth + 1));
            return;
        }
        for (const [key, nested] of Object.entries(value)) {
            if (names.has(key.toLowerCase()) && nested !== undefined && nested !== null) values.push(nested);
            if (nested && typeof nested === 'object') visit(nested, depth + 1);
        }
    };
    visit(root, 0);
    return values;
}

function normalizedUnit(value: unknown): string | undefined {
    const normalized = scalarText(value).toLowerCase().replace(/[.\s_-]+/g, '');
    if (/^(kg|kilogram|kilograms|кілограм|кілограмів|кг)$/.test(normalized)) return 'кг';
    if (/^(g|gr|gram|grams|грам|грамів|г)$/.test(normalized)) return 'г';
    if (/^(l|liter|litre|liters|litres|літр|літрів|л)$/.test(normalized)) return 'л';
    if (/^(ml|milliliter|millilitre|milliliters|millilitres|мілілітр|мілілітрів|мл)$/.test(normalized)) return 'мл';
    if (/^(pcs|pc|piece|pieces|item|unit|од|одиниця|штука|штук|шт)$/.test(normalized)) return 'шт';
    return undefined;
}

function measurementFromText(value: unknown): string | undefined {
    const text = scalarText(value);
    if (!text) return undefined;
    const pack = text.match(/(\d+)\s*[xх×*]\s*(\d+(?:[.,]\d+)?)\s*(кг|kg|г|gr|g|л|l|мл|ml)(?=$|[\s+),;/])/i);
    if (pack) {
        const unit = normalizedUnit(pack[3]);
        if (unit) return `${pack[1]} × ${pack[2].replace('.', ',')} ${unit}`;
    }
    const single = text.match(/(?:^|\s)(\d+(?:[.,]\d+)?)\s*(кг|kg|г|gr|g|л|l|мл|ml|шт|pcs?)(?=$|[\s+),;/])/i);
    if (single) {
        const unit = normalizedUnit(single[2]);
        if (unit) return `${single[1].replace('.', ',')} ${unit}`;
    }
    return undefined;
}

export function productPriceUnit(product: any): string | undefined {
    const displayRatio = measurementFromText(product?.displayRatio ?? product?.display_ratio);
    if (displayRatio) return displayRatio;
    const ratio = product?.ratio ?? product?.priceRatio ?? product?.price_ratio
        ?? product?.priceUnit ?? product?.price_unit ?? product?.sellingUnit ?? product?.selling_unit;
    const unit = normalizedUnit(ratio);
    if (unit) return unit;
    return undefined;
}

export function productDisplayMeasurement(product: any): string | undefined {
    const ratio = normalizedUnit(product?.ratio ?? product?.priceRatio ?? product?.price_ratio);
    const title = product?.title ?? product?.name ?? product?.productName;
    const titlePack = scalarText(title).match(/(\d+)\s*[xх×*]\s*(\d+(?:[.,]\d+)?)\s*(кг|kg|г|gr|g|л|l|мл|ml)(?=$|[\s+),;/])/i);
    if (titlePack) {
        const unit = normalizedUnit(titlePack[3]);
        if (unit) return `${titlePack[1]} × ${titlePack[2].replace('.', ',')} ${unit}`;
    }

    const titleMeasurement = measurementFromText(title);
    if (titleMeasurement) return titleMeasurement;

    // For goods sold by weight or volume, displayRatio is Silpo's actual
    // customer-facing quantity. It must win over generic metadata such as
    // weightText: "1 кг".
    const displayRatio = measurementFromText(product?.displayRatio ?? product?.display_ratio);
    if ((ratio === 'кг' || ratio === 'л') && displayRatio) return displayRatio;

    const packageMeasurement = nestedFieldValues(product, [
        'packageSize', 'package_size', 'packSize', 'pack_size', 'netWeightText', 'net_weight_text',
        'volumeText', 'volume_text', 'weightText', 'weight_text',
    ]).map(measurementFromText).find(Boolean);
    if (packageMeasurement) return packageMeasurement;

    const attributes = nestedFieldValues(product, ['attributes', 'characteristics', 'properties'])
        .flatMap(value => Array.isArray(value) ? value : [value]);
    for (const attribute of attributes as any[]) {
        const label = scalarText(attribute?.name ?? attribute?.label ?? attribute?.title).toLowerCase();
        if (!/вага|маса|об.?єм|фасов|кількість|одиниц|weight|volume|unit|pack/.test(label)) continue;
        const measurement = measurementFromText(attribute?.value ?? attribute?.text ?? attribute?.displayValue ?? attribute?.display_value);
        if (measurement) return measurement;
    }

    // Piece products can also carry a useful display ratio, but package/title
    // metadata above is more precise than a generic "1 шт".
    if (displayRatio) return displayRatio;

    const direct = nestedFieldValues(product, ['displayWeight', 'display_weight'])
        .map(measurementFromText)
        .find(Boolean);
    if (direct) return direct;

    if (ratio) return `1 ${ratio}`;
    const unit = normalizedUnit(product?.unitOfMeasure ?? product?.unit_of_measure ?? product?.measurementUnit
        ?? product?.measurement_unit ?? product?.unitName ?? product?.unit_name ?? product?.unit);
    if (!unit) return undefined;
    const amount = Number(product?.netWeight ?? product?.net_weight ?? product?.packageWeight
        ?? product?.package_weight ?? product?.weight ?? product?.volume);
    return Number.isFinite(amount) && amount > 0
        ? `${Number(amount.toFixed(3)).toLocaleString('uk-UA')} ${unit}`
        : `1 ${unit}`;
}

export function productPresentation(product: any): ProductPresentation {
    const displayWeight = productDisplayMeasurement(product);
    const priceUnit = productPriceUnit(product);
    return {
        ...(displayWeight ? { displayWeight } : {}),
        ...(priceUnit ? { price_unit: priceUnit } : {}),
    };
}
