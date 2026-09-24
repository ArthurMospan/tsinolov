import { callMCPTool } from './mcp-direct';
import { coordinatesOf } from './location';

export interface StoreContext {
    branchId: string;
    deliveryType: string;
    mode: 'delivery' | 'pickup';
    contextLabel: string;
    contextSource: 'silpo' | 'manual';
    selectionRequired: boolean;
    city: string;
    address: string;
    storeLabel: string;
    isOpen: boolean | null;
    orderMinimum: number | null;
    deliveryPrice: number | null;
    deliveryTemporarilyUnavailable: boolean | null;
}
type CachedBranch = { expiresAt: number; branch: any | null };
export interface StorePreference {
    branchId: string;
    deliveryType: string;
    storeLabel?: string;
}

const branchCache = new Map<string, CachedBranch>();
const BRANCH_CACHE_TTL = 6 * 60 * 60 * 1000;
let branchCatalogCache: { expiresAt: number; branches: any[] } | null = null;

export function parseMcpContent(response: any): any[] {
    const content = response?.result?.content;
    if (!Array.isArray(content)) return [];
    return content.flatMap((item: any) => {
        if (item?.type !== 'text' || typeof item.text !== 'string') return [];
        try { return [JSON.parse(item.text)]; } catch { return []; }
    });
}

function firstObject(values: any[]): any | undefined {
    for (const value of values) {
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    }
    return undefined;
}

function branchItems(value: any): any[] {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.branches)) return value.branches;
    if (Array.isArray(value?.items)) return value.items;
    if (Array.isArray(value?.data?.branches)) return value.data.branches;
    return [];
}

export function publicStoreLabel(branch: any): string {
    const city = String(branch?.city || branch?.cityFull || branch?.locality || '').trim();
    const address = String(branch?.address || branch?.addressFull || branch?.streetAddress || '').trim();
    return [city, address].filter(Boolean).join(', ') || 'Магазин Сільпо за замовчуванням';
}

export function fulfillmentMode(deliveryType: unknown): 'delivery' | 'pickup' {
    const normalized = String(deliveryType || '').toLocaleLowerCase('uk-UA');
    return normalized.includes('pickup') || normalized.includes('самовив') ? 'pickup' : 'delivery';
}

export function publicDeliveryAddressLabel(address: any): string {
    if (typeof address === 'string') return address.trim();
    if (!address || typeof address !== 'object') return '';

    const direct = [address.formattedAddress, address.fullAddress, address.addressLine, address.displayName, address.address]
        .find(value => typeof value === 'string' && value.trim())?.trim() || '';
    if (direct) return direct;

    const tag = String(address.tag || address.title || address.label || '').trim();
    const city = String(address.city || address.cityName || address.locality || '').trim();
    const street = String(address.street || address.streetName || '').trim();
    const building = String(address.building || address.house || address.houseNumber || '').trim();
    const apartment = String(address.apartment || address.flat || '').trim();
    const streetLine = [street, building].filter(Boolean).join(', ');
    const addressLine = [city, streetLine].filter(Boolean).join(', ');
    const apartmentLine = apartment ? `кв. ${apartment}` : '';
    return [tag, addressLine, apartmentLine].filter(Boolean).join(' · ');
}

function activeDeliveryAddress(details: any, cart: any): string {
    const shipment = Array.isArray(cart?.shipments) ? cart.shipments[0] : undefined;
    const shipmentDelivery = shipment?.delivery;
    const delivery = cart?.delivery || details?.delivery;
    const candidates = [
        cart?.deliveryAddress,
        details?.deliveryAddress,
        shipment?.deliveryAddress,
        shipment?.recipientAddress,
        shipmentDelivery?.deliveryAddress,
        shipmentDelivery?.address,
        delivery?.deliveryAddress,
        delivery?.address,
        cart?.customerAddress,
        details?.customerAddress,
    ];
    for (const candidate of candidates) {
        const label = publicDeliveryAddressLabel(candidate);
        if (label) return label;
    }
    return '';
}

function normalizedLocation(value: unknown): string {
    return String(value || '')
        .toLocaleLowerCase('uk-UA')
        .replace(/\s+/g, ' ')
        .replace(/[.,]/g, '')
        .trim();
}

function branchCity(branch: any): string {
    return String(branch?.city || branch?.cityFull || branch?.locality || '').trim();
}

function branchAddress(branch: any): string {
    return String(branch?.address || branch?.addressFull || branch?.streetAddress || '').trim();
}

function branchIdOf(branch: any): string {
    return String(branch?.branchId || branch?.id || '').trim();
}

export function preferredPickupBranch(selected: any, branches: any[]): any {
    if (!selected || selected?.hasPickup === true) return selected;
    const city = normalizedLocation(branchCity(selected));
    const address = normalizedLocation(branchAddress(selected));
    if (!city || !address) return selected;
    return branches.find(branch => branch?.hasPickup === true
        && normalizedLocation(branchCity(branch)) === city
        && normalizedLocation(branchAddress(branch)) === address) || selected;
}

export function supportsPickup(branch: any): boolean {
    if (branch?.hasPickup === true) return true;
    const deliveryTypes = [
        branch?.deliveryType,
        branch?.fulfillmentType,
        ...(Array.isArray(branch?.deliveryTypes) ? branch.deliveryTypes : []),
        ...(Array.isArray(branch?.availableDeliveryTypes) ? branch.availableDeliveryTypes : []),
    ];
    return deliveryTypes.some(value => fulfillmentMode(value) === 'pickup');
}

function physicalStoreScore(store: any): number {
    let score = 0;
    if (store?.hasPickup === true) score += 100;
    if (fulfillmentMode(store?.deliveryType) === 'pickup' || store?.mode === 'pickup') score += 20;
    if (store?.open === true || store?.isOpen === true) score += 5;
    if (coordinatesOf(store)) score += 1;
    return score;
}

export function uniquePhysicalStores<T extends Record<string, any>>(stores: T[]): T[] {
    const unique = new Map<string, T>();
    for (const store of stores) {
        const branchId = branchIdOf(store);
        const city = branchCity(store);
        const address = branchAddress(store);
        const publicLabel = String(store?.storeLabel || store?.contextLabel || publicStoreLabel(store)).trim();
        const location = normalizedLocation([city, address].filter(Boolean).join(' ') || publicLabel);
        const key = location && publicLabel !== 'Магазин Сільпо за замовчуванням'
            ? `location:${location}`
            : `branch:${branchId}`;
        if (!key || key === 'branch:') continue;
        const existing = unique.get(key);
        if (!existing || physicalStoreScore(store) > physicalStoreScore(existing)) unique.set(key, store);
    }
    return [...unique.values()];
}

export function sameStoreContext(previous: any, current: Pick<StoreContext, 'branchId' | 'deliveryType'>): boolean {
    if (!previous?.branch_id || !previous?.delivery_type) return false;
    return String(previous.branch_id) === current.branchId
        && String(previous.delivery_type).toLowerCase() === current.deliveryType.toLowerCase();
}

async function resolveBranch(token: string, branchId: string): Promise<any | null> {
    const cached = branchCache.get(branchId);
    if (cached && cached.expiresAt > Date.now()) return cached.branch;

    let match: any | null = null;
    for (let offset = 0; offset < 1000 && !match; offset += 50) {
        const response = await callMCPTool(token, 'silpo_list_branches', { limit: 50, offset });
        const branches = branchItems(firstObject(parseMcpContent(response)));
        match = branches.find(branch => String(branch?.branchId || branch?.id) === branchId) || null;
        if (branches.length < 50) break;
    }
    branchCache.set(branchId, { expiresAt: Date.now() + BRANCH_CACHE_TTL, branch: match });
    return match;
}

export async function listBranches(token: string): Promise<any[]> {
    if (branchCatalogCache && branchCatalogCache.expiresAt > Date.now()) return branchCatalogCache.branches;
    const branches: any[] = [];
    for (let offset = 0; offset < 1000; offset += 50) {
        const response = await callMCPTool(token, 'silpo_list_branches', { limit: 50, offset });
        const page = branchItems(firstObject(parseMcpContent(response)));
        branches.push(...page);
        if (page.length < 50) break;
    }
    branchCatalogCache = { expiresAt: Date.now() + BRANCH_CACHE_TTL, branches };
    return branches;
}

export async function getStoreContext(token: string, preference?: StorePreference): Promise<StoreContext> {
    if (preference?.branchId) {
        let branch = await resolveBranch(token, preference.branchId);
        if (preference.deliveryType === 'SelfPickup' && branch?.hasPickup !== true) {
            branch = preferredPickupBranch(branch, await listBranches(token));
        }
        const branchId = branchIdOf(branch) || preference.branchId;
        const mode = fulfillmentMode(preference.deliveryType);
        const contextLabel = mode === 'pickup'
            ? publicStoreLabel(branch)
            : String(preference.storeLabel || '').trim() || 'Оберіть адресу доставки';
        return {
            branchId,
            deliveryType: preference.deliveryType || 'SelfPickup',
            mode,
            contextLabel,
            contextSource: 'manual',
            selectionRequired: mode === 'delivery' && !String(preference.storeLabel || '').trim(),
            city: mode === 'pickup' ? branchCity(branch) : '',
            address: mode === 'pickup' ? branchAddress(branch) : '',
            storeLabel: contextLabel,
            isOpen: mode === 'pickup' && typeof branch?.open === 'boolean' ? branch.open : null,
            orderMinimum: null,
            deliveryPrice: null,
            deliveryTemporarilyUnavailable: null,
        };
    }

    const cartResponse = await callMCPTool(token, 'silpo_get_my_shopping_cart', {});
    const cartRoot = firstObject(parseMcpContent(cartResponse));
    const cartId = cartRoot?.shoppingCartId || cartRoot?.cartId || cartRoot?.id;
    if (!cartId) throw new Error('MCP did not return shopping cart id');

    const detailsResponse = await callMCPTool(token, 'silpo_get_shopping_cart_by_id', {
        shoppingCartId: String(cartId)
    });
    const details = firstObject(parseMcpContent(detailsResponse));
    const cart = details?.cart || details;
    const branchId = String(cart?.shipments?.[0]?.branchId || cart?.branchId || '');
    const deliveryType = String(cart?.deliveryType || details?.deliveryType || '');
    if (!branchId || !deliveryType) {
        throw new Error(`MCP cart context incomplete: branchId=${branchId || 'missing'}, deliveryType=${deliveryType || 'missing'}`);
    }

    let branch: any | null = null;
    try {
        branch = await resolveBranch(token, branchId);
    } catch (error) {
        console.warn(`[MCP] Public branch details unavailable for ${branchId}:`, error);
    }

    const calculation = cart?.calculation || details?.calculation || {};
    const validations = Array.isArray(calculation?.validations) ? calculation.validations : [];
    const minimumValidation = validations.find((validation: any) => Number(validation?.context?.orderCostMin) > 0);
    const delivery = calculation?.delivery || {};
    const express = delivery?.deliveryExpressByPromise || {};
    const mode = fulfillmentMode(deliveryType);
    const deliveryAddress = mode === 'delivery' ? activeDeliveryAddress(details, cart) : '';
    const contextLabel = mode === 'delivery'
        ? deliveryAddress || 'Оберіть адресу доставки'
        : publicStoreLabel(branch);

    return {
        branchId,
        deliveryType,
        mode,
        contextLabel,
        contextSource: 'silpo',
        selectionRequired: mode === 'delivery' && !deliveryAddress,
        city: mode === 'pickup' ? branchCity(branch) : '',
        address: mode === 'pickup' ? branchAddress(branch) : '',
        storeLabel: contextLabel,
        isOpen: mode === 'pickup' && typeof branch?.open === 'boolean' ? branch.open : null,
        orderMinimum: Number(minimumValidation?.context?.orderCostMin) || null,
        deliveryPrice: Number(delivery?.total) || Number(express?.price) || null,
        deliveryTemporarilyUnavailable: typeof express?.isTemporarilyUnavailable === 'boolean'
            ? express.isTemporarilyUnavailable
            : null,
    };
}
