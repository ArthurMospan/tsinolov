import assert from 'node:assert/strict';
import test from 'node:test';
import { matchingCatalogProduct, mergeProductData, productDetailsFromResponse } from './product-details';
import { productAvailability, productAvailabilityReason } from './monitoring-favorites';
import { productDisplayMeasurement } from './product-presentation';

function response(root: any) {
    return { result: { content: [{ type: 'text', text: JSON.stringify(root) }] } };
}

test('keeps customer-facing measurement and availability metadata from a product details wrapper', () => {
    const product = productDetailsFromResponse(response({
        data: {
            modifiers: [{ code: 'expected' }],
            product: {
                id: '993140',
                slug: 'kartoplia-rannia-ukrainska-993140',
                title: 'Картопля рання Українська',
                ratio: 'кг',
                displayRatio: '100г',
            },
        },
    }), 'kartoplia-rannia-ukrainska-993140');

    assert.equal(productDisplayMeasurement(product), '100 г');
    assert.equal(productAvailabilityReason(product), 'expected');
});

test('selects the product whose slug matches the requested details page', () => {
    const product = productDetailsFromResponse(response({
        product: { id: 'target', slug: 'target-product', title: 'Цільовий товар', displayRatio: '500мл' },
        recommendations: [
            { id: 'other', slug: 'other-product', title: 'Інший товар', displayWeight: '1 шт', attributes: [] },
        ],
    }), 'target-product');

    assert.equal(product?.slug, 'target-product');
});

test('resolves a favorite without slug by its external article number', () => {
    const product = matchingCatalogProduct({
        id: 'favorite-row',
        externalProductId: 993140,
        title: 'Картопля рання Українська',
    }, [
        { id: 'other', externalProductId: 123, slug: 'other', displayRatio: '1шт' },
        {
            id: 'catalog-row',
            externalProductId: 993140,
            slug: 'kartoplia-rannia-ukrainska-993140',
            displayRatio: '100г',
            stock: 0,
        },
    ]);

    assert.equal(product?.slug, 'kartoplia-rannia-ukrainska-993140');
    assert.equal(product?.displayRatio, '100г');
    assert.equal(product?.stock, 0);
});

test('makes an authoritative zero stock override a stale positive favorites summary', () => {
    const product = mergeProductData(
        { id: 'favorite-potato', storeAvailability: true, stock: 5 },
        { id: 'catalog-potato', externalProductId: 993140, displayRatio: '100г', stock: 0 },
    );

    assert.equal(product.storeAvailability, false);
    assert.equal(productAvailability(product), false);
});

test('makes authoritative positive stock override a stale negative favorites summary', () => {
    const product = mergeProductData(
        { id: 'favorite-beet', storeAvailability: false, stock: 0 },
        { id: 'catalog-beet', externalProductId: 123, displayRatio: '100г', stock: 7 },
    );

    assert.equal(product.storeAvailability, true);
    assert.equal(productAvailability(product), true);
});
