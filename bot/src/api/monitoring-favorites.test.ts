import assert from 'node:assert/strict';
import test from 'node:test';
import {
    allProductsUnexpectedlyUnavailable,
    buildFavoriteVisibilityArgs,
    favoritesFromResponse,
    mergeAccountAndStoreFavorites,
    nextDaytimeReference,
    productAvailability,
    productAvailabilityReason,
} from './monitoring-favorites';

function response(root: any) {
    return { result: { content: [{ type: 'text', text: JSON.stringify(root) }] } };
}

test('recognizes Silpo stock fields without confusing missing data with out of stock', () => {
    assert.equal(productAvailability({ stock: 3, available: true }), true);
    assert.equal(productAvailability({ stock: 0, available: false }), false);
    assert.equal(productAvailability({ stock: 0, available: true }), false);
    assert.equal(productAvailability({ isOutOfStock: true, available: true }), false);
    assert.equal(productAvailability({ deliveryAvailable: true }), null);
    assert.equal(productAvailability({ storeAvailability: false, stock: 10, deliveryAvailable: true }), false);
    assert.equal(productAvailability({ storeAvailability: true, stock: 0, deliveryAvailable: true }), false);
    assert.equal(productAvailability({ storeAvailability: true, stock: 10, promotions: [{ id: 'expected' }] }), false);
    assert.equal(productAvailability({ name: 'Товар' }), null);
});

test('reads expected and online-only markers from product details', () => {
    assert.equal(productAvailabilityReason({ badges: [{ code: 'expected' }] }), 'expected');
    assert.equal(productAvailabilityReason({ availabilityInfo: { isExpected: true } }), 'expected');
    assert.equal(productAvailabilityReason({ promotions: [{ id: 'only_online' }] }), 'online_only');
});

test('retries only when a multi-product response becomes entirely unavailable', () => {
    assert.equal(allProductsUnexpectedlyUnavailable([{ stock: 0 }, { stock: 0 }]), true);
    assert.equal(allProductsUnexpectedlyUnavailable([{ stock: 0 }, { stock: 2 }]), false);
    assert.equal(allProductsUnexpectedlyUnavailable([{ stock: 0 }]), false);
});

test('creates a stable daytime reference window after the current moment', () => {
    const now = new Date('2026-08-09T20:30:00.000Z');
    const window = nextDaytimeReference(now);
    assert.equal(window.start.toISOString(), '2026-08-10T09:00:00.000Z');
    assert.equal(window.end.getTime() - window.start.getTime(), 2 * 60 * 60 * 1000);
});

test('keeps active and legacy unavailable favorites from separate MCP buckets', () => {
    const products = favoritesFromResponse(response({
        data: {
            products: [{ id: 'potato', externalProductId: 993140, title: 'Картопля', stock: 0 }],
            archivedItems: [{ id: 'socks', title: 'Шкарпетки жіночі', price: 0 }],
        },
    }));

    assert.deepEqual(products.map(product => product.id), ['potato', 'socks']);
});

test('keeps products from a generic data array and account-level product ids', () => {
    const products = favoritesFromResponse(response({
        data: [{ id: 'potato', title: 'Картопля' }],
        archivedProductIds: [459000],
    }));

    assert.equal(products[0].id, 'potato');
    assert.equal(products[1].externalProductId, 459000);
});

test('requests unavailable and archived favorites when the live MCP schema supports it', () => {
    const args = buildFavoriteVisibilityArgs({
        name: 'silpo_get_my_favorites',
        inputSchema: { properties: {
            includeUnavailable: { type: 'boolean' },
            include_archived: { type: 'boolean' },
            inStock: { type: 'boolean' },
            limit: { type: 'number' },
        } },
    });

    assert.deepEqual(args, {
        includeUnavailable: true,
        include_archived: true,
        inStock: false,
    });
});

test('merges an account-wide favorite list with store-specific product data', () => {
    const products = mergeAccountAndStoreFavorites(
        [
            { id: 'favorite-potato', externalProductId: 993140, title: 'Картопля', stock: 8 },
            { id: 'socks', title: 'Шкарпетки жіночі', price: 0 },
        ],
        [{ id: 'catalog-potato', externalProductId: 993140, title: 'Картопля', stock: 0 }],
    );

    assert.equal(products.length, 2);
    assert.equal(products[0].id, 'catalog-potato');
    assert.equal(products[0].stock, 0);
    assert.equal(products[1].id, 'socks');
    assert.equal(products[1].price, 0);
    assert.equal(productAvailability(products[1]), false);
    assert.equal(products[1].legacyFavorite, true);
});
