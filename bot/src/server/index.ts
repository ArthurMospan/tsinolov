import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import path from 'path';
import db from '../db/index';
import { MCP_BASE, callMCPTool } from '../api/mcp-direct';
import { profileIdentityFromMcp } from '../api/mcp-profile';
import {
    fulfillmentMode,
    getStoreContext,
    listBranches,
    parseMcpContent,
    publicDeliveryAddressLabel,
    publicStoreLabel,
    type StoreContext,
} from '../api/store-context';
import { getUserStoreContext } from '../api/user-store-context';
import { getMonitoringFavorites, productAvailability, productAvailabilityReason } from '../api/monitoring-favorites';
import { isFavoriteProduct, searchSilpoProducts } from '../api/product-search';
import { getCatalogCategories, getCatalogProducts } from '../api/product-catalog';
import { enrichProductsWithDetails } from '../api/product-details';
import { productPresentation } from '../api/product-presentation';
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

function savedAddressItems(response: any): any[] {
    const root = firstMcpRoot(response);
    if (Array.isArray(root)) return root;
    if (Array.isArray(root?.items)) return root.items;
    if (Array.isArray(root?.addresses)) return root.addresses;
    if (Array.isArray(root?.data)) return root.data;
    return [];
}

function coordinatesOf(value: any): { latitude: number; longitude: number } | null {
    const latitudeValue = value?.latitude ?? value?.lat ?? value?.location?.latitude ?? value?.location?.lat
        ?? value?.coordinates?.latitude ?? value?.coordinates?.lat ?? value?.position?.lat ?? value?.geo?.lat;
    const longitudeValue = value?.longitude ?? value?.lng ?? value?.lon ?? value?.location?.longitude ?? value?.location?.lng ?? value?.location?.lon
        ?? value?.coordinates?.longitude ?? value?.coordinates?.lng ?? value?.coordinates?.lon ?? value?.position?.lng ?? value?.position?.lon ?? value?.geo?.lng ?? value?.geo?.lon;
    if (latitudeValue === undefined || latitudeValue === null || latitudeValue === ''
        || longitudeValue === undefined || longitudeValue === null || longitudeValue === '') return null;
    const latitude = Number(latitudeValue);
    const longitude = Number(longitudeValue);
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

function isLikelyActiveAddress(address: any): boolean {
    return [address?.isSelected, address?.selected, address?.isActive, address?.active, address?.isDefault]
        .some(value => value === true || value === 1 || value === 'true');
}

const deliveryBranchCache = new Map<string, { expiresAt: number; branchId: string; deliveryType: string }>();

async function deliveryOptionForAddress(token: string, address: any): Promise<any | null> {
    const coordinates = coordinatesOf(address);
    const addressLabel = publicDeliveryAddressLabel(address);
    if (!coordinates || !addressLabel) return null;
    const cacheKey = `${coordinates.latitude.toFixed(5)}:${coordinates.longitude.toFixed(5)}`;
    let resolved = deliveryBranchCache.get(cacheKey);
    if (!resolved || resolved.expiresAt <= Date.now()) {
        const response = await callMCPTool(token, 'silpo_get_available_delivery_types', coordinates);
        const root = firstMcpRoot(response);
        const options = Array.isArray(root?.options) ? root.options : Array.isArray(root) ? root : [];
        const option = options.find((item: any) => item?.deliveryType === 'DeliveryHome' && item?.branchId)
            || options.find((item: any) => String(item?.deliveryType || '').startsWith('Delivery') && item?.branchId);
        if (!option?.branchId) return null;
        resolved = {
            branchId: String(option.branchId),
            deliveryType: deliveryTypeOrDefault(option.deliveryType),
            expiresAt: Date.now() + 10 * 60 * 1000,
        };
        deliveryBranchCache.set(cacheKey, resolved);
    }
    return {
        branchId: resolved.branchId,
        deliveryType: resolved.deliveryType,
        mode: 'delivery',
        contextLabel: addressLabel,
        storeLabel: addressLabel,
        addressLabel,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        source: 'saved',
        isLikelyActive: isLikelyActiveAddress(address),
    };
}

async function savedDeliveryOptions(token: string, response?: any): Promise<any[]> {
    const addressesResponse = response || await callMCPTool(token, 'silpo_get_my_delivery_addresses', {});
    const addresses = savedAddressItems(addressesResponse).slice(0, 8);
    return (await Promise.all(addresses.map(address => deliveryOptionForAddress(token, address).catch(() => null))))
        .filter(Boolean);
}

async function getResolvedUserStoreContext(tgId: number, token: string): Promise<StoreContext> {
    let context = await getUserStoreContext(tgId, token);
    if (context.contextSource === 'silpo' && context.mode === 'delivery' && context.selectionRequired) {
        context = withResolvedDeliveryAddress(context, await savedDeliveryOptions(token).catch(() => []));
    }
    return context;
}

function withResolvedDeliveryAddress(context: StoreContext, addresses: any[]): StoreContext {
    if (context.mode !== 'delivery' || !context.selectionRequired) return context;
    const matching = addresses.filter(option => option.branchId === context.branchId
        && String(option.deliveryType).toLowerCase() === context.deliveryType.toLowerCase());
    const address = matching.find(option => option.isLikelyActive) || (matching.length === 1 ? matching[0] : null);
    if (!address) return context;
    return {
        ...context,
        contextLabel: address.addressLabel,
        storeLabel: address.addressLabel,
        selectionRequired: false,
    };
}

function normalizedContextLabel(value: unknown): string {
    return String(value || '')
        .toLocaleLowerCase('uk-UA')
        .replace(/^(дім|робота|домівка|офіс)\s*[·:—-]\s*/u, '')
        .replace(/[.,]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function selectionMatchesCart(selected: StoreContext, cart: StoreContext): boolean {
    if (selected.branchId !== cart.branchId
        || selected.deliveryType.toLowerCase() !== cart.deliveryType.toLowerCase()) return false;
    if (selected.mode !== 'delivery' || selected.contextSource !== 'manual') return true;
    if (cart.selectionRequired) return false;
    const selectedLabel = normalizedContextLabel(selected.contextLabel);
    const cartLabel = normalizedContextLabel(cart.contextLabel);
    return selectedLabel === cartLabel || selectedLabel.endsWith(cartLabel) || cartLabel.endsWith(selectedLabel);
}

const geocodeCache = new Map<string, { expiresAt: number; items: any[] }>();
let geocodeQueue: Promise<void> = Promise.resolve();
let nextGeocodeRequestAt = 0;

function geocodedAddressLabel(item: any): string {
    const address = item?.address || {};
    const city = String(address.city || address.town || address.village || address.municipality || '').trim();
    const street = String(address.road || address.pedestrian || address.neighbourhood || address.suburb || '').trim();
    const building = String(address.house_number || '').trim();
    return [city, [street, building].filter(Boolean).join(', ')].filter(Boolean).join(', ')
        || String(item?.display_name || '').split(',').slice(0, 4).join(',').trim();
}

async function geocodeAddresses(query: string): Promise<any[]> {
    const normalized = query.trim().toLocaleLowerCase('uk-UA');
    const cached = geocodeCache.get(normalized);
    if (cached && cached.expiresAt > Date.now()) return cached.items;

    let releaseQueue!: () => void;
    const previousRequest = geocodeQueue;
    geocodeQueue = new Promise<void>(resolve => { releaseQueue = resolve; });
    await previousRequest;
    try {
        const refreshedCache = geocodeCache.get(normalized);
        if (refreshedCache && refreshedCache.expiresAt > Date.now()) return refreshedCache.items;
        const delay = Math.max(0, nextGeocodeRequestAt - Date.now());
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        nextGeocodeRequestAt = Date.now() + 1100;

        const params = new URLSearchParams({
            q: query,
            format: 'jsonv2',
            addressdetails: '1',
            countrycodes: 'ua',
            limit: '6',
            'accept-language': 'uk',
        });
        const baseUrl = process.env.GEOCODER_BASE_URL || 'https://nominatim.openstreetmap.org';
        const response = await fetch(`${baseUrl.replace(/\/$/, '')}/search?${params}`, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': `Tsinolov/1.0 (${process.env.WEBAPP_URL || 'https://tsinolov.onrender.com'})`,
            },
        });
        if (!response.ok) throw new Error(`Address search failed with ${response.status}`);
        const data = await response.json();
        const items = (Array.isArray(data) ? data : []).map((item: any) => ({
            mode: 'delivery',
            contextLabel: geocodedAddressLabel(item),
            storeLabel: geocodedAddressLabel(item),
            addressLabel: geocodedAddressLabel(item),
            latitude: Number(item?.lat),
            longitude: Number(item?.lon),
            source: 'search',
        })).filter((item: any) => item.addressLabel && Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
        geocodeCache.set(normalized, { expiresAt: Date.now() + 10 * 60 * 1000, items });
        return items;
    } finally {
        releaseQueue();
    }
}

function distanceKm(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }): number {
    const radius = 6371;
    const radians = (degrees: number) => degrees * Math.PI / 180;
    const latitudeDelta = radians(to.latitude - from.latitude);
    const longitudeDelta = radians(to.longitude - from.longitude);
    const a = Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
    return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pickupOption(branch: any, origin?: { latitude: number; longitude: number }): any | null {
    const branchId = String(branch?.branchId || branch?.id || '');
    if (!branchId) return null;
    const coordinates = coordinatesOf(branch);
    return {
        branchId,
        deliveryType: 'SelfPickup',
        mode: 'pickup',
        contextLabel: publicStoreLabel(branch),
        storeLabel: publicStoreLabel(branch),
        city: String(branch?.city || branch?.cityFull || branch?.locality || ''),
        address: String(branch?.address || branch?.addressFull || branch?.streetAddress || ''),
        latitude: coordinates?.latitude,
        longitude: coordinates?.longitude,
        distanceKm: origin && coordinates ? Number(distanceKm(origin, coordinates).toFixed(1)) : undefined,
        isOpen: typeof branch?.open === 'boolean' ? branch.open : null,
    };
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

        // 2. Resolve the user's delivery address or physical pickup store.
        // A fulfillment branch remains an internal pricing detail for delivery.
        const store = await getResolvedUserStoreContext(tgId, token);
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
        const context = await getResolvedUserStoreContext(tgId, token);
        const monitoring = await getMonitoringFavorites(token, context);
        let favorites = await enrichProductsWithDetails(token, context, monitoring.products, {
            authoritativeAvailability: true,
        });
        // Merge with DB targets
        const userFavs = await db.prepare('SELECT product_id, target_price FROM user_favorites WHERE tg_id = ?').all(tgId) as any[];
        const targetMap = new Map();
        userFavs.forEach(uf => targetMap.set(uf.product_id, uf.target_price));

        if (Array.isArray(favorites)) {
            favorites = favorites.map(f => {
                const pid = f.id || f.product_id || f.productId || f.slug;
                const availabilityReason = productAvailabilityReason(f);
                const availability = productAvailability(f);
                if (f.storeAvailability === true && (availabilityReason === 'expected' || availabilityReason === 'out_of_stock')) {
                    console.warn('[Availability] Negative product details override the favorites summary', {
                        product: String(f.slug || pid),
                        branchId: context.branchId,
                        reason: availabilityReason,
                    });
                }
                const {
                    storeAvailability: _internalStoreAvailability,
                    store_availability: _internalSnakeStoreAvailability,
                    ...favorite
                } = f;
                return {
                    ...favorite,
                    ...productPresentation(f),
                    in_stock: availability,
                    availability_reason: availabilityReason,
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

app.get('/api/catalog/categories', async (req, res) => {
    const tgId = Number(req.query.tg_id);
    if (!tgId) return res.status(400).json({ error: 'Missing tg_id' });
    const token = await tokenForUser(tgId);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const context = await getUserStoreContext(tgId, token);
        const categories = await getCatalogCategories(token, context);
        res.json({ categories, store: context });
    } catch (error) {
        console.error('[Catalog] Categories failed:', error);
        res.status(502).json({ error: 'Category catalog failed' });
    }
});

app.get('/api/catalog/products', async (req, res) => {
    const tgId = Number(req.query.tg_id);
    const categoryId = String(req.query.category_id || '').trim();
    const categorySlug = String(req.query.category_slug || '').trim();
    const categoryName = String(req.query.category_name || '').trim();
    const limit = Math.min(40, Math.max(1, Number(req.query.limit) || 30));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    if (!tgId) return res.status(400).json({ error: 'Missing tg_id' });
    if (!categoryId && !categorySlug) return res.status(400).json({ error: 'Missing category' });
    const token = await tokenForUser(tgId);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const context = await getUserStoreContext(tgId, token);
        const [catalogPage, favoritesResult] = await Promise.all([
            getCatalogProducts(token, context, {
                category: { id: categoryId || categorySlug, slug: categorySlug, name: categoryName },
                limit,
                offset,
            }),
            getMonitoringFavorites(token, context),
        ]);
        const fallback = catalogPage.products.length === 0 && offset === 0 && categoryName
            ? await searchSilpoProducts(token, context, categoryName, limit)
            : null;
        const page = fallback
            ? { ...fallback, hasMore: false, nextOffset: fallback.products.length }
            : catalogPage;
        const products = await enrichProductsWithDetails(token, context, page.products);
        res.json({
            ...page,
            products: products.map(product => ({
                ...product,
                ...productPresentation(product),
                in_stock: productAvailability(product),
                availability_reason: productAvailabilityReason(product),
                isFavorite: isFavoriteProduct(product, favoritesResult.products),
            })),
            store: context,
        });
    } catch (error) {
        console.error('[Catalog] Products failed:', error);
        res.status(502).json({ error: 'Category products failed' });
    }
});

app.get('/api/products/search', async (req, res) => {
    const tgId = Number(req.query.tg_id);
    const query = String(req.query.q || '').trim();
    const limit = Math.min(40, Math.max(1, Number(req.query.limit) || 24));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    if (!tgId) return res.status(400).json({ error: 'Missing tg_id' });
    if (query.length < 2) return res.json({ products: [] });
    if (query.length > 120) return res.status(400).json({ error: 'Search query is too long' });

    const token = await tokenForUser(tgId);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const context = await getUserStoreContext(tgId, token);
        const [searchResult, favoritesResult] = await Promise.allSettled([
            getCatalogProducts(token, context, { query, limit, offset })
                .catch(() => searchSilpoProducts(token, context, query, limit)),
            getMonitoringFavorites(token, context),
        ]);
        if (searchResult.status === 'rejected') throw searchResult.reason;
        const search = searchResult.value;
        const favorites = favoritesResult.status === 'fulfilled' ? favoritesResult.value.products : [];
        if (favoritesResult.status === 'rejected') {
            console.warn('[Products] Favorites unavailable while marking search results:', favoritesResult.reason);
        }
        const products = await enrichProductsWithDetails(token, context, search.products);
        res.json({
            products: products.map(product => ({
                ...product,
                ...productPresentation(product),
                in_stock: productAvailability(product),
                availability_reason: productAvailabilityReason(product),
                isFavorite: isFavoriteProduct(product, favorites),
            })),
            store: context,
            availabilityReliable: search.availabilityReliable,
            availabilityBasis: search.availabilityBasis,
            checkedFor: search.checkedFor,
            hasMore: 'hasMore' in search ? search.hasMore : false,
            nextOffset: 'nextOffset' in search ? search.nextOffset : search.products.length,
        });
    } catch (error) {
        console.error('[Products] Search failed:', error);
        res.status(502).json({ error: 'Product search failed' });
    }
});

app.post('/api/favorites/add', async (req, res) => {
    const tgId = Number(req.body.tg_id);
    const productId = String(req.body.product_id || '').trim();
    const externalProductId = Number(req.body.externalProductId ?? req.body.external_product_id);
    if (!tgId || !productId || !Number.isSafeInteger(externalProductId) || externalProductId <= 0) {
        return res.status(400).json({ error: 'Missing or invalid product identity' });
    }

    const token = await tokenForUser(tgId);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const product = { id: productId, externalProductId };
        try {
            const context = await getUserStoreContext(tgId, token);
            const monitoring = await getMonitoringFavorites(token, context);
            if (isFavoriteProduct(product, monitoring.products)) {
                return res.json({ success: true, alreadyFavorite: true, synced: true });
            }
        } catch (error) {
            // The Silpo operation is an upsert, so a temporary favorites-read
            // failure must not prevent a valid add request from succeeding.
            console.warn('[Favorites] Duplicate pre-check unavailable, continuing with official upsert:', error);
        }

        await callMCPTool(token, 'silpo_add_or_update_favorite_products', {
            actions: [{ productId, externalProductId, toDelete: false }],
        });
        res.json({ success: true, alreadyFavorite: false, synced: true });
    } catch (error) {
        console.error('[Favorites] Failed to add favorite:', error);
        res.status(502).json({ error: 'Failed to add to Silpo Favorites' });
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

// ── API: Delivery address and pickup selection ──────────────────────
app.get('/api/stores/options', async (req, res) => {
    const tgId = Number(req.query.tg_id);
    if (!tgId) return res.status(400).json({ error: 'Missing tg_id' });
    const token = await tokenForUser(tgId);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const [currentRaw, accountDefaultRaw, ordersResponse, addressesResponse] = await Promise.all([
            getUserStoreContext(tgId, token),
            getStoreContext(token),
            callMCPTool(token, 'silpo_get_my_online_orders', { limit: 10, offset: 0 }).catch(() => null),
            callMCPTool(token, 'silpo_get_my_delivery_addresses', {}).catch(() => null),
        ]);

        const addresses = addressesResponse ? await savedDeliveryOptions(token, addressesResponse) : [];
        const accountDefault = withResolvedDeliveryAddress(accountDefaultRaw, addresses);
        const current = currentRaw.contextSource === 'silpo'
            ? withResolvedDeliveryAddress(currentRaw, addresses)
            : currentRaw;

        const ordersRoot = ordersResponse ? firstMcpRoot(ordersResponse) : {};
        const orders = Array.isArray(ordersRoot?.orders) ? ordersRoot.orders : [];
        const recentSeeds = new Map<string, { branchId: string; deliveryType: string }>();
        for (const order of orders) {
            const deliveryType = deliveryTypeOrDefault(order?.delivery?.type || order?.deliveryType);
            if (fulfillmentMode(deliveryType) !== 'pickup') continue;
            const product = Array.isArray(order?.products) ? order.products.find((item: any) => item?.branchId) : null;
            const branchId = String(product?.branchId || order?.branchId || '');
            if (!branchId || recentSeeds.has(branchId)) continue;
            recentSeeds.set(branchId, { branchId, deliveryType });
            if (recentSeeds.size >= 4) break;
        }
        const recent = await Promise.all([...recentSeeds.values()].map(seed => getStoreContext(token, seed)));

        res.json({ current, accountDefault, recent, addresses });
    } catch (error) {
        console.error('[Fulfillment] Failed to load options:', error);
        res.status(502).json({ error: 'Failed to load fulfillment options' });
    }
});

app.get('/api/stores/search', async (req, res) => {
    const tgId = Number(req.query.tg_id);
    const rawQuery = String(req.query.q || '').trim();
    const query = rawQuery.toLocaleLowerCase('uk-UA');
    if (!tgId || query.length < 2) return res.json({ stores: [] });
    const token = await tokenForUser(tgId);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const branches = await listBranches(token);
        const pickupBranches = branches.some(branch => branch?.hasPickup === true)
            ? branches.filter(branch => branch?.hasPickup === true)
            : branches;
        const geocoded = rawQuery.length >= 3 ? await geocodeAddresses(rawQuery).catch(() => []) : [];
        const origin = geocoded[0] ? { latitude: geocoded[0].latitude, longitude: geocoded[0].longitude } : undefined;
        const stores = pickupBranches.map(branch => pickupOption(branch, origin)).filter(Boolean)
            .filter((store: any) => {
                if (origin && Number.isFinite(store.distanceKm)) return true;
                return `${store.city} ${store.address} ${store.storeLabel}`.toLocaleLowerCase('uk-UA').includes(query);
            })
            .sort((left: any, right: any) => {
                if (origin) return (left.distanceKm ?? Number.MAX_VALUE) - (right.distanceKm ?? Number.MAX_VALUE);
                return left.storeLabel.localeCompare(right.storeLabel, 'uk-UA');
            })
            .slice(0, 20);
        res.json({ stores });
    } catch (error) {
        console.error('[Stores] Search failed:', error);
        res.status(502).json({ error: 'Store search failed' });
    }
});

app.get('/api/stores/nearby', async (req, res) => {
    const tgId = Number(req.query.tg_id);
    const origin = coordinatesOf({ latitude: req.query.latitude, longitude: req.query.longitude });
    if (!tgId || !origin) return res.status(400).json({ error: 'Missing location' });
    const token = await tokenForUser(tgId);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const branches = await listBranches(token);
        const pickupBranches = branches.some(branch => branch?.hasPickup === true)
            ? branches.filter(branch => branch?.hasPickup === true)
            : branches;
        const stores = pickupBranches.map(branch => pickupOption(branch, origin)).filter(Boolean)
            .filter((store: any) => Number.isFinite(store.distanceKm))
            .sort((left: any, right: any) => left.distanceKm - right.distanceKm)
            .slice(0, 20);
        res.json({ stores });
    } catch (error) {
        console.error('[Stores] Nearby lookup failed:', error);
        res.status(502).json({ error: 'Nearby store lookup failed' });
    }
});

app.get('/api/addresses/search', async (req, res) => {
    const tgId = Number(req.query.tg_id);
    const query = String(req.query.q || '').trim();
    if (!tgId || query.length < 3) return res.json({ addresses: [] });
    const token = await tokenForUser(tgId);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        res.json({ addresses: await geocodeAddresses(query) });
    } catch (error) {
        console.error('[Addresses] Search failed:', error);
        res.status(502).json({ error: 'Address search failed' });
    }
});

app.post('/api/stores/select', async (req, res) => {
    const tgId = Number(req.body.tg_id);
    if (!tgId) return res.status(400).json({ error: 'Missing user' });
    const token = await tokenForUser(tgId);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        if (req.body.source === 'silpo') {
            await db.prepare(`
                UPDATE users SET monitor_branch_id = NULL, monitor_delivery_type = NULL,
                    monitor_store_label = NULL, monitor_context_source = NULL WHERE tg_id = ?
            `).run(tgId);
            return res.json({ success: true, store: await getStoreContext(token) });
        }

        const mode = req.body.mode === 'pickup' ? 'pickup' : 'delivery';
        const contextLabel = String(req.body.contextLabel || req.body.addressLabel || '').trim();
        let branchId = String(req.body.branchId || '');
        let deliveryType = mode === 'pickup' ? 'SelfPickup' : 'DeliveryHome';
        const requestedCoordinates = coordinatesOf(req.body);

        if (mode === 'delivery' && requestedCoordinates) {
            const response = await callMCPTool(token, 'silpo_get_available_delivery_types', {
                latitude: requestedCoordinates.latitude,
                longitude: requestedCoordinates.longitude,
            });
            const root = firstMcpRoot(response);
            const options = Array.isArray(root?.options) ? root.options : Array.isArray(root) ? root : [];
            const option = options.find((item: any) => item?.deliveryType === 'DeliveryHome' && item?.branchId)
                || options.find((item: any) => String(item?.deliveryType || '').startsWith('Delivery') && item?.branchId);
            if (!option?.branchId) {
                return res.status(422).json({ error: 'DELIVERY_UNAVAILABLE' });
            }
            branchId = String(option.branchId);
            deliveryType = deliveryTypeOrDefault(option.deliveryType);
        }

        if (!branchId || (mode === 'delivery' && !contextLabel)) {
            return res.status(400).json({ error: 'Missing fulfillment parameters' });
        }
        const context = await getStoreContext(token, { branchId, deliveryType, storeLabel: contextLabel });
        await db.prepare(`
            UPDATE users SET monitor_branch_id = ?, monitor_delivery_type = ?, monitor_store_label = ?,
                monitor_context_source = 'manual' WHERE tg_id = ?
        `).run(context.branchId, context.deliveryType, context.contextLabel, tgId);
        res.json({ success: true, store: context });
    } catch (error) {
        console.error('[Fulfillment] Selection failed:', error);
        res.status(502).json({ error: 'Fulfillment selection failed' });
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
    const { tg_id, product_id, companyId, quantity = 1 } = req.body;
    if (!tg_id || !product_id || !companyId) {
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
        const selectedContext = await getUserStoreContext(Number(tg_id), token);
        let cartContext = await getStoreContext(token);
        if (cartContext.mode === 'delivery' && cartContext.selectionRequired) {
            cartContext = withResolvedDeliveryAddress(cartContext, await savedDeliveryOptions(token).catch(() => []));
        }
        if (!selectionMatchesCart(selectedContext, cartContext)) {
            return res.status(409).json({ error: 'CONTEXT_MISMATCH' });
        }
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
                branchId: selectedContext.branchId,
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
        const suppliedExternalId = Number(req.body.externalProductId ?? req.body.external_product_id);
        const slugExternalId = slug ? parseInt(slug.split('-').pop() || '', 10) : NaN;
        const externalProductId = Number.isSafeInteger(suppliedExternalId) ? suppliedExternalId : slugExternalId;
        if (!Number.isSafeInteger(externalProductId) || externalProductId <= 0) {
            return res.status(400).json({ error: 'Missing external product id' });
        }
        
        // Remove from MCP
        await callMCPTool(token, 'silpo_add_or_update_favorite_products', {
            actions: [{ productId: product_id, externalProductId, toDelete: true }]
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
