import type { StoreContext } from './store-context';

const ECOM_BASE = 'https://sf-ecom-api.silpo.ua';
const REQUEST_TIMEOUT_MS = 8_000;
const SNAPSHOT_TTL_MS = 2 * 60 * 1000;

type Timeslot = { start: string; end: string };

const timeslotCache = new Map<string, { expiresAt: number; slot: Timeslot | null }>();
const snapshotCache = new Map<string, { expiresAt: number; product: any }>();

async function requestJson(path: string): Promise<any> {
    const response = await fetch(`${ECOM_BASE}${path}`, {
        headers: {
            accept: 'application/json',
            'accept-language': 'uk,en;q=0.9',
            origin: 'https://silpo.ua',
            referer: 'https://silpo.ua/',
            'user-agent': 'Mozilla/5.0 (compatible; Tsinolov/1.0)',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Silpo public API ${response.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
}

export function selectAvailableTimeslot(response: any, now = new Date()): Timeslot | null {
    const nowMs = now.getTime();
    const slots = Array.isArray(response?.items) ? response.items : [];
    const available = slots
        .filter((slot: any) => slot?.isAvailable !== false
            && typeof slot?.datePeriod?.start === 'string'
            && typeof slot?.datePeriod?.end === 'string'
            && Date.parse(slot.datePeriod.end) > nowMs)
        .sort((left: any, right: any) => Date.parse(left.datePeriod.start) - Date.parse(right.datePeriod.start));
    const slot = available[0];
    return slot ? { start: slot.datePeriod.start, end: slot.datePeriod.end } : null;
}

async function currentTimeslot(
    context: Pick<StoreContext, 'branchId' | 'deliveryType'>
): Promise<Timeslot | null> {
    const cacheKey = `${context.branchId}:${context.deliveryType}`;
    const cached = timeslotCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.slot;
    const query = new URLSearchParams();
    query.append('deliveryTypes[]', context.deliveryType);
    const response = await requestJson(`/v3/delivery/branches/${encodeURIComponent(context.branchId)}/time-slots?${query}`);
    const slot = selectAvailableTimeslot(response);
    timeslotCache.set(cacheKey, { expiresAt: Date.now() + SNAPSHOT_TTL_MS, slot });
    return slot;
}

function productIdentifier(product: any): string {
    const externalId = Number(product?.externalProductId ?? product?.external_product_id);
    if (Number.isSafeInteger(externalId)) return String(externalId);
    return String(product?.slug ?? product?.productSlug ?? product?.product_slug ?? '').trim();
}

export async function getSilpoProductSnapshot(
    context: Pick<StoreContext, 'branchId' | 'deliveryType'>,
    product: any
): Promise<any | null> {
    const identifier = productIdentifier(product);
    if (!identifier) return null;
    const cacheKey = `${context.branchId}:${context.deliveryType}:${identifier}`;
    const cached = snapshotCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.product;

    let slot: Timeslot | null = null;
    try {
        slot = await currentTimeslot(context);
    } catch (error) {
        console.warn(`[Silpo] Timeslot lookup failed for branch ${context.branchId}:`, error);
    }

    const query = new URLSearchParams({ deliveryType: context.deliveryType });
    if (slot) {
        query.set('timeslotStart', slot.start);
        query.set('timeslotEnd', slot.end);
    }
    const raw = await requestJson(
        `/v1/uk/branches/${encodeURIComponent(context.branchId)}/products/${encodeURIComponent(identifier)}?${query}`
    );
    if (!raw || typeof raw !== 'object') return null;

    // Without a real slot Silpo returns stock: 0 even for available products.
    // The packaging data is still useful, but that synthetic stock is not.
    const { stock, ...withoutStock } = raw;
    const snapshot = {
        ...withoutStock,
        ...(slot ? { stock } : {}),
        price: raw.displayPrice ?? raw.price,
        oldPrice: raw.displayOldPrice ?? raw.oldPrice,
    };
    snapshotCache.set(cacheKey, { expiresAt: Date.now() + SNAPSHOT_TTL_MS, product: snapshot });
    return snapshot;
}
