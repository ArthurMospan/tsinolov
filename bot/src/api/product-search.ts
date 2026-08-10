import { callMCPTool } from './mcp-direct';
import { allProductsUnexpectedlyUnavailable, nextDaytimeReference } from './monitoring-favorites';
import { parseMcpContent, type StoreContext } from './store-context';

export interface ProductSearchResult {
    products: any[];
    availabilityReliable: boolean;
    availabilityBasis: 'current_slot' | 'next_day_reference' | 'unverified';
    checkedFor: string;
}

function productArrays(value: any): any[][] {
    if (Array.isArray(value)) return [value];
    if (!value || typeof value !== 'object') return [];

    const direct = ['products', 'items', 'results']
        .map(key => value[key])
        .filter(Array.isArray) as any[][];
    const queries = Array.isArray(value.queries)
        ? value.queries.flatMap((query: any) => productArrays(query))
        : [];
    const nested = ['data', 'result', 'catalog', 'page', 'payload', 'response']
        .flatMap(key => productArrays(value[key]));
    return [...direct, ...queries, ...nested];
}

export function productsFromSearchResponse(response: any): any[] {
    const products = parseMcpContent(response).flatMap(root => productArrays(root)).flat();
    const seen = new Set<string>();
    return products.filter(product => {
        const identity = productIdentity(product);
        if (!identity || seen.has(identity)) return false;
        seen.add(identity);
        return true;
    });
}

export function productIdentity(product: any): string {
    const id = String(product?.id ?? product?.product_id ?? product?.productId ?? '').trim();
    if (id) return `id:${id}`;
    const external = Number(product?.externalProductId ?? product?.external_product_id);
    return Number.isSafeInteger(external) ? `external:${external}` : '';
}

export function isFavoriteProduct(product: any, favorites: any[]): boolean {
    const id = String(product?.id ?? product?.product_id ?? product?.productId ?? '').trim();
    const external = Number(product?.externalProductId ?? product?.external_product_id);
    return favorites.some(favorite => {
        const favoriteId = String(favorite?.id ?? favorite?.product_id ?? favorite?.productId ?? '').trim();
        const favoriteExternal = Number(favorite?.externalProductId ?? favorite?.external_product_id);
        return Boolean(id && favoriteId && id === favoriteId)
            || (Number.isSafeInteger(external) && Number.isSafeInteger(favoriteExternal) && external === favoriteExternal);
    });
}

async function callSearch(
    token: string,
    context: Pick<StoreContext, 'branchId' | 'deliveryType'>,
    query: string,
    limit: number,
    start: Date,
    end: Date
): Promise<any[]> {
    const response = await callMCPTool(token, 'silpo_find_products_batch', {
        branchId: context.branchId,
        deliveryType: context.deliveryType,
        timeslotStart: start.toISOString(),
        timeslotEnd: end.toISOString(),
        products: [query],
        limit,
    });
    return productsFromSearchResponse(response);
}

export async function searchSilpoProducts(
    token: string,
    context: Pick<StoreContext, 'branchId' | 'deliveryType'>,
    query: string,
    limit = 24,
    now = new Date()
): Promise<ProductSearchResult> {
    const currentEnd = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const current = await callSearch(token, context, query, limit, now, currentEnd);
    const shouldRetryAtDaytime = current.length === 0 || allProductsUnexpectedlyUnavailable(current);
    if (!shouldRetryAtDaytime) {
        return { products: current, availabilityReliable: true, availabilityBasis: 'current_slot', checkedFor: now.toISOString() };
    }

    const reference = nextDaytimeReference(now);
    try {
        const daytime = await callSearch(token, context, query, limit, reference.start, reference.end);
        if (daytime.length > 0 && !allProductsUnexpectedlyUnavailable(daytime)) {
            return {
                products: daytime,
                availabilityReliable: true,
                availabilityBasis: 'next_day_reference',
                checkedFor: reference.start.toISOString(),
            };
        }
    } catch (error) {
        console.warn('[MCP] Daytime product search fallback failed:', error);
    }

    return { products: current, availabilityReliable: false, availabilityBasis: 'unverified', checkedFor: now.toISOString() };
}
