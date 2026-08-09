import assert from 'node:assert/strict';
import test from 'node:test';
import { isFavoriteProduct, productIdentity, productsFromSearchResponse } from './product-search';

function response(root: any) {
    return { result: { content: [{ type: 'text', text: JSON.stringify(root) }] } };
}

test('extracts and deduplicates products from batch search queries', () => {
    const product = { id: 'one', externalProductId: 101, name: 'Молоко' };
    const result = productsFromSearchResponse(response({
        success: true,
        queries: [
            { query: 'молоко', products: [product] },
            { query: '101', products: [product, { id: 'two', externalProductId: 102 }] },
        ],
    }));
    assert.deepEqual(result.map(item => item.id), ['one', 'two']);
});

test('recognizes a favorite by UUID or external article number', () => {
    const favorites = [{ id: 'favorite-id', externalProductId: 222 }];
    assert.equal(isFavoriteProduct({ id: 'favorite-id', externalProductId: 999 }, favorites), true);
    assert.equal(isFavoriteProduct({ id: 'other-id', externalProductId: 222 }, favorites), true);
    assert.equal(isFavoriteProduct({ id: 'other-id', externalProductId: 333 }, favorites), false);
});

test('does not treat missing external ids as the same product', () => {
    assert.equal(productIdentity({}), '');
    assert.equal(isFavoriteProduct({ id: 'one' }, [{ id: 'two' }]), false);
});
