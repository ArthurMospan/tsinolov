import { callMCPTool } from './mcp-direct';
import { parseMcpContent, type StoreContext } from './store-context';

export type AvailabilityBasis = 'current_slot' | 'next_day_reference' | 'unverified';

export interface MonitoringFavoritesResult {
    products: any[];
    availabilityReliable: boolean;
    availabilityBasis: AvailabilityBasis;
    checkedFor: string;
}

function favoritesFromResponse(response: any): any[] {
    for (const value of parseMcpContent(response)) {
        if (Array.isArray(value)) return value;
        if (Array.isArray(value?.items)) return value.items;
        if (Array.isArray(value?.products)) return value.products;
        if (Array.isArray(value?.favorites)) return value.favorites;
    }
    return [];
}

export function productAvailability(product: any): boolean | null {
    for (const field of ['out_of_stock', 'outOfStock', 'is_out_of_stock', 'isOutOfStock']) {
        if (product?.[field] === true || product?.[field] === 1 || product?.[field] === '1' || product?.[field] === 'true') return false;
    }
    for (const field of ['in_stock', 'inStock', 'is_in_stock', 'isInStock']) {
        if (product?.[field] !== undefined) return product[field] === true || product[field] === 1 || product[field] === '1' || product[field] === 'true';
    }
    if (product?.stock !== undefined && product?.stock !== null && product?.stock !== '') {
        if (typeof product.stock === 'string') {
            const normalized = product.stock.trim().toLowerCase();
            if (['out_of_stock', 'out-of-stock', 'unavailable', 'sold_out', 'sold-out', 'none', 'false'].includes(normalized)) return false;
            if (['in_stock', 'in-stock', 'available', 'true'].includes(normalized)) return true;
        }
        const numeric = Number(product.stock);
        if (Number.isFinite(numeric)) return numeric > 0;
    }
    for (const field of ['stockQuantity', 'stock_quantity', 'availableQuantity', 'available_quantity']) {
        if (product?.[field] !== undefined && product?.[field] !== null && product?.[field] !== '') {
            const numeric = Number(product[field]);
            if (Number.isFinite(numeric)) return numeric > 0;
        }
    }
    for (const field of ['available', 'isAvailable', 'is_available']) {
        if (product?.[field] !== undefined) return product[field] === true || product[field] === 1 || product[field] === '1' || product[field] === 'true';
    }
    return null;
}

export function allProductsUnexpectedlyUnavailable(products: any[]): boolean {
    return products.length >= 2 && products.every(product => productAvailability(product) === false);
}

export function nextDaytimeReference(now = new Date()): { start: Date; end: Date } {
    const start = new Date(now);
    start.setUTCHours(9, 0, 0, 0);
    if (start.getTime() <= now.getTime() + 30 * 60 * 1000) start.setUTCDate(start.getUTCDate() + 1);
    return { start, end: new Date(start.getTime() + 2 * 60 * 60 * 1000) };
}

async function fetchFavorites(token: string, context: Pick<StoreContext, 'branchId' | 'deliveryType'>, start: Date, end: Date) {
    return favoritesFromResponse(await callMCPTool(token, 'silpo_get_my_favorites', {
        branchId: context.branchId,
        deliveryType: context.deliveryType,
        timeslotStart: start.toISOString(),
        timeslotEnd: end.toISOString(),
        limit: 500,
        offset: 0,
    }));
}

export async function getMonitoringFavorites(
    token: string,
    context: Pick<StoreContext, 'branchId' | 'deliveryType'>,
    now = new Date()
): Promise<MonitoringFavoritesResult> {
    const currentEnd = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const current = await fetchFavorites(token, context, now, currentEnd);
    if (!allProductsUnexpectedlyUnavailable(current)) {
        return { products: current, availabilityReliable: true, availabilityBasis: 'current_slot', checkedFor: now.toISOString() };
    }

    const reference = nextDaytimeReference(now);
    try {
        const daytime = await fetchFavorites(token, context, reference.start, reference.end);
        if (!allProductsUnexpectedlyUnavailable(daytime)) {
            return {
                products: daytime,
                availabilityReliable: true,
                availabilityBasis: 'next_day_reference',
                checkedFor: reference.start.toISOString(),
            };
        }
    } catch (error) {
        console.warn('[MCP] Daytime availability fallback failed:', error);
    }

    return { products: current, availabilityReliable: false, availabilityBasis: 'unverified', checkedFor: now.toISOString() };
}
