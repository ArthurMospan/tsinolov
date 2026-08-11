import assert from 'node:assert/strict';
import test from 'node:test';
import { productDetailsFromResponse } from './product-details';
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
