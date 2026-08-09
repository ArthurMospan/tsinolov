export type ProductLike = Record<string, any>;

export interface RankedAlternative {
    product: ProductLike;
    productId: string;
    slug: string;
    name: string;
    price: number;
    currentComparisonPrice: number;
    comparisonPrice: number;
    comparisonLabel?: string;
    score: number;
    savings: number;
}

type Measurement = { quantity: number; kind: 'weight' | 'volume' | 'count'; label: string };

const GENERIC_NAME_WORDS = new Set([
    'і', 'й', 'з', 'із', 'зі', 'для', 'та', 'the', 'a', 'an',
    'шт', 'кг', 'г', 'л', 'мл', 'pc', 'pcs', 'kg', 'g', 'l', 'ml'
]);

const DESCRIPTOR_GROUPS = [
    ['світле', 'темне'],
    ['фільтроване', 'нефільтроване'],
    ['алкогольне', 'безалкогольне'],
    ['сухе', 'напівсухе', 'напівсолодке', 'солодке'],
    ['газоване', 'негазоване'],
    ['класичний', 'blanc', 'бланк', 'white', 'dark'],
];

function firstValue(product: ProductLike, keys: string[]): any {
    for (const key of keys) {
        if (product?.[key] !== undefined && product?.[key] !== null) return product[key];
    }
    return undefined;
}

function normalize(value: unknown): string {
    return String(value ?? '')
        .toLocaleLowerCase('uk-UA')
        .replace(/[’'`]/g, '')
        .replace(/[^\p{L}\p{N}%]+/gu, ' ')
        .trim();
}

function words(value: unknown): Set<string> {
    return new Set(normalize(value).split(/\s+/).filter(word => word.length > 1 && !GENERIC_NAME_WORDS.has(word)));
}

function jaccard(left: Set<string>, right: Set<string>): number {
    if (!left.size || !right.size) return 0;
    let intersection = 0;
    for (const value of left) if (right.has(value)) intersection++;
    return intersection / (left.size + right.size - intersection);
}

function productId(product: ProductLike): string {
    return String(firstValue(product, ['id', 'product_id', 'productId', 'externalProductId']) ?? '');
}

function productSlug(product: ProductLike): string {
    return String(firstValue(product, ['slug', 'productSlug']) ?? '');
}

function productName(product: ProductLike): string {
    return String(firstValue(product, ['name', 'title', 'productName']) ?? '');
}

function productPrice(product: ProductLike): number {
    return Number(firstValue(product, ['price', 'current_price', 'currentPrice', 'salePrice', 'sellingPrice']) ?? 0);
}

function attribute(product: ProductLike, names: string[]): string {
    const attributes = product?.attributes;
    if (!attributes || typeof attributes !== 'object') return '';
    const normalizedNames = new Set(names.map(normalize));
    for (const [key, value] of Object.entries(attributes)) {
        if (normalizedNames.has(normalize(key))) return normalize(value);
    }
    return '';
}

function brandOf(product: ProductLike): string {
    return normalize(firstValue(product, ['brand', 'brandName', 'trademark'])
        || attribute(product, ['Торгова марка', 'Бренд', 'Виробник']));
}

function sizeOf(product: ProductLike): string {
    return normalize(firstValue(product, ['displayWeight', 'display_weight', 'size', 'volume'])
        || attribute(product, ["Розмір/об'єм", 'Розмір/об’єм', 'Вага', 'Об’єм']));
}

function packagingOf(product: ProductLike): string {
    return normalize(firstValue(product, ['packaging', 'packageType'])
        || attribute(product, ['Тип упаковки', 'Упаковка']));
}

function alcoholOf(product: ProductLike): number | null {
    const raw = firstValue(product, ['alcohol', 'alcoholPercent']) || attribute(product, ['% спирту', 'Міцність']);
    const value = Number(String(raw || '').replace(',', '.').replace(/[^d.]/g, ''));
    return Number.isFinite(value) && value > 0 ? value : null;
}

function categoryPrefix(product: ProductLike): string {
    return productSlug(product).split('-')[0] || '';
}

function measurementOf(product: ProductLike): Measurement | null {
    const raw = firstValue(product, ['displayWeight', 'display_weight', 'weightText', 'unitName']);
    if (raw === undefined || raw === null) return null;
    const value = String(raw).trim().toLowerCase().replace(',', '.');
    const match = value.match(/(\d+(?:\.\d+)?)\s*(кг|kg|г|gr|g|л|l|мл|ml|шт|pcs?|pc)(?=$|\s|\)|\/)/i);
    if (!match) return null;
    const quantity = Number(match[1]);
    if (!Number.isFinite(quantity) || quantity <= 0) return null;
    const unit = match[2].toLowerCase();
    if (['кг', 'kg'].includes(unit)) return { quantity, kind: 'weight', label: 'кг' };
    if (['г', 'gr', 'g'].includes(unit)) return { quantity: quantity / 1000, kind: 'weight', label: 'кг' };
    if (['л', 'l'].includes(unit)) return { quantity, kind: 'volume', label: 'л' };
    if (['мл', 'ml'].includes(unit)) return { quantity: quantity / 1000, kind: 'volume', label: 'л' };
    return { quantity, kind: 'count', label: 'шт' };
}

function hasDescriptorConflict(currentName: string, candidateName: string): boolean {
    const currentWords = words(currentName);
    const candidateWords = words(candidateName);
    return DESCRIPTOR_GROUPS.some(group => {
        const current = group.filter(word => currentWords.has(word));
        const candidate = group.filter(word => candidateWords.has(word));
        return current.length > 0 && candidate.length > 0 && !current.some(word => candidate.includes(word));
    });
}

function semanticScore(current: ProductLike, candidate: ProductLike): number | null {
    const currentName = productName(current);
    const candidateName = productName(candidate);
    const currentBrand = brandOf(current);
    const candidateBrand = brandOf(candidate);
    const currentSize = sizeOf(current);
    const candidateSize = sizeOf(candidate);
    const currentPackaging = packagingOf(current);
    const candidatePackaging = packagingOf(candidate);
    const currentCategory = categoryPrefix(current);
    const candidateCategory = categoryPrefix(candidate);

    if (currentCategory && candidateCategory && currentCategory !== candidateCategory) return null;
    if (hasDescriptorConflict(currentName, candidateName)) return null;
    if (currentSize && candidateSize && currentSize !== candidateSize) return null;

    const currentAlcohol = alcoholOf(current);
    const candidateAlcohol = alcoholOf(candidate);
    if (currentAlcohol && candidateAlcohol && Math.abs(currentAlcohol - candidateAlcohol) > 0.6) return null;

    const lexicalSimilarity = jaccard(words(currentName), words(candidateName));
    let score = lexicalSimilarity * 30;

    if (currentBrand || candidateBrand) {
        if (!currentBrand || !candidateBrand || currentBrand !== candidateBrand) return null;
        score += 100;
    } else if (lexicalSimilarity < 0.6) {
        return null;
    }

    if (currentSize && candidateSize) score += 25;
    else if (!currentSize && !candidateSize && lexicalSimilarity < 0.75) return null;
    else return null;

    if (currentPackaging && candidatePackaging && currentPackaging === candidatePackaging) score += 5;
    return score;
}

export function rankProductAlternatives(current: ProductLike, candidates: ProductLike[]): RankedAlternative[] {
    const currentId = productId(current);
    const currentSlug = productSlug(current);
    const currentPrice = productPrice(current);
    const currentMeasurement = measurementOf(current);
    if (!currentId || !currentSlug || currentPrice <= 0) return [];

    return candidates.flatMap(candidate => {
        const id = productId(candidate);
        const slug = productSlug(candidate);
        const price = productPrice(candidate);
        if (!id || !slug || id === currentId || slug === currentSlug || price <= 0) return [];
        if (price >= currentPrice * 0.95) return [];

        const score = semanticScore(current, candidate);
        if (score === null) return [];

        const candidateMeasurement = measurementOf(candidate);
        let currentComparison = currentPrice;
        let comparisonPrice = price;
        let comparisonLabel: string | undefined;
        if (currentMeasurement || candidateMeasurement) {
            if (!currentMeasurement || !candidateMeasurement || currentMeasurement.kind !== candidateMeasurement.kind) return [];
            currentComparison = currentPrice / currentMeasurement.quantity;
            comparisonPrice = price / candidateMeasurement.quantity;
            comparisonLabel = candidateMeasurement.label;
        }

        const savings = currentComparison - comparisonPrice;
        const savingsRatio = savings / currentComparison;
        if (savings < 2 || savingsRatio < 0.05) return [];

        return [{
            product: candidate,
            productId: id,
            slug,
            name: productName(candidate) || id,
            price,
            currentComparisonPrice: currentComparison,
            comparisonPrice,
            comparisonLabel,
            score: score + Math.min(savingsRatio * 20, 10),
            savings: currentPrice - price,
        }];
    }).sort((left, right) => right.score - left.score || left.comparisonPrice - right.comparisonPrice);
}
