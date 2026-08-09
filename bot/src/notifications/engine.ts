import db from '../db/index';
import { callMCPTool } from '../api/mcp-direct';
import { rankProductAlternatives, type RankedAlternative } from './alternative-ranking';
import { activePersonalPromos, personalPromoMessage, promoIdOf, promoSignature } from './personal-promos';

type JsonObject = Record<string, any>;
export type SendMessage = (chatId: number, text: string) => Promise<unknown>;

export interface CheckResult {
    checked: boolean;
    notifications: number;
    products: number;
    error?: string;
}

function parseMcpContent(response: any): any[] {
    const content = response?.result?.content;
    if (!Array.isArray(content)) return [];
    return content.flatMap((item: any) => {
        if (item?.type !== 'text' || typeof item.text !== 'string') return [];
        try { return [JSON.parse(item.text)]; } catch { return []; }
    });
}

function firstObject(values: any[]): JsonObject | undefined {
    for (const value of values) {
        if (Array.isArray(value)) {
            const nested = firstObject(value);
            if (nested) return nested;
        } else if (value && typeof value === 'object') {
            return value;
        }
    }
    return undefined;
}

function getFavorites(values: any[]): any[] {
    for (const value of values) {
        if (Array.isArray(value)) return value;
        if (Array.isArray(value?.items)) return value.items;
        if (Array.isArray(value?.products)) return value.products;
        if (Array.isArray(value?.favorites)) return value.favorites;
        if (Array.isArray(value?.promos)) return value.promos;
    }
    return [];
}

function getProductCandidates(values: any[]): any[] {
    const products: any[] = [];
    const visited = new Set<any>();
    const visit = (value: any): void => {
        if (!value || typeof value !== 'object' || visited.has(value)) return;
        visited.add(value);
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }
        if (productIdCandidates(value).length && priceOf(value) > 0) products.push(value);
        for (const key of ['item', 'product', 'items', 'products', 'favorites', 'replacements', 'alternatives', 'data', 'result']) {
            visit(value[key]);
        }
    };
    values.forEach(visit);
    return products;
}

function firstValue(object: any, keys: string[]): any {
    for (const key of keys) {
        if (object?.[key] !== undefined && object?.[key] !== null) return object[key];
    }
    return undefined;
}

function boolValue(value: any): boolean {
    return value === true || value === 1 || value === '1' || value === 'true';
}

function productIdCandidates(product: any): string[] {
    return [product?.id, product?.product_id, product?.productId, product?.slug, product?.externalProductId]
        .filter(value => value !== undefined && value !== null && value !== '')
        .map(String);
}

function priceOf(product: any): number {
    return Number(firstValue(product, ['price', 'current_price', 'currentPrice', 'salePrice', 'sellingPrice']) || 0);
}

function currentAvailability(product: any): boolean {
    if (product?.in_stock !== undefined) return boolValue(product.in_stock);
    if (product?.inStock !== undefined) return boolValue(product.inStock);
    if (product?.stock !== undefined) {
        if (typeof product.stock === 'string') {
            const normalized = product.stock.trim().toLowerCase();
            if (['out_of_stock', 'out-of-stock', 'unavailable', 'sold_out', 'sold-out', 'none', 'false', '0'].includes(normalized)) {
                return false;
            }
            if (['in_stock', 'in-stock', 'available', 'true'].includes(normalized)) return true;
        }
        const numericStock = Number(product.stock);
        if (Number.isFinite(numericStock)) return numericStock > 0;
    }
    if (product?.available !== undefined) return boolValue(product.available);
    return true;
}

function promoOf(product: any): boolean {
    const explicit = firstValue(product, ['hasPromo', 'has_promo', 'isPromo', 'is_promo', 'promo']);
    if (explicit !== undefined) return boolValue(explicit);
    const specialPrices = product?.specialPrices;
    return (Array.isArray(specialPrices) && specialPrices.length > 0)
        || (specialPrices && typeof specialPrices === 'object' && Object.keys(specialPrices).length > 0)
        || Number(product?.oldPrice || 0) > Number(product?.price || 0);
}

function smartBuyOf(product: any): boolean {
    const explicit = firstValue(product, ['smartBuy', 'smart_buy', 'isSmartBuy', 'is_smart_buy', 'historicalMinimum']);
    if (explicit !== undefined) return boolValue(explicit);
    const current = Number(product?.price || 0);
    const old = Number(product?.oldPrice || 0);
    return current > 0 && old > current && current <= old * 0.8;
}

function deliveryAvailableOf(product: any): boolean {
    const explicit = firstValue(product, ['deliveryAvailable', 'delivery_available', 'isDeliveryAvailable']);
    if (explicit !== undefined) return boolValue(explicit);
    return product?.available !== undefined ? boolValue(product.available) : true;
}

function hasSameContext(product: any, context: { branchId: string; deliveryType: string }): boolean {
    const branchId = firstValue(product, ['branchId', 'branch_id', 'storeId', 'store_id']);
    if (branchId !== undefined && branchId !== null && String(branchId) !== context.branchId) return false;
    const deliveryType = firstValue(product, ['deliveryType', 'delivery_type']);
    if (deliveryType !== undefined && deliveryType !== null && String(deliveryType).toLowerCase() !== context.deliveryType.toLowerCase()) {
        return false;
    }
    return true;
}

const productMetadataCache = new Map<string, { expiresAt: number; product: any }>();
const PRODUCT_METADATA_TTL = 12 * 60 * 60 * 1000;

async function getDetailedProduct(
    token: string,
    context: { branchId: string; deliveryType: string },
    product: any
): Promise<any | null> {
    const slug = String(firstValue(product, ['slug', 'productSlug']) || '');
    if (!slug) return null;
    const cacheKey = `${context.branchId}:${context.deliveryType}:${slug}`;
    const cached = productMetadataCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return { ...cached.product, ...product };

    const now = new Date();
    const response = await callMCPTool(token, 'silpo_get_product_details', {
        branchId: context.branchId,
        slug,
        deliveryType: context.deliveryType,
        timeslotStart: now.toISOString(),
        timeslotEnd: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString()
    });
    const detailed = getProductCandidates(parseMcpContent(response))[0];
    if (!detailed) return null;
    productMetadataCache.set(cacheKey, { expiresAt: Date.now() + PRODUCT_METADATA_TTL, product: detailed });
    return { ...detailed, ...product, attributes: detailed.attributes };
}

async function getAlternative(
    token: string,
    context: { branchId: string; deliveryType: string },
    product: any
): Promise<RankedAlternative | null> {
    const candidates: any[] = [];
    const productId = firstValue(product, ['id', 'product_id', 'productId']);
    const companyId = firstValue(product, ['companyId', 'company_id', 'companyID']);
    const slug = firstValue(product, ['slug', 'productSlug']);
    const lookups: Array<Promise<any>> = [];
    if (productId && companyId) {
        lookups.push(callMCPTool(token, 'silpo_get_replacements', {
            branchId: context.branchId,
            companyId: String(companyId),
            productIds: [String(productId)],
            deliveryType: context.deliveryType
        }));
    }
    if (slug) {
        lookups.push(callMCPTool(token, 'silpo_get_similar_products', {
            branchId: context.branchId,
            slug: String(slug),
            deliveryType: context.deliveryType,
            limit: 20,
            offset: 0
        }));
    }

    const responses = await Promise.allSettled(lookups);
    for (const response of responses) {
        if (response.status === 'fulfilled') candidates.push(...getProductCandidates(parseMcpContent(response.value)));
        else console.warn('[Notifications] Alternative source failed:', response.reason);
    }

    const currentIds = new Set(productIdCandidates(product));
    const uniqueCandidates = new Map<string, any>();
    for (const candidate of candidates) {
        const candidateSlug = String(firstValue(candidate, ['slug', 'productSlug']) || '');
        if (!candidateSlug || productIdCandidates(candidate).some(id => currentIds.has(id))) continue;
        if (!hasSameContext(candidate, context) || !currentAvailability(candidate) || !deliveryAvailableOf(candidate)) continue;
        if (priceOf(candidate) >= priceOf(product) * 0.95) continue;
        uniqueCandidates.set(candidateSlug, candidate);
    }

    const shortlist = [...uniqueCandidates.values()]
        .sort((left, right) => priceOf(left) - priceOf(right))
        .slice(0, 8);
    if (!shortlist.length) return null;

    const [detailedCurrent, ...detailedCandidates] = await Promise.all([
        getDetailedProduct(token, context, product),
        ...shortlist.map(async candidate => {
            try { return await getDetailedProduct(token, context, candidate); }
            catch (error) {
                console.warn(`[Notifications] Product details failed for ${candidate.slug}:`, error);
                return null;
            }
        })
    ]);
    if (!detailedCurrent) return null;
    return rankProductAlternatives(detailedCurrent, detailedCandidates.filter(Boolean))[0] || null;
}

async function getCartContext(token: string): Promise<{ branchId: string; deliveryType: string }> {
    const cartResponse = await callMCPTool(token, 'silpo_get_my_shopping_cart');
    const cart = firstObject(parseMcpContent(cartResponse));
    const cartId = firstValue(cart, ['shoppingCartId', 'cartId', 'id']);
    if (!cartId) throw new Error('MCP did not return shopping cart id');

    const detailsResponse = await callMCPTool(token, 'silpo_get_shopping_cart_by_id', {
        shoppingCartId: String(cartId)
    });
    const details = firstObject(parseMcpContent(detailsResponse));
    const data = details?.cart || details;
    const branchId = data?.shipments?.[0]?.branchId || data?.branchId;
    const deliveryType = data?.deliveryType || details?.deliveryType;
    if (!branchId || !deliveryType) {
        throw new Error(`MCP cart context incomplete: branchId=${branchId || 'missing'}, deliveryType=${deliveryType || 'missing'}`);
    }
    return { branchId: String(branchId), deliveryType: String(deliveryType) };
}

async function getLiveFavorites(token: string, context: { branchId: string; deliveryType: string }): Promise<any[]> {
    const now = new Date();
    const response = await callMCPTool(token, 'silpo_get_my_favorites', {
        branchId: context.branchId,
        deliveryType: context.deliveryType,
        timeslotStart: now.toISOString(),
        timeslotEnd: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString()
    });
    return getFavorites(parseMcpContent(response));
}

async function getPersonalPromoChanges(token: string, tgId: number): Promise<{
    current: any[];
    newPromos: any[];
    baselineExists: boolean;
}> {
    const response = await callMCPTool(token, 'silpo_get_my_promos');
    const current = activePersonalPromos(getFavorites(parseMcpContent(response)));
    const known = await db.prepare(
        'SELECT promo_id, signature FROM user_promo_state WHERE tg_id = ?'
    ).all(tgId) as any[];
    const signatures = new Map(known.map(item => [String(item.promo_id), String(item.signature)]));
    const baselineExists = signatures.has('__baseline__');
    const newPromos = baselineExists
        ? current.filter(promo => signatures.get(promoIdOf(promo)) !== promoSignature(promo))
        : [];
    return { current, newPromos, baselineExists };
}

async function savePersonalPromoState(tgId: number, promos: any[]): Promise<void> {
    await db.prepare(`
        INSERT INTO user_promo_state (tg_id, promo_id, signature)
        VALUES (?, '__baseline__', '1')
        ON CONFLICT(tg_id, promo_id) DO UPDATE SET last_seen = CURRENT_TIMESTAMP
    `).run(tgId);
    for (const promo of promos) {
        await db.prepare(`
            INSERT INTO user_promo_state (tg_id, promo_id, signature)
            VALUES (?, ?, ?)
            ON CONFLICT(tg_id, promo_id) DO UPDATE SET
                signature = excluded.signature,
                last_seen = CURRENT_TIMESTAMP
        `).run(tgId, promoIdOf(promo), promoSignature(promo));
    }
}

export async function runUserCheck(tgId: number, sendMessage: SendMessage): Promise<CheckResult> {
    const user = await db.prepare('SELECT mcp_token FROM users WHERE tg_id = ?').get(tgId) as any;
    if (!user?.mcp_token) return { checked: false, notifications: 0, products: 0, error: 'Silpo account is not connected' };

    const settings = await db.prepare('SELECT * FROM user_settings WHERE tg_id = ?').get(tgId) as any || {};
    const targets = await db.prepare(
        'SELECT product_id, target_price FROM user_favorites WHERE tg_id = ? AND target_price > 0'
    ).all(tgId) as any[];

    try {
        const context = await getCartContext(user.mcp_token);
        const liveFavorites = await getLiveFavorites(user.mcp_token, context);
        let promoChanges: Awaited<ReturnType<typeof getPersonalPromoChanges>> | null = null;
        if (settings.promo_personal) {
            try { promoChanges = await getPersonalPromoChanges(user.mcp_token, tgId); }
            catch (error) { console.error('[Notifications] Personal promos failed:', error); }
        }
        let notifications = 0;
        if (promoChanges) {
            let canSaveState = true;
            if (promoChanges.baselineExists && promoChanges.newPromos.length) {
                try {
                    await sendMessage(tgId, personalPromoMessage(promoChanges.newPromos));
                    notifications++;
                } catch (error) {
                    canSaveState = false;
                    console.error('[Notifications] Personal promo notification failed:', error);
                }
            }
            if (canSaveState) await savePersonalPromoState(tgId, promoChanges.current);
        }

        for (const product of liveFavorites) {
            const productIds = productIdCandidates(product);
            const productId = productIds[0];
            if (!productId) continue;

            const currentPrice = priceOf(product);
            if (currentPrice <= 0) continue;
            const available = currentAvailability(product);
            const hasPromo = promoOf(product);
            const deliveryAvailable = deliveryAvailableOf(product);
            const smartBuy = smartBuyOf(product);
            let alternative: RankedAlternative | null = null;
            if (settings.alt_cheaper) {
                try { alternative = await getAlternative(user.mcp_token, context, product); }
                catch (error) { console.error(`[Notifications] Alternatives failed for ${productId}:`, error); }
            }
            const alternativePrice = alternative?.price || null;
            const previous = await db.prepare(
                'SELECT * FROM user_product_state WHERE tg_id = ? AND product_id = ?'
            ).get(tgId, productId) as any;
            const target = targets.find(item => productIds.includes(String(item.product_id)));
            const targetPrice = Number(target?.target_price || 0);
            const messages: string[] = [];
            let alternativeMessageAdded = false;
            const name = String(firstValue(product, ['name', 'title', 'productName']) || productId);

            if (settings.price_target && targetPrice > 0 && currentPrice <= targetPrice) {
                messages.push(`🎯 Бажана ціна досягнута\n${name}\nЗараз: ${currentPrice} ₴ · ваша бажана ціна: ${targetPrice} ₴`);
            }
            if (settings.price_drop && previous && currentPrice < Number(previous.current_price || 0)) {
                messages.push(`📉 Ціна знизилась\n${name}\nБуло: ${previous.current_price} ₴ · зараз: ${currentPrice} ₴`);
            }
            if (settings.promo_new && previous && !boolValue(previous.has_promo) && hasPromo) {
                messages.push(`🔥 Нова акція\n${name}\nЗараз: ${currentPrice} ₴`);
            }
            if (settings.in_stock && previous && !boolValue(previous.in_stock) && available) {
                messages.push(`📦 Товар знову в наявності\n${name}`);
            }
            if (settings.delivery_available && previous && !boolValue(previous.delivery_available) && deliveryAvailable) {
                messages.push(`🚚 Доставка знову доступна\n${name}`);
            }
            const alternativeIsNew = Boolean(alternative) && (
                String(previous?.alternative_product_id || '') !== alternative!.productId ||
                Number(previous?.alternative_comparison_price ?? Infinity) > alternative!.comparisonPrice + 0.001
            );
            if (settings.alt_cheaper && alternative && alternativeIsNew) {
                const comparison = alternative.comparisonLabel
                    ? `\nЦіна за ${alternative.comparisonLabel}: ${alternative.comparisonPrice.toFixed(2)} ₴ (цей товар: ${alternative.currentComparisonPrice.toFixed(2)} ₴)`
                    : '';
                const savings = Math.max(0, currentPrice - alternative.price).toFixed(2);
                messages.push(`💡 Знайдено точний дешевший варіант\n${name}: ${currentPrice} ₴\n${alternative.name}: ${alternative.price} ₴${comparison}\nЕкономія: ${savings} ₴\nhttps://silpo.ua/product/${alternative.slug}`);
                alternativeMessageAdded = true;
            }
            if (settings.smart_buy && smartBuy && !boolValue(previous?.is_smart_buy)) {
                const discount = Math.round((1 - currentPrice / Number(product?.oldPrice || currentPrice)) * 100);
                messages.push(`🧠 Велика знижка\n${name}\nЗараз: ${currentPrice} ₴ · на ${discount}% нижче звичайної ціни.`);
            }

            if (messages.length) {
                const slug = product?.slug && (!alternativeMessageAdded || messages.length > 1)
                    ? `\nhttps://silpo.ua/product/${product.slug}`
                    : '';
                await sendMessage(tgId, `${messages.join('\n\n')}${slug}`);
                notifications++;
                if (target && settings.price_target && currentPrice <= targetPrice) {
                    await db.prepare('UPDATE user_favorites SET target_price = 0 WHERE tg_id = ? AND product_id = ?')
                        .run(tgId, target.product_id);
                }
            }

            await db.prepare(`
                INSERT INTO user_product_state
                    (tg_id, product_id, current_price, in_stock, has_promo, is_personal_promo, delivery_available, is_smart_buy, alternative_price, alternative_product_id, alternative_slug, alternative_comparison_price)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(tg_id, product_id) DO UPDATE SET
                    current_price = excluded.current_price,
                    in_stock = excluded.in_stock,
                    has_promo = excluded.has_promo,
                    is_personal_promo = excluded.is_personal_promo,
                    delivery_available = excluded.delivery_available,
                    is_smart_buy = excluded.is_smart_buy,
                    alternative_price = excluded.alternative_price,
                    alternative_product_id = excluded.alternative_product_id,
                    alternative_slug = excluded.alternative_slug,
                    alternative_comparison_price = excluded.alternative_comparison_price,
                    last_checked = CURRENT_TIMESTAMP
            `).run(
                tgId, productId, currentPrice, available ? 1 : 0, hasPromo ? 1 : 0,
                0, deliveryAvailable ? 1 : 0, smartBuy ? 1 : 0,
                alternativePrice, alternative?.productId || null, alternative?.slug || null,
                alternative?.comparisonPrice || null
            );
        }

        return { checked: true, notifications, products: liveFavorites.length };
    } catch (error: any) {
        console.error(`[Notifications] User ${tgId} check failed:`, error);
        return { checked: false, notifications: 0, products: 0, error: error?.message || 'Check failed' };
    }
}
