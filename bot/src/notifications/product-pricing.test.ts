import assert from 'node:assert/strict';
import test from 'node:test';
import { productPricing } from './product-pricing';

test('understands a multi-buy special price and its condition', () => {
    assert.deepEqual(productPricing({
        price: 239,
        oldPrice: null,
        specialPrices: [{ price: 179, count: 2, type: 'from' }],
    }), {
        basePrice: 239,
        effectivePrice: 179,
        referencePrice: 239,
        specialPrice: 179,
        specialCount: 2,
        condition: 'від 2 шт',
        hasPromo: true,
        discountPercent: 25,
    });
});
test('uses the ordinary sale price when oldPrice is present', () => {
    const pricing = productPricing({ price: 44.99, oldPrice: 61.99, specialPrices: null });
    assert.equal(pricing.effectivePrice, 44.99);
    assert.equal(pricing.referencePrice, 61.99);
    assert.equal(pricing.discountPercent, 27);
    assert.equal(pricing.condition, '');
});

test('ignores invalid special prices', () => {
    const pricing = productPricing({ price: 100, specialPrices: [{ price: 120, count: 2 }, { price: null }] });
    assert.equal(pricing.effectivePrice, 100);
    assert.equal(pricing.hasPromo, false);
});

test('does not present an unknown conditional offer as an ordinary discount', () => {
    const pricing = productPricing({ price: 100, specialPrices: [{ price: 70, count: 3, type: 'unknown-mechanic' }] });
    assert.equal(pricing.effectivePrice, 100);
    assert.equal(pricing.hasPromo, false);
    assert.equal(pricing.condition, '');
});
