import { callMCPTool } from './mcp-direct';
import { productAvailability } from './monitoring-favorites';
import { productsFromSearchResponse } from './product-search';
import { getSilpoProductSnapshot } from './silpo-public-catalog';
import { parseMcpContent, type StoreContext } from './store-context';

const detailsCache = new Map<string, { expiresAt: number; product: any }>();
// Details also carry volatile availability markers such as "expected".
// Keep the packaging cache useful without showing a store status for 30 minutes.
const DETAILS_TTL = 5 * 60 * 1000;

function firstValue(value: any, keys: string[]): any {
    for (const key of keys) {
        if (value?.[key] !== undefined && value?.[key] !== null) return value[key];
    }
    return undefined;
}

function productSlug(product: any): string {
    const direct = String(firstValue(product, ['slug', 'productSlug', 'product_slug']) || '').trim();
    if (direct) return direct;
    const url = String(firstValue(product, ['url', 'productUrl', 'product_url', 'webUrl', 'web_url']) || '').trim();
    return url.match(/\/product\/([^/?#]+)/i)?.[1] || '';
}

function productExternalId(product: any): number | null {
    const value = Number(firstValue(product, ['externalProductId', 'external_product_id']));
    return Number.isSafeInteger(value) ? value : null;
}

function productId(product: any): string {
    return String(firstValue(product, ['id', 'productId', 'product_id']) || '').trim();
}

function productTitle(product: any): string {
    return String(firstValue(product, ['title', 'name', 'productName', 'product_name']) || '').trim();
}

function needsProductSnapshot(product: any): boolean {
    const hasDisplayQuantity = firstValue(product, [
        // displayWeight/weightText from favorites are often the misleading
        // generic "1 кг" / "1 шт" values we are replacing.
        'displayRatio', 'display_ratio', 'packageSize', 'package_size',
        'packSize', 'pack_size', 'netWeightText', 'net_weight_text',
        'volumeText', 'volume_text',
    ]) !== undefined;
    const hasStock = firstValue(product, [
        'stock', 'stockQuantity', 'stock_quantity', 'availableQuantity', 'available_quantity',
        'inStock', 'in_stock', 'isAvailable', 'is_available',
    ]) !== undefined;
    return !hasDisplayQuantity || !hasStock;
}

export function mergeProductData(summary: any, authoritativeData: any): any {
    const {
        storeAvailability: _ignoredStoreAvailability,
        store_availability: _ignoredSnakeStoreAvailability,
        ...availabilitySource
    } = authoritativeData || {};
    const authoritativeAvailability = productAvailability(availabilitySource);
    const summaryAvailability = productAvailability(summary);
    return {
        ...summary,
        ...authoritativeData,
        // A store/timeslot snapshot is authoritative when it contains an
        // availability signal. The favorites summary is fallback-only.
        storeAvailability: authoritativeAvailability ?? summaryAvailability,
    };
}

export function matchingCatalogProduct(product: any, candidates: any[]): any | null {
    const expectedExternalId = productExternalId(product);
    const expectedId = productId(product);
    const expectedSlug = productSlug(product);
    const expectedTitle = productTitle(product).toLocaleLowerCase('uk-UA');
    return candidates.find(candidate => {
        const candidateExternalId = productExternalId(candidate);
        if (expectedExternalId !== null && candidateExternalId !== null) {
            return candidateExternalId === expectedExternalId;
        }
        const candidateId = productId(candidate);
        if (expectedId && candidateId) return candidateId === expectedId;
        const candidateSlug = productSlug(candidate);
        if (expectedSlug && candidateSlug) return candidateSlug === expectedSlug;
        return Boolean(expectedTitle && productTitle(candidate).toLocaleLowerCase('uk-UA') === expectedTitle);
    }) || null;
}

function looksLikeProduct(value: any): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const hasIdentity = firstValue(value, ['id', 'productId', 'product_id', 'slug', 'externalProductId']) !== undefined;
    const hasProductData = firstValue(value, [
        'name', 'title', 'price', 'currentPrice', 'displayWeight', 'display_weight',
        'displayRatio', 'display_ratio', 'weightText', 'unit', 'unitOfMeasure', 'measurementUnit'
    ]) !== undefined;
    return hasIdentity && hasProductData;
}

const CONTEXT_FIELDS = [
    'displayRatio', 'display_ratio', 'displayWeight', 'display_weight', 'weightText', 'weight_text',
    'netWeightText', 'net_weight_text', 'volumeText', 'volume_text', 'packageSize', 'package_size',
    'packSize', 'pack_size', 'attributes', 'characteristics', 'properties',
    'availabilityStatus', 'availability_status', 'stockStatus', 'stock_status', 'productStatus', 'product_status',
    'availabilityMessage', 'availability_message', 'stockMessage', 'stock_message',
    'availabilityLabel', 'availability_label', 'availabilityType', 'availability_type',
    'promotions', 'promos', 'badges', 'labels', 'modifier', 'modifiers', 'tags', 'chips', 'flags',
    'availabilityInfo', 'availability_info', 'expected', 'isExpected', 'is_expected', 'comingSoon', 'coming_soon',
] as const;

function withContext(product: any, ancestors: any[]): any {
    const context: Record<string, any> = {};
    for (const ancestor of ancestors) {
        if (!ancestor || typeof ancestor !== 'object' || Array.isArray(ancestor)) continue;
        for (const key of CONTEXT_FIELDS) {
            if (ancestor[key] !== undefined && ancestor[key] !== null) context[key] = ancestor[key];
        }
    }
    return { ...context, ...product };
}

function collectProducts(
    value: any,
    products: any[] = [],
    visited = new Set<any>(),
    ancestors: any[] = []
): any[] {
    if (!value || typeof value !== 'object' || visited.has(value)) return products;
    visited.add(value);
    if (looksLikeProduct(value)) products.push(withContext(value, ancestors));
    if (Array.isArray(value)) {
        value.forEach(item => collectProducts(item, products, visited, ancestors));
        return products;
    }
    Object.values(value).forEach(nested => collectProducts(nested, products, visited, [...ancestors, value]));
    return products;
}

function productScore(product: any, expectedSlug: string): number {
    const slug = productSlug(product);
    let score = slug === expectedSlug ? 100 : slug ? 5 : 0;
    if (firstValue(product, ['displayRatio', 'display_ratio', 'displayWeight', 'display_weight', 'weightText', 'unit', 'unitName', 'unitOfMeasure'])) score += 30;
    if (Array.isArray(product?.attributes) || Array.isArray(product?.characteristics)) score += 20;
    if (firstValue(product, ['stock', 'inStock', 'availabilityStatus', 'availableQuantity']) !== undefined) score += 15;
    if (firstValue(product, ['price', 'currentPrice', 'salePrice']) !== undefined) score += 5;
    return score;
}

export function productDetailsFromResponse(response: any, expectedSlug: string): any | null {
    return parseMcpContent(response)
        .flatMap(value => collectProducts(value))
        .sort((left, right) => productScore(right, expectedSlug) - productScore(left, expectedSlug))[0] || null;
}

async function getProductDetails(
    token: string,
    context: Pick<StoreContext, 'branchId' | 'deliveryType'>,
    product: any
): Promise<any | null> {
    const slug = productSlug(product);
    if (!slug) return null;
    const cacheKey = `${context.branchId}:${context.deliveryType}:${slug}`;
    const cached = detailsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.product;

    const start = new Date();
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const response = await callMCPTool(token, 'silpo_get_product_details', {
        branchId: context.branchId,
        slug,
        deliveryType: context.deliveryType,
        timeslotStart: start.toISOString(),
        timeslotEnd: end.toISOString(),
    });
    const details = productDetailsFromResponse(response, slug);
    if (details) detailsCache.set(cacheKey, { expiresAt: Date.now() + DETAILS_TTL, product: details });
    return details;
}

async function resolveCatalogProduct(
    token: string,
    context: Pick<StoreContext, 'branchId' | 'deliveryType'>,
    product: any
): Promise<any> {
    if (productSlug(product)) return product;
    const externalId = productExternalId(product);
    const title = productTitle(product);
    const queries = [...new Set([externalId === null ? '' : String(externalId), title].filter(Boolean))];
    if (!queries.length) return product;

    const start = new Date();
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const response = await callMCPTool(token, 'silpo_find_products_batch', {
        branchId: context.branchId,
        deliveryType: context.deliveryType,
        timeslotStart: start.toISOString(),
        timeslotEnd: end.toISOString(),
        products: queries,
        limit: 10,
    });
    const match = matchingCatalogProduct(product, productsFromSearchResponse(response));
    return match ? { ...product, ...match } : product;
}

export async function enrichProductsWithDetails(
    token: string,
    context: Pick<StoreContext, 'branchId' | 'deliveryType'>,
    products: any[],
    options: { authoritativeAvailability?: boolean } = {},
): Promise<any[]> {
    const enriched = [...products];
    let cursor = 0;
    const worker = async () => {
        while (cursor < products.length) {
            const index = cursor++;
            const original = products[index];
            try {
                let snapshot: any | null = null;
                if (options.authoritativeAvailability || needsProductSnapshot(original)) {
                    try {
                        snapshot = await getSilpoProductSnapshot(context, original);
                    } catch (error) {
                        console.warn(`[Silpo] Direct product snapshot unavailable for ${productSlug(original) || productExternalId(original) || 'unknown product'}:`, error);
                    }
                }

                if (snapshot) {
                    enriched[index] = mergeProductData(original, snapshot);
                    continue;
                }

                // Favorites can omit slug/displayRatio even though the catalogue
                // has them. Resolve the exact article first, then request details.
                const resolved = await resolveCatalogProduct(token, context, original);
                let details: any | null = null;
                try {
                    details = await getProductDetails(token, context, resolved);
                } catch (error) {
                    // The catalogue match already restores displayRatio/stock,
                    // so a failing optional details call must not discard it.
                    console.warn(`[MCP] Full product details unavailable for ${productSlug(resolved) || productExternalId(resolved) || 'unknown product'}:`, error);
                }
                if (resolved !== original || details) {
                    enriched[index] = mergeProductData(original, { ...resolved, ...details });
                }
            } catch (error) {
                console.warn(`[MCP] Product catalogue resolution unavailable for ${productSlug(original) || productExternalId(original) || 'unknown product'}:`, error);
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(5, products.length) }, () => worker()));
    return enriched;
}
