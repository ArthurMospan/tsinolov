import { callMCPTool } from './mcp-direct';
import { parseMcpContent, type StoreContext } from './store-context';

const detailsCache = new Map<string, { expiresAt: number; product: any }>();
const DETAILS_TTL = 30 * 60 * 1000;

function firstValue(value: any, keys: string[]): any {
    for (const key of keys) {
        if (value?.[key] !== undefined && value?.[key] !== null) return value[key];
    }
    return undefined;
}

function productSlug(product: any): string {
    return String(firstValue(product, ['slug', 'productSlug', 'product_slug']) || '').trim();
}

function looksLikeProduct(value: any): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const hasIdentity = firstValue(value, ['id', 'productId', 'product_id', 'slug', 'externalProductId']) !== undefined;
    const hasProductData = firstValue(value, [
        'name', 'title', 'price', 'currentPrice', 'displayWeight', 'display_weight',
        'weightText', 'unit', 'unitOfMeasure', 'measurementUnit'
    ]) !== undefined;
    return hasIdentity && hasProductData;
}

function findProduct(value: any, visited = new Set<any>()): any | null {
    if (!value || typeof value !== 'object' || visited.has(value)) return null;
    visited.add(value);
    if (looksLikeProduct(value)) return value;
    if (Array.isArray(value)) {
        for (const item of value) {
            const product = findProduct(item, visited);
            if (product) return product;
        }
        return null;
    }
    for (const key of ['product', 'item', 'data', 'result', 'details', 'response']) {
        const product = findProduct(value[key], visited);
        if (product) return product;
    }
    for (const nested of Object.values(value)) {
        const product = findProduct(nested, visited);
        if (product) return product;
    }
    return null;
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
    const details = parseMcpContent(response).map(value => findProduct(value)).find(Boolean) || null;
    if (details) detailsCache.set(cacheKey, { expiresAt: Date.now() + DETAILS_TTL, product: details });
    return details;
}

export async function enrichProductsWithDetails(
    token: string,
    context: Pick<StoreContext, 'branchId' | 'deliveryType'>,
    products: any[]
): Promise<any[]> {
    const enriched = [...products];
    let cursor = 0;
    const worker = async () => {
        while (cursor < products.length) {
            const index = cursor++;
            const original = products[index];
            try {
                const details = await getProductDetails(token, context, original);
                if (details) enriched[index] = { ...original, ...details };
            } catch (error) {
                console.warn(`[MCP] Product details unavailable for ${productSlug(original) || 'unknown product'}:`, error);
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(5, products.length) }, () => worker()));
    return enriched;
}
