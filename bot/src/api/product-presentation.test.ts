import assert from 'node:assert/strict';
import test from 'node:test';
import { productDisplayMeasurement, productDisplayPricing, productPresentation } from './product-presentation';

// Silpo prices weighted goods per kilogram but shows customers the amount for
// the smaller display quantity: 379 UAH/кг is presented as 37,90 UAH/100 г.
test('takes the weighted price that belongs to the displayed quantity', () => {
    assert.deepEqual(productDisplayPricing({
        title: 'Запечена картопля',
        price: 379,
        ratio: 'кг',
        displayPrice: 37.9,
        displayRatio: '100г',
        weighted: true,
    }), { price: 37.9 });
});

test('carries the discounted old price together with the display price', () => {
    assert.deepEqual(productDisplayPricing({
        title: 'Картопляні зрази з капустою',
        price: 364.65,
        oldPrice: 429,
        displayPrice: 36.46,
        displayOldPrice: 42.9,
    }), { price: 36.46, oldPrice: 42.9 });
});

test('changes nothing when Silpo sends no separate display price', () => {
    assert.deepEqual(productDisplayPricing({
        title: "Чипси Chipster's картопляні зі смаком сиру",
        price: 90.99,
        ratio: 'шт',
        displayRatio: '150г',
    }), {});
});

test('uses Silpo display ratio for a weighted product instead of inventing one kilogram', () => {
    assert.deepEqual(productPresentation({
        title: 'Картопля рання Українська',
        ratio: 'кг',
        displayRatio: '100г',
        weightText: '1 кг',
        addToBasketStep: 0.5,
        weighted: true,
    }), { displayWeight: '100 г', price_unit: '100 г' });
});

test('shows one piece when a piece product has no package measurement', () => {
    assert.equal(productDisplayMeasurement({ title: 'Пакет паперовий', ratio: 'шт' }), '1 шт');
});

test('extracts a multipack measurement from the Silpo product title', () => {
    assert.deepEqual(productPresentation({
        title: 'Пиво Budweiser Budvar світле 4х0,5 л + келих',
        ratio: 'шт',
        displayRatio: 'шт',
        displayWeight: '1 шт',
    }), { displayWeight: '4 × 0,5 л', price_unit: 'шт' });
});

test('prefers the package volume in a title over a generic one-piece display value', () => {
    assert.equal(productDisplayMeasurement({
        title: 'Вода мінеральна негазована 0,5л',
        ratio: 'шт',
        displayWeight: '1 шт',
    }), '0,5 л');
});
