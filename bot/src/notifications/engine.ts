import db from '../db/index';
import { callMCPTool } from '../api/mcp-direct';

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
        for (const key of ['items', 'products', 'favorites', 'replacements', 'alternatives', 'data', 'result']) {
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

function personalPromoOf(product: any): boolean {
    return boolValue(firstValue(product, ['personalPromo', 'personal_promo', 'isPersonalPromo', 'personalOffer']));
}

function deliveryAvailableOf(product: any): boolean {
    const explicit = firstValue(product, ['deliveryAvailable', 'delivery_available', 'isDeliveryAvailable']);
    if (explicit !== undefined) return boolValue(explicit);
    return product?.available !== undefined ? boolValue(product.available) : true;
}

type Measurement = { quantity: number; kind: 'weight' | 'volume' | 'count'; label: string };
type Alternative = {
    productId: string;
    name: string;
    price: number;
    comparisonPrice: number;
    comparisonLabel?: string;
    slug: string;
};

function measurementOf(product: any): Measurement | null {
    const raw = firstValue(product, ['displayWeight', 'display_weight', 'weight', 'weightText', 'unit', 'unitName']);
    if (raw === undefined || raw === null) return null;
    const value = String(raw).trim().toLowerCase().replace(',', '.');
    const match = value.match(/(\d+(?:\.\d+)?)\s*(\u043a\u0433|kg|\u0433|gr|g|\u043b|l|\u043c\u043b|ml|\u0448\u0442|pcs?|pc)(?=$|\s|\)|\/)/i);
    if (!match) return null;

    const quantity = Number(match[1]);
    if (!Number.isFinite(quantity) || quantity <= 0) return null;
    const unit = match[2].toLowerCase();
    if (['\u043a\u0433', 'kg'].includes(unit)) return { quantity, kind: 'weight', label: '\u043a\u0433' };
    if (['\u0433', 'gr', 'g'].includes(unit)) return { quantity: quantity / 1000, kind: 'weight', label: '\u043a\u0433' };
    if (['\u043b', 'l'].includes(unit)) return { quantity, kind: 'volume', label: '\u043b' };
    if (['\u043c\u043b', 'ml'].includes(unit)) return { quantity: quantity / 1000, kind: 'volume', label: '\u043b' };
    return { quantity, kind: 'count', label: '\u0448\u0442' };
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

function hasCompatibleCategory(current: any, candidate: any): boolean {
    const currentCategory = firstValue(current, ['categoryId', 'category_id', 'categorySlug']);
    const candidateCategory = firstValue(candidate, ['categoryId', 'category_id', 'categorySlug']);
    return currentCategory === undefined || currentCategory === null
        || candidateCategory === undefined || candidateCategory === null
        || String(currentCategory) === String(candidateCategory);
}

function alternativeFromProduct(current: any, candidate: any, context: { branchId: string; deliveryType: string }): Alternative | null {
    const currentIds = new Set(productIdCandidates(current));
    const candidateIds = productIdCandidates(candidate);
    const productId = candidateIds[0];
    const slug = firstValue(candidate, ['slug', 'productSlug']);
    const price = priceOf(candidate);
    if (!productId || !slug || price <= 0) return null;
    if (candidateIds.some(id => currentIds.has(id))) return null;
    if (!hasSameContext(candidate, context) || !hasCompatibleCategory(current, candidate)
        || !currentAvailability(candidate) || !deliveryAvailableOf(candidate)) return null;

    const currentMeasurement = measurementOf(current);
    const alternativeMeasurement = measurementOf(candidate);
    if (Boolean(currentMeasurement) !== Boolean(alternativeMeasurement)) return null;
    if (currentMeasurement && alternativeMeasurement) {
        if (currentMeasurement.kind !== alternativeMeasurement.kind) return null;
        const currentComparison = priceOf(current) / currentMeasurement.quantity;
        const alternativeComparison = price / alternativeMeasurement.quantity;
        if (!(alternativeComparison < currentComparison)) return null;
        return {
            productId,
            name: String(firstValue(candidate, ['name', 'title', 'productName']) || productId),
            price,
            comparisonPrice: alternativeComparison,
            comparisonLabel: alternativeMeasurement.label,
            slug: String(slug),
        };
    }

    if (!(price < priceOf(current))) return null;
    return {
        productId,
        name: String(firstValue(candidate, ['name', 'title', 'productName']) || productId),
        price,
        comparisonPrice: price,
        slug: String(slug),
    };
}

async function getAlternative(token: string, context: { branchId: string; deliveryType: string }, product: any): Promise<Alternative | null> {
    const candidates: any[] = [];
    const productId = firstValue(product, ['id', 'product_id', 'productId']);
    const companyId = firstValue(product, ['companyId', 'company_id', 'companyID']);

    if (productId && companyId) {
        const replacements = await callMCPTool(token, 'silpo_get_replacements', {
            branchId: context.branchId,
            companyId: String(companyId),
            productIds: [String(productId)],
            deliveryType: context.deliveryType
        });
        candidates.push(...getProductCandidates(parseMcpContent(replacements)));
    }

    const slug = firstValue(product, ['slug', 'productSlug']);
    if (slug) {
        const similar = await callMCPTool(token, 'silpo_get_similar_products', {
            branchId: context.branchId,
            slug: String(slug),
            deliveryType: context.deliveryType,
            limit: 20,
            offset: 0
        });
        candidates.push(...getProductCandidates(parseMcpContent(similar)));
    }

    const verified = candidates
        .map(candidate => alternativeFromProduct(product, candidate, context))
        .filter((candidate): candidate is Alternative => Boolean(candidate));
    return verified.sort((left, right) => left.comparisonPrice - right.comparisonPrice)[0] || null;
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
        let personalPromoIds = new Set<string>();
        if (settings.promo_personal) {
            const personalPromos = await callMCPTool(user.mcp_token, 'silpo_get_my_promos');
            const promos = getFavorites(parseMcpContent(personalPromos));
            personalPromoIds = new Set(
                promos.flatMap(p => [p?.id, p?.productId, p?.product_id, p?.slug]).filter(Boolean).map(String)
            );
        }
        let notifications = 0;

        for (const product of liveFavorites) {
            const productIds = productIdCandidates(product);
            const productId = productIds[0];
            if (!productId) continue;

            const currentPrice = priceOf(product);
            if (currentPrice <= 0) continue;
            const available = currentAvailability(product);
            const hasPromo = promoOf(product);
            const personalPromo = personalPromoOf(product) || productIds.some(id => personalPromoIds.has(id));
            const deliveryAvailable = deliveryAvailableOf(product);
            const smartBuy = smartBuyOf(product);
            let alternative: Alternative | null = null;
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
                messages.push(`🎯 Цільова ціна досягнута\n${name}\nЗараз: ${currentPrice} ₴ · ваша стеля: ${targetPrice} ₴`);
            }
            if (settings.price_drop && previous && currentPrice < Number(previous.current_price || 0)) {
                messages.push(`📉 Ціна знизилась\n${name}\nБуло: ${previous.current_price} ₴ · зараз: ${currentPrice} ₴`);
            }
            if (settings.promo_new && previous && !boolValue(previous.has_promo) && hasPromo) {
                messages.push(`🔥 Нова акція\n${name}\nЗараз: ${currentPrice} ₴`);
            }
            if (settings.promo_personal && previous && !boolValue(previous.is_personal_promo) && personalPromo) {
                messages.push(`⭐ Персональна пропозиція\n${name}\nЗараз: ${currentPrice} ₴`);
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
                const currentMeasurement = measurementOf(product);
                const comparison = currentMeasurement && alternative.comparisonLabel
                    ? `\nЦіна за ${alternative.comparisonLabel}: ${alternative.comparisonPrice.toFixed(2)} ₴ (цей товар: ${(currentPrice / currentMeasurement.quantity).toFixed(2)} ₴)`
                    : '';
                messages.push(`💡 Дешевший схожий товар\n${name}: ${currentPrice} ₴\n${alternative.name}: ${alternative.price} ₴${comparison}\nhttps://silpo.ua/product/${alternative.slug}`);
                alternativeMessageAdded = true;
            }
            if (settings.smart_buy && smartBuy && !boolValue(previous?.is_smart_buy)) {
                messages.push(`🧠 Smart Buy\n${name}\nЦіна виглядає вигідною відносно історії.`);
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
                personalPromo ? 1 : 0, deliveryAvailable ? 1 : 0, smartBuy ? 1 : 0,
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
