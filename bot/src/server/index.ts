import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import path from 'path';
import db from '../db/index';
import { MCP_BASE, callMCPTool } from '../api/mcp-direct';
import { profileIdentityFromMcp } from '../api/mcp-profile';
import { getStoreContext, listBranches, parseMcpContent, publicStoreLabel } from '../api/store-context';
import { getUserStoreContext } from '../api/user-store-context';
import { getMonitoringFavorites } from '../api/monitoring-favorites';
import { sendTelegramMessage } from '../api/telegram';
import { runUserCheck } from '../notifications/engine';
import { clearTelegramSession, requireTelegramWebApp } from '../auth/telegram';

const app = express();
app.use(cors());
app.use(express.json());
app.get('/health', (_req, res) => res.json({ status: 'ok', checkedAt: new Date().toISOString() }));
app.use('/api', requireTelegramWebApp);
app.use('/auth/start', requireTelegramWebApp);

// ── OAuth 2.1 PKCE State ────────────────────────────────────────────
let oauthState: {
    client_id: string;
    code_verifier: string;
    state: string;
    tg_id: number;
} | null = null;

// Store tokens per tg_id
const userTokens: Map<number, string> = new Map();

async function tokenForUser(tgId: number): Promise<string | null> {
    const cached = userTokens.get(tgId);
    if (cached) return cached;
    const user = await db.prepare('SELECT mcp_token FROM users WHERE tg_id = ?').get(tgId) as any;
    const token = user?.mcp_token ? String(user.mcp_token) : '';
    if (token) userTokens.set(tgId, token);
    return token || null;
}

function firstMcpRoot(response: any): any {
    return parseMcpContent(response)[0] || {};
}

function deliveryTypeOrDefault(value: unknown): string {
    const normalized = String(value || '');
    return normalized.startsWith('Delivery') || ['SelfPickup', 'JustIn', 'LongDelivery'].includes(normalized)
        ? normalized
        : 'DeliveryHome';
}

// ── Helper: PKCE ────────────────────────────────────────────────────
function generateCodeVerifier(): string {
    return crypto.randomBytes(32).toString('base64url');
}
function generateCodeChallenge(verifier: string): string {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// ── Step 1: Register client & start OAuth ───────────────────────────
app.get('/auth/start', async (req, res) => {
    const tgId = Number(req.query.tg_id);
    if (!tgId) return res.status(400).json({ error: 'Missing tg_id' });

    try {
        const callbackUrl = `${getBaseUrl(req)}/auth/callback`;

        // Dynamic Client Registration
        const regResp = await fetch(`${MCP_BASE}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_name: 'Цінолов Bot',
                redirect_uris: [callbackUrl],
                grant_types: ['authorization_code'],
                response_types: ['code'],
                token_endpoint_auth_method: 'none',
            }),
        });
        const regData = await regResp.json();
        console.log('[OAuth] Registered client:', regData.client_id);

        // Generate PKCE
        const code_verifier = generateCodeVerifier();
        const code_challenge = generateCodeChallenge(code_verifier);
        const state = crypto.randomBytes(16).toString('hex');

        oauthState = { client_id: regData.client_id, code_verifier, state, tg_id: tgId };

        // Build authorize URL
        const authUrl = new URL(`${MCP_BASE}/authorize`);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('client_id', regData.client_id);
        authUrl.searchParams.set('redirect_uri', callbackUrl);
        authUrl.searchParams.set('code_challenge', code_challenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
        authUrl.searchParams.set('state', state);

        console.log('[OAuth] Auth URL:', authUrl.toString());
        res.redirect(authUrl.toString());
    } catch (err) {
        console.error('[OAuth] Registration failed:', err);
        res.status(500).json({ error: 'OAuth registration failed' });
    }
});

// ── Step 2: Handle OAuth Callback ───────────────────────────────────
app.get('/auth/callback', async (req, res) => {
    const { code, state } = req.query;

    if (!oauthState || state !== oauthState.state) {
        return res.status(400).send('Invalid state parameter');
    }

    try {
        const callbackUrl = `${getBaseUrl(req)}/auth/callback`;

        // Exchange authorization code for token
        const tokenResp = await fetch(`${MCP_BASE}/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: oauthState.client_id,
                code: code as string,
                redirect_uri: callbackUrl,
                code_verifier: oauthState.code_verifier,
            }).toString(),
        });

        const tokenData = await tokenResp.json();
        console.log('[OAuth] Got token for tg_id:', oauthState.tg_id);

        // Store token
        userTokens.set(oauthState.tg_id, tokenData.access_token);

        // Store in DB
        await db.prepare(`
            INSERT INTO users (tg_id, mcp_token)
            VALUES (?, ?)
            ON CONFLICT(tg_id) DO UPDATE SET mcp_token = excluded.mcp_token
        `).run(oauthState.tg_id, tokenData.access_token);

        oauthState = null;

        // Seamless redirect back to the Telegram Web App UI
        res.redirect('/');
    } catch (err) {
        console.error('[OAuth] Token exchange failed:', err);
        res.status(500).send('Token exchange failed');
    }
});

// ── MCP Tool Call Helper ────────────────────────────────────────────
// ── API: Logout ─────────────────────────────────────────────────────
app.post('/api/auth/logout', async (req, res) => {
    const tgId = Number(req.body.tg_id);
    if (!tgId) return res.status(400).json({ error: 'Missing tg_id' });
    
    userTokens.delete(tgId);
    await db.prepare('UPDATE users SET mcp_token = NULL WHERE tg_id = ?').run(tgId);
    clearTelegramSession(res);
    res.json({ success: true });
});

// ── API: Get Profile & Active Store ─────────────────────────────────
app.get('/api/user/profile', async (req, res) => {
    const tgId = Number(req.query.tg_id);
    if (!tgId) return res.status(400).json({ error: 'Missing tg_id' });

    let token = userTokens.get(tgId);
    if (!token) {
        const user = await db.prepare('SELECT mcp_token FROM users WHERE tg_id = ?').get(tgId) as any;
        const storedToken = user?.mcp_token as string | undefined;
        if (storedToken) { token = storedToken; userTokens.set(tgId, storedToken); }
    }
    if (!token) return res.status(401).json({ authenticated: false });

    try {
        // 1. Fetch Profile
        let name = '';
        let avatar = '';
        try {
            const profileResp = await callMCPTool(token, 'silpo_get_my_profile', {});
            ({ name, avatar } = profileIdentityFromMcp(profileResp));
        } catch (error) {
            console.warn('[MCP] Profile identity unavailable, using Telegram fallback:', error);
        }

        // 2. Resolve the active cart's public store. Never expose the user's delivery address.
        const store = await getUserStoreContext(tgId, token);
        res.json({ authenticated: true, name, avatar, ...store, checkedAt: new Date().toISOString() });
    } catch (err) {
        console.error('[MCP] Store context fetch failed:', err);
        res.status(502).json({ error: 'Silpo store context is temporarily unavailable' });
    }
});

// ── API: Get real favorites from MCP ────────────────────────────────
app.get('/api/favorites', async (req, res) => {
    const tgId = Number(req.query.tg_id);
    if (!tgId) return res.status(400).json({ error: 'Missing tg_id' });

    // Check if user has a token
    let token = userTokens.get(tgId);
    if (!token) {
        // Try DB
        const user = await db.prepare('SELECT mcp_token FROM users WHERE tg_id = ?').get(tgId) as any;
        if (user?.mcp_token) {
            token = user.mcp_token;
            userTokens.set(tgId, token!);
        }
    }

    if (!token) {
        return res.json({ authenticated: false, favorites: [], message: 'Потрібно підключити акаунт Сільпо' });
    }

    try {
        const context = await getUserStoreContext(tgId, token);
        const monitoring = await getMonitoringFavorites(token, context);
        let favorites = monitoring.products;
        // Merge with DB targets
        const userFavs = await db.prepare('SELECT product_id, target_price FROM user_favorites WHERE tg_id = ?').all(tgId) as any[];
        const targetMap = new Map();
        userFavs.forEach(uf => targetMap.set(uf.product_id, uf.target_price));

        if (Array.isArray(favorites)) {
            favorites = favorites.map(f => {
                const pid = f.id || f.product_id || f.productId || f.slug;
                return {
                    ...f,
                    target_price: targetMap.get(pid) || 0
                };
            });
        }
        res.json({
            authenticated: true,
            favorites,
            checkedAt: new Date().toISOString(),
            availabilityReliable: monitoring.availabilityReliable,
            availabilityBasis: monitoring.availabilityBasis,
            availabilityCheckedFor: monitoring.checkedFor,
            store: context,
        });
    } catch (err) {
        console.error('[MCP] Favorites fetch failed:', err);
        res.status(502).json({ authenticated: true, favorites: [], error: 'MCP call failed' });
    }
});

// ── API: Settings ───────────────────────────────────────────────────
app.get('/api/settings', async (req, res) => {
    const tgId = req.query.tg_id;
    if (!tgId) return res.status(400).json({ error: 'Missing tg_id' });

    let settings = await db.prepare('SELECT * FROM user_settings WHERE tg_id = ?').get(tgId);
    if (!settings) {
        await db.prepare('INSERT OR IGNORE INTO users (tg_id) VALUES (?)').run(tgId);
        await db.prepare('INSERT OR IGNORE INTO user_settings (tg_id) VALUES (?)').run(tgId);
        settings = await db.prepare('SELECT * FROM user_settings WHERE tg_id = ?').get(tgId);
    }
    res.json(settings);
});

app.post('/api/settings', async (req, res) => {
    const { tg_id, ...updates } = req.body;
    if (!tg_id) return res.status(400).json({ error: 'Missing tg_id' });

    await db.prepare('INSERT OR IGNORE INTO users (tg_id) VALUES (?)').run(tg_id);
    await db.prepare('INSERT OR IGNORE INTO user_settings (tg_id) VALUES (?)').run(tg_id);

    for (const [key, value] of Object.entries(updates)) {
        if (['price_drop', 'price_target', 'promo_new', 'promo_personal', 'in_stock', 'delivery_available', 'alt_cheaper', 'smart_buy', 'onboarding_completed'].includes(key)) {
        await db.prepare(`UPDATE user_settings SET ${key} = ? WHERE tg_id = ?`).run(value ? 1 : 0, tg_id);
        }
    }
    res.json({ success: true });
});

// ── API: Monitoring store selection ─────────────────────────────────
app.get('/api/stores/options', async (req, res) => {
    const tgId = Number(req.query.tg_id);
    if (!tgId) return res.status(400).json({ error: 'Missing tg_id' });
    const token = await tokenForUser(tgId);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const [current, accountDefault, ordersResponse, addressesResponse] = await Promise.all([
            getUserStoreContext(tgId, token),
            getStoreContext(token),
            callMCPTool(token, 'silpo_get_my_online_orders', { limit: 10, offset: 0 }).catch(() => null),
            callMCPTool(token, 'silpo_get_my_delivery_addresses', {}).catch(() => null),
        ]);

        const ordersRoot = ordersResponse ? firstMcpRoot(ordersResponse) : {};
        const orders = Array.isArray(ordersRoot?.orders) ? ordersRoot.orders : [];
        const recentSeeds = new Map<string, { branchId: string; deliveryType: string }>();
        for (const order of orders) {
            const product = Array.isArray(order?.products) ? order.products.find((item: any) => item?.branchId) : null;
            const branchId = String(product?.branchId || order?.branchId || '');
            if (!branchId || recentSeeds.has(branchId)) continue;
            recentSeeds.set(branchId, { branchId, deliveryType: deliveryTypeOrDefault(order?.delivery?.type) });
            if (recentSeeds.size >= 4) break;
        }
        const recent = await Promise.all([...recentSeeds.values()].map(seed => getStoreContext(token, seed)));

        const addressesRoot = addressesResponse ? firstMcpRoot(addressesResponse) : {};
        const savedAddresses = Array.isArray(addressesRoot)
            ? addressesRoot
            : addressesRoot?.items || addressesRoot?.addresses || addressesRoot?.data || [];
        const addressOptions = (await Promise.all(savedAddresses.slice(0, 6).map(async (address: any) => {
            const latitude = Number(address?.latitude);
            const longitude = Number(address?.longitude);
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
            const response = await callMCPTool(token, 'silpo_get_available_delivery_types', { latitude, longitude });
            const root = firstMcpRoot(response);
            const option = Array.isArray(root?.options)
                ? root.options.find((item: any) => item?.deliveryType === 'DeliveryHome' && item?.branchId)
                : null;
            if (!option?.branchId) return null;
            const store = await getStoreContext(token, { branchId: String(option.branchId), deliveryType: 'DeliveryHome' });
            return {
                ...store,
                addressLabel: [address?.tag, address?.city, address?.street, address?.building].filter(Boolean).join(' · '),
            };
        }))).filter(Boolean);

        res.json({ current, accountDefault, recent, addresses: addressOptions });
    } catch (error) {
        console.error('[Stores] Failed to load options:', error);
        res.status(502).json({ error: 'Failed to load store options' });
    }
});

app.get('/api/stores/search', async (req, res) => {
    const tgId = Number(req.query.tg_id);
    const query = String(req.query.q || '').trim().toLocaleLowerCase('uk-UA');
    if (!tgId || query.length < 2) return res.json({ stores: [] });
    const token = await tokenForUser(tgId);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const branches = await listBranches(token);
        const stores = branches
            .map(branch => ({
                branchId: String(branch?.branchId || branch?.id || ''),
                deliveryType: 'SelfPickup',
                storeLabel: publicStoreLabel(branch),
                city: String(branch?.city || branch?.locality || ''),
                address: String(branch?.address || branch?.streetAddress || ''),
            }))
            .filter(store => store.branchId && `${store.city} ${store.address} ${store.storeLabel}`.toLocaleLowerCase('uk-UA').includes(query))
            .slice(0, 20);
        res.json({ stores });
    } catch (error) {
        console.error('[Stores] Search failed:', error);
        res.status(502).json({ error: 'Store search failed' });
    }
});

app.post('/api/stores/select', async (req, res) => {
    const tgId = Number(req.body.tg_id);
    const branchId = String(req.body.branchId || '');
    const deliveryType = deliveryTypeOrDefault(req.body.deliveryType || 'SelfPickup');
    if (!tgId || !branchId) return res.status(400).json({ error: 'Missing store parameters' });
    const token = await tokenForUser(tgId);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const accountDefault = await getStoreContext(token);
        if (accountDefault.branchId === branchId && accountDefault.deliveryType.toLowerCase() === deliveryType.toLowerCase()) {
            await db.prepare(`
                UPDATE users SET monitor_branch_id = NULL, monitor_delivery_type = NULL, monitor_store_label = NULL WHERE tg_id = ?
            `).run(tgId);
            return res.json({ success: true, store: accountDefault });
        }
        const context = await getStoreContext(token, { branchId, deliveryType });
        await db.prepare(`
            UPDATE users SET monitor_branch_id = ?, monitor_delivery_type = ?, monitor_store_label = ? WHERE tg_id = ?
        `).run(context.branchId, context.deliveryType, context.storeLabel, tgId);
        res.json({ success: true, store: context });
    } catch (error) {
        console.error('[Stores] Selection failed:', error);
        res.status(502).json({ error: 'Store selection failed' });
    }
});

app.post('/api/favorites/target', async (req, res) => {
    const { tg_id, product_id, target_price, name, current_price, old_price, image_url, has_promo } = req.body;
    if (!tg_id || !product_id || target_price === undefined) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    const numericTarget = Number(target_price);
    if (!Number.isFinite(numericTarget) || numericTarget < 0) {
        return res.status(400).json({ error: 'target_price must be a non-negative number' });
    }

    try {
        await db.prepare('INSERT OR IGNORE INTO users (tg_id) VALUES (?)').run(tg_id);
        await db.prepare('INSERT OR IGNORE INTO user_settings (tg_id) VALUES (?)').run(tg_id);

        // user_favorites references products_state, so the product snapshot must exist first.
        await db.prepare(`
            INSERT INTO products_state (product_id, name, current_price, old_price, in_stock, has_promo, image_url)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(product_id) DO UPDATE SET
                name = COALESCE(excluded.name, products_state.name),
                current_price = COALESCE(excluded.current_price, products_state.current_price),
                old_price = COALESCE(excluded.old_price, products_state.old_price),
                has_promo = COALESCE(excluded.has_promo, products_state.has_promo),
                image_url = COALESCE(excluded.image_url, products_state.image_url),
                last_checked = CURRENT_TIMESTAMP
        `).run(
            String(product_id),
            name || null,
            Number.isFinite(Number(current_price)) ? Number(current_price) : null,
            Number.isFinite(Number(old_price)) ? Number(old_price) : null,
            1,
            has_promo ? 1 : 0,
            image_url || null
        );

        await db.prepare(`
            INSERT INTO user_favorites (tg_id, product_id, target_price)
            VALUES (?, ?, ?)
            ON CONFLICT(tg_id, product_id) DO UPDATE SET target_price = excluded.target_price
        `).run(tg_id, String(product_id), numericTarget);

        if (numericTarget === 0) {
            return res.json({ success: true, notificationSent: false });
        }

        const result = await runUserCheck(Number(tg_id), sendTelegramMessage);
        const savedTarget = await db.prepare(
            'SELECT target_price FROM user_favorites WHERE tg_id = ? AND product_id = ?'
        ).get(tg_id, String(product_id)) as any;
        const targetWasReached = Number(savedTarget?.target_price || 0) === 0;
        res.json({
            success: true,
            notificationSent: targetWasReached,
            checkError: result.error || undefined
        });
    } catch (error) {
        console.error('[Favorites] Failed to save target:', error);
        res.status(500).json({ error: 'Failed to save target price' });
    }
});

// API: Add a favorite product to the Silpo cart
app.post('/api/cart/add', async (req, res) => {
    const { tg_id, product_id, companyId, branchId, quantity = 1 } = req.body;
    if (!tg_id || !product_id || !companyId || !branchId) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    let token = userTokens.get(Number(tg_id));
    if (!token) {
        const user = await db.prepare('SELECT mcp_token FROM users WHERE tg_id = ?').get(tg_id) as any;
        if (user?.mcp_token) {
            const storedToken = user.mcp_token as string;
            token = storedToken;
            userTokens.set(Number(tg_id), storedToken);
        }
    }
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const cartResponse = await callMCPTool(token, 'silpo_get_my_shopping_cart');
        let shoppingCartId: string | undefined;
        for (const item of cartResponse?.result?.content || []) {
            if (item?.type !== 'text') continue;
            try {
                const parsed = JSON.parse(item.text);
                shoppingCartId = parsed.shoppingCartId || parsed.cartId || parsed.id;
            } catch { /* ignore non-JSON MCP content */ }
        }
        if (!shoppingCartId) throw new Error('MCP did not return shopping cart id');

        await callMCPTool(token, 'silpo_add_or_update_cart_products', {
            shoppingCartId: String(shoppingCartId),
            products: [{
                productId: String(product_id),
                companyId: String(companyId),
                branchId: String(branchId),
                quantity: Number(quantity) > 0 ? Number(quantity) : 1,
                addQuantity: true
            }]
        });
        res.json({ success: true });
    } catch (error) {
        console.error('[Cart] Failed to add product:', error);
        res.status(502).json({ error: 'Failed to add product to cart' });
    }
});

app.post('/api/cart/add-batch', async (req, res) => {
    const tgId = Number(req.body.tg_id);
    const products = Array.isArray(req.body.products) ? req.body.products.slice(0, 20) : [];
    if (!tgId || !products.length) return res.status(400).json({ error: 'Missing products' });
    const token = await tokenForUser(tgId);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const context = await getUserStoreContext(tgId, token);
        if (!context.orderMinimum) {
            return res.status(409).json({ error: 'Batch cart is available only for the active Silpo delivery context' });
        }
        const cartRoot = firstMcpRoot(await callMCPTool(token, 'silpo_get_my_shopping_cart', {}));
        const shoppingCartId = cartRoot?.shoppingCartId || cartRoot?.cartId || cartRoot?.id;
        if (!shoppingCartId) throw new Error('MCP did not return shopping cart id');
        const normalized = products.map((product: any) => ({
            productId: String(product?.product_id || ''),
            companyId: String(product?.companyId || ''),
            branchId: context.branchId,
            quantity: Number(product?.quantity) > 0 ? Number(product.quantity) : 1,
            addQuantity: true,
        })).filter((product: any) => product.productId && product.companyId);
        if (!normalized.length) return res.status(400).json({ error: 'No valid products' });
        await callMCPTool(token, 'silpo_add_or_update_cart_products', {
            shoppingCartId: String(shoppingCartId),
            products: normalized,
        });
        res.json({ success: true, added: normalized.length });
    } catch (error) {
        console.error('[Cart] Failed to add deal basket:', error);
        res.status(502).json({ error: 'Failed to add deal basket' });
    }
});

// ── API: Remove from Favorites ──────────────────────────────────────
app.post('/api/favorites/remove', async (req, res) => {
    const { tg_id, product_id, slug } = req.body;
    if (!tg_id || !product_id) return res.status(400).json({ error: 'Missing parameters' });

    let token = userTokens.get(tg_id);
    if (!token) {
        const user = await db.prepare('SELECT mcp_token FROM users WHERE tg_id = ?').get(tg_id) as any;
        const storedToken = user?.mcp_token as string | undefined;
        if (storedToken) { token = storedToken; userTokens.set(Number(tg_id), storedToken); }
    }
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const externalProductId = slug ? parseInt(slug.split('-').pop() || '0', 10) : 0;
        
        // Remove from MCP
        await callMCPTool(token, 'silpo_add_or_update_favorite_products', {
            actions: [{ productId: product_id, externalProductId: isNaN(externalProductId) ? 0 : externalProductId, toDelete: true }]
        });
        // Remove from local DB
        await db.prepare('DELETE FROM user_favorites WHERE tg_id = ? AND product_id = ?').run(tg_id, product_id);
        res.json({ success: true });
    } catch (e) {
        console.error('Failed to remove favorite:', e);
        res.status(500).json({ error: 'Failed to remove from favorites' });
    }
});

// ── Auth status check ───────────────────────────────────────────────
app.get('/api/auth/status', async (req, res) => {
    const tgId = Number(req.query.tg_id);
    if (!tgId) return res.status(400).json({ error: 'Missing tg_id' });

    let token = userTokens.get(tgId);
    if (!token) {
        const user = await db.prepare('SELECT mcp_token FROM users WHERE tg_id = ?').get(tgId) as any;
        if (user?.mcp_token) token = user.mcp_token;
    }
    res.json({ authenticated: !!token });
});

// ── Helper: Get base URL ────────────────────────────────────────────
function getBaseUrl(req: express.Request): string {
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return `${proto}://${host}`;
}

// ── Serve webapp static files ───────────────────────────────────────
const webappDist = path.resolve(__dirname, '../../../webapp/dist');
app.use(express.static(webappDist));
app.get(/.*/, (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/auth')) return next();
    res.sendFile(path.join(webappDist, 'index.html'));
});

export const startServer = (port = Number(process.env.PORT) || 3000) => {
    const host = process.env.SERVER_HOST || '127.0.0.1';
    app.listen(port, host, () => {
        console.log(`✅ API Server is running on port ${port}`);
    });
};
