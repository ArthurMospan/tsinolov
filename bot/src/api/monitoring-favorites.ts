import { callMCPTool } from './mcp-direct';
import { parseMcpContent, type StoreContext } from './store-context';

export type AvailabilityBasis = 'current_slot' | 'next_day_reference' | 'unverified';

export interface MonitoringFavoritesResult {
    products: any[];
    availabilityReliable: boolean;
    availabilityBasis: AvailabilityBasis;
    checkedFor: string;
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

function scalarText(value: unknown): string {
    if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
    if (!value || typeof value !== 'object') return '';
    const object = value as Record<string, unknown>;
    for (const key of ['name', 'label', 'title', 'text', 'value', 'code']) {
        if (typeof object[key] === 'string' || typeof object[key] === 'number') return String(object[key]).trim();
    }
    return '';
}

function truthy(value: unknown): boolean {
    return value === true || value === 1 || value === '1' || value === 'true';
}

function nestedScalarTexts(value: unknown, maxDepth = 5): string[] {
    const texts: string[] = [];
    const visited = new Set<unknown>();
    const visit = (nested: unknown, depth: number): void => {
        if (nested === undefined || nested === null || depth > maxDepth || visited.has(nested)) return;
        if (typeof nested === 'string' || typeof nested === 'number') {
            texts.push(String(nested));
            return;
        }
        if (typeof nested !== 'object') return;
        visited.add(nested);
        if (Array.isArray(nested)) nested.forEach(item => visit(item, depth + 1));
        else Object.values(nested).forEach(item => visit(item, depth + 1));
    };
    visit(value, 0);
    return texts;
}

export type ProductAvailabilityReason = 'expected' | 'online_only' | 'out_of_stock' | null;

export function productAvailabilityReason(product: any): ProductAvailabilityReason {
    const statuses = nestedFieldValues(product, [
        'availabilityStatus', 'availability_status', 'stockStatus', 'stock_status',
        'productStatus', 'product_status', 'status', 'availabilityMessage', 'availability_message',
        'stockMessage', 'stock_message', 'availabilityLabel', 'availability_label',
        'availabilityType', 'availability_type', 'state', 'stateName', 'state_name',
    ]).map(scalarText);
    const markers = nestedFieldValues(product, [
        'promotions', 'promos', 'badges', 'labels', 'modifier', 'modifiers', 'tags', 'chips', 'flags',
        'availabilityInfo', 'availability_info',
    ]).flatMap(value => nestedScalarTexts(value));
    const signal = [...statuses, ...markers].join(' ').toLowerCase();

    const explicitlyExpected = nestedFieldValues(product, [
        'expected', 'isExpected', 'is_expected', 'awaiting', 'isAwaiting', 'is_awaiting',
        'comingSoon', 'coming_soon', 'isComingSoon', 'is_coming_soon',
    ]).some(truthy);
    if (explicitlyExpected) return 'expected';
    if (/очіку|expected|awaiting|coming[_\s-]?soon/.test(signal)) return 'expected';
    if (/out[_\s-]?of[_\s-]?stock|unavailable|not[_\s-]?available|sold[_\s-]?out|немає|відсут/.test(signal)) {
        return 'out_of_stock';
    }
    const onlineOnly = nestedFieldValues(product, [
        'onlineOnly', 'online_only', 'isOnlineOnly', 'is_online_only', 'onlyOnline', 'only_online',
        'priceOnlyOnline', 'price_only_online', 'isOnlinePrice', 'is_online_price', 'priceType', 'price_type',
    ]).some(value => truthy(value) || /online|онлайн/.test(scalarText(value).toLowerCase()));
    if (onlineOnly || /only[_\s-]?online|лише[_\s-]?онлайн|тільки[_\s-]?онлайн/.test(signal)) return 'online_only';
    return null;
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
    const reason = productAvailabilityReason(product);
    if (reason === 'expected' || reason === 'out_of_stock') return false;
    if (reason === 'online_only') return null;

    if (nestedFieldValues(product, ['out_of_stock', 'outOfStock', 'is_out_of_stock', 'isOutOfStock']).some(truthy)) return false;

    // Keep the availability captured from the store-scoped favorites call,
    // but only after negative evidence from the richer details response.
    if (Object.prototype.hasOwnProperty.call(product || {}, 'storeAvailability')) {
        const value = product.storeAvailability;
        if (value === null) return null;
        return truthy(value);
    }
    for (const stockValue of nestedFieldValues(product, ['stock'])) {
        if (stockValue !== null && stockValue !== '') {
            if (typeof stockValue === 'string') {
                const normalized = stockValue.trim().toLowerCase();
                if (['out_of_stock', 'out-of-stock', 'unavailable', 'sold_out', 'sold-out', 'none', 'false'].includes(normalized)) return false;
                if (['in_stock', 'in-stock', 'available', 'true'].includes(normalized)) return true;
            }
            const numeric = Number(stockValue);
            if (Number.isFinite(numeric)) return numeric > 0;
        }
    }
    for (const quantity of nestedFieldValues(product, [
        'stockQuantity', 'stock_quantity', 'availableQuantity', 'available_quantity', 'quantityAvailable', 'quantity_available'
    ])) {
        if (quantity !== null && quantity !== '') {
            const numeric = Number(quantity);
            if (Number.isFinite(numeric)) return numeric > 0;
        }
    }
    for (const value of nestedFieldValues(product, [
        'in_stock', 'inStock', 'is_in_stock', 'isInStock'
    ])) {
        return truthy(value);
    }
    for (const value of nestedFieldValues(product, ['available', 'isAvailable', 'is_available'])) {
        if (!truthy(value)) return false;
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
                availabilityReliable: false,
                availabilityBasis: 'next_day_reference',
                checkedFor: reference.start.toISOString(),
            };
        }
    } catch (error) {
        console.warn('[MCP] Daytime availability fallback failed:', error);
    }

    return { products: current, availabilityReliable: false, availabilityBasis: 'unverified', checkedFor: now.toISOString() };
}
