import assert from 'node:assert/strict';
import test from 'node:test';
import { matchingCatalogProduct, productDetailsFromResponse } from './product-details';
import { productAvailabilityReason } from './monitoring-favorites';
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
