import { callMCPTool, listMCPTools, type MCPToolDefinition } from './mcp-direct';
import { getSilpoCurrentTimeslot } from './silpo-public-catalog';
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

function looksLikeFavorite(value: any): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return [
        value.id, value.productId, value.product_id, value.externalProductId,
        value.external_product_id, value.slug, value.title, value.name, value.productName,
    ].some(candidate => candidate !== undefined && candidate !== null && String(candidate).trim());
}

function favoriteIdentityKeys(product: any): string[] {
    const keys: string[] = [];
    const externalId = Number(product?.externalProductId ?? product?.external_product_id);
    if (Number.isSafeInteger(externalId)) keys.push(`external:${externalId}`);
    for (const [prefix, value] of [
        ['id', product?.id ?? product?.productId ?? product?.product_id],
        ['slug', product?.slug ?? product?.productSlug ?? product?.product_slug],
    ] as const) {
        const normalized = String(value ?? '').trim().toLocaleLowerCase('uk-UA');
        if (normalized) keys.push(`${prefix}:${normalized}`);
    }
    const title = String(product?.title ?? product?.name ?? product?.productName ?? '')
        .trim().toLocaleLowerCase('uk-UA').replace(/\s+/g, ' ');
    if (title) keys.push(`title:${title}`);
    return keys;
}

export function mergeFavoriteCollections(...collections: any[][]): any[] {
    const merged: any[] = [];
    const keyToIndex = new Map<string, number>();
    for (const collection of collections) {
        for (const product of collection) {
            if (!looksLikeFavorite(product)) continue;
            const keys = favoriteIdentityKeys(product);
            const existingIndex = keys.map(key => keyToIndex.get(key)).find(index => index !== undefined);
            if (existingIndex === undefined) {
                const index = merged.length;
                merged.push(product);
                keys.forEach(key => keyToIndex.set(key, index));
                continue;
            }
            merged[existingIndex] = { ...merged[existingIndex], ...product };
            favoriteIdentityKeys(merged[existingIndex]).forEach(key => keyToIndex.set(key, existingIndex));
        }
    }
    return merged;
}

export function mergeAccountAndStoreFavorites(accountFavorites: any[], storeFavorites: any[]): any[] {
    const storeKeys = new Set(storeFavorites.flatMap(favoriteIdentityKeys));
    return mergeFavoriteCollections(accountFavorites, storeFavorites).map(product => {
        const existsInStoreProjection = favoriteIdentityKeys(product).some(key => storeKeys.has(key));
        if (existsInStoreProjection) return product;
        return {
            ...product,
            storeAvailability: false,
            availabilityStatus: product.availabilityStatus ?? 'out_of_stock',
            legacyFavorite: true,
        };
    });
}

export function favoritesFromResponse(response: any): any[] {
    const products: any[] = [];
    const visited = new Set<any>();
    const collectionKey = /(favorite|product|item|unavailable|expected|archiv|legacy|out.?of.?stock)/i;
    const wrapperKey = /^(data|result|payload|response)$/i;
    const visit = (value: any, insideCollection: boolean): void => {
        if (value === undefined || value === null || visited.has(value)) return;
        if (Array.isArray(value)) {
            visited.add(value);
            const containsProducts = insideCollection || value.some(looksLikeFavorite);
            value.forEach(item => visit(item, containsProducts));
            return;
        }
        if (typeof value !== 'object') {
            if (!insideCollection || (typeof value !== 'string' && typeof value !== 'number')) return;
            const externalId = Number(value);
            products.push(Number.isSafeInteger(externalId)
                ? { externalProductId: externalId }
                : { id: String(value) });
            return;
        }
        visited.add(value);
        if (insideCollection && looksLikeFavorite(value)) {
            products.push(value);
            return;
        }
        for (const [key, nested] of Object.entries(value)) {
            if (collectionKey.test(key)) visit(nested, true);
            else if (wrapperKey.test(key)) visit(nested, insideCollection);
        }
    };
    for (const value of parseMcpContent(response)) visit(value, Array.isArray(value));
    return mergeFavoriteCollections(products);
}

export function buildFavoriteVisibilityArgs(tool: MCPToolDefinition): Record<string, boolean> {
    const args: Record<string, boolean> = {};
    for (const key of Object.keys(tool.inputSchema?.properties || {})) {
        const normalized = key.replace(/[_-]/g, '').toLowerCase();
        if (/^include(unavailable|outofstock|archived|inactive|legacy)/.test(normalized)) args[key] = true;
        if (/^(instock|onlyinstock|onlyavailable|availableonly|excludeunavailable|hideunavailable)/.test(normalized)) {
            args[key] = false;
        }
    }
    return args;
}

async function favoriteVisibilityArgs(token: string): Promise<Record<string, boolean>> {
    try {
        const tool = (await listMCPTools(token)).find(candidate => candidate.name === 'silpo_get_my_favorites');
        return tool ? buildFavoriteVisibilityArgs(tool) : {};
    } catch (error) {
        console.warn('[MCP] Favorites schema unavailable; using default visibility:', error);
        return {};
    }
}

export function productAvailability(product: any): boolean | null {
    const reason = productAvailabilityReason(product);
    if (reason === 'expected' || reason === 'out_of_stock') return false;
    if (reason === 'online_only') return null;

    if (nestedFieldValues(product, ['out_of_stock', 'outOfStock', 'is_out_of_stock', 'isOutOfStock']).some(truthy)) return false;

    let positiveDetailSignal = false;
    for (const stockValue of nestedFieldValues(product, ['stock'])) {
        if (stockValue !== null && stockValue !== '') {
            if (typeof stockValue === 'string') {
                const normalized = stockValue.trim().toLowerCase();
                if (['out_of_stock', 'out-of-stock', 'unavailable', 'sold_out', 'sold-out', 'none', 'false'].includes(normalized)) return false;
                if (['in_stock', 'in-stock', 'available', 'true'].includes(normalized)) positiveDetailSignal = true;
            }
            const numeric = Number(stockValue);
            if (Number.isFinite(numeric)) {
                if (numeric <= 0) return false;
                positiveDetailSignal = true;
            }
        }
    }
    for (const quantity of nestedFieldValues(product, [
        'stockQuantity', 'stock_quantity', 'availableQuantity', 'available_quantity', 'quantityAvailable', 'quantity_available'
    ])) {
        if (quantity !== null && quantity !== '') {
            const numeric = Number(quantity);
            if (Number.isFinite(numeric)) {
                if (numeric <= 0) return false;
                positiveDetailSignal = true;
            }
        }
    }
    for (const value of nestedFieldValues(product, [
        'in_stock', 'inStock', 'is_in_stock', 'isInStock'
    ])) {
        if (!truthy(value)) return false;
        positiveDetailSignal = true;
    }
    for (const value of nestedFieldValues(product, ['available', 'isAvailable', 'is_available'])) {
        if (!truthy(value)) return false;
        positiveDetailSignal = true;
    }

    // A favorites/search summary is useful when details have no stock signal,
    // but it must never turn an explicit stock: 0 back into "available".
    if (Object.prototype.hasOwnProperty.call(product || {}, 'storeAvailability')) {
        const value = product.storeAvailability;
        if (value === null) return null;
        return truthy(value);
    }
    return positiveDetailSignal ? true : null;
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

async function fetchFavorites(
    token: string,
    context: Pick<StoreContext, 'branchId' | 'deliveryType'>,
    start: Date,
    end: Date,
    visibilityArgs: Record<string, boolean>,
) {
    return favoritesFromResponse(await callMCPTool(token, 'silpo_get_my_favorites', {
        branchId: context.branchId,
        deliveryType: context.deliveryType,
        timeslotStart: start.toISOString(),
        timeslotEnd: end.toISOString(),
        limit: 500,
        offset: 0,
        ...visibilityArgs,
    }));
}

async function fetchAccountFavorites(
    token: string,
    context: Pick<StoreContext, 'branchId' | 'deliveryType'>,
    visibilityArgs: Record<string, boolean>,
): Promise<any[]> {
    return favoritesFromResponse(await callMCPTool(token, 'silpo_get_my_favorites', {
        branchId: context.branchId,
        deliveryType: context.deliveryType,
        limit: 500,
        offset: 0,
        ...visibilityArgs,
    }));
}

export async function getMonitoringFavorites(
    token: string,
    context: Pick<StoreContext, 'branchId' | 'deliveryType'>,
    now = new Date()
): Promise<MonitoringFavoritesResult> {
    const visibilityArgs = await favoriteVisibilityArgs(token);
    const accountFavoritesPromise = fetchAccountFavorites(token, context, visibilityArgs).catch(error => {
        console.warn('[MCP] Account-wide favorites unavailable; using the store catalogue projection:', error);
        return [];
    });
    const actualSlot = await getSilpoCurrentTimeslot(context).catch(error => {
        console.warn(`[Silpo] Valid favorites timeslot unavailable for branch ${context.branchId}:`, error);
        return null;
    });
    const currentStart = actualSlot ? new Date(actualSlot.start) : now;
    const currentEnd = actualSlot ? new Date(actualSlot.end) : new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const current = await fetchFavorites(token, context, currentStart, currentEnd, visibilityArgs);
    const accountFavorites = await accountFavoritesPromise;
    if (actualSlot || !allProductsUnexpectedlyUnavailable(current)) {
        return {
            products: mergeAccountAndStoreFavorites(accountFavorites, current),
            availabilityReliable: Boolean(actualSlot) || !allProductsUnexpectedlyUnavailable(current),
            availabilityBasis: 'current_slot',
            checkedFor: currentStart.toISOString(),
        };
    }

    const reference = nextDaytimeReference(now);
    try {
        const daytime = await fetchFavorites(token, context, reference.start, reference.end, visibilityArgs);
        if (!allProductsUnexpectedlyUnavailable(daytime)) {
            return {
                products: mergeAccountAndStoreFavorites(accountFavorites, daytime),
                availabilityReliable: false,
                availabilityBasis: 'next_day_reference',
                checkedFor: reference.start.toISOString(),
            };
        }
    } catch (error) {
        console.warn('[MCP] Daytime availability fallback failed:', error);
    }

    return {
        products: mergeAccountAndStoreFavorites(accountFavorites, current),
        availabilityReliable: false,
        availabilityBasis: 'unverified',
        checkedFor: currentStart.toISOString(),
    };
}
