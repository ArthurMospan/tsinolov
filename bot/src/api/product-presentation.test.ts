import assert from 'node:assert/strict';
import test from 'node:test';
import { productDisplayMeasurement, productPresentation } from './product-presentation';

test('uses Silpo display ratio for a weighted product instead of inventing one kilogram', () => {
    assert.deepEqual(productPresentation({
        title: 'Картопля рання Українська',
        ratio: 'кг',
        displayRatio: '100г',
        weightText: '1 кг',
        addToBasketStep: 0.5,
        weighted: true,
    }), { displayWeight: '100 г', price_unit: 'кг' });
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
