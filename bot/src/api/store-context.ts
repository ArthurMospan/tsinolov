import { callMCPTool } from './mcp-direct';

export interface StoreContext {
    branchId: string;
    deliveryType: string;
    city: string;
    address: string;
    storeLabel: string;
    isOpen: boolean | null;
}
type CachedBranch = { expiresAt: number; branch: any | null };

const branchCache = new Map<string, CachedBranch>();
const BRANCH_CACHE_TTL = 6 * 60 * 60 * 1000;

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
    const city = String(branch?.city || branch?.locality || '').trim();
    const address = String(branch?.address || branch?.streetAddress || '').trim();
    return [city, address].filter(Boolean).join(', ') || 'Магазин Сільпо за замовчуванням';
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

export async function getStoreContext(token: string): Promise<StoreContext> {
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

    return {
        branchId,
        deliveryType,
        city: String(branch?.city || branch?.locality || '').trim(),
        address: String(branch?.address || branch?.streetAddress || '').trim(),
        storeLabel: publicStoreLabel(branch),
        isOpen: typeof branch?.open === 'boolean' ? branch.open : null,
    };
}
