import assert from 'node:assert/strict';
import test from 'node:test';
import { rankProductAlternatives } from './alternative-ranking';

function beer(overrides: Record<string, any> = {}) {
    return {
        id: 'kozel-original',
        slug: 'pyvo-velkopopovitsky-kozel-svitle-786388',
        name: 'Пиво Velkopopovitsky Kozel світле',
        price: 34.99,
        attributes: {
            'Торгова марка': 'Velkopopovitsky Kozel',
            "Розмір/об'єм": '<=0,5',
            '% спирту': 4,
            'Тип упаковки': 'Скло',
        },
        ...overrides,
    };
}

test('rejects a cheaper product from another brand', () => {
    const stella = beer({
        id: 'stella',
        slug: 'pyvo-stella-artois-svitle-17333',
        name: 'Пиво Stella Artois світле',
        price: 29.99,
        attributes: { ...beer().attributes, 'Торгова марка': 'Stella Artois', '% спирту': 5 },
    });
    assert.deepEqual(rankProductAlternatives(beer(), [stella]), []);
});

test('accepts a meaningfully cheaper variant of the same brand and size', () => {
    const candidate = beer({
        id: 'kozel-can',
        slug: 'pyvo-velkopopovitsky-kozel-svitle-z-b-123456',
        name: 'Пиво Velkopopovitsky Kozel світле з/б',
        price: 29.99,
        attributes: { ...beer().attributes, 'Тип упаковки': 'Банка' },
    });
    const ranked = rankProductAlternatives(beer(), [candidate]);
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].productId, 'kozel-can');
});

test('rejects a conflicting product style from the same brand', () => {
    const dark = beer({
        id: 'kozel-dark',
        slug: 'pyvo-velkopopovitsky-kozel-temne-123456',
        name: 'Пиво Velkopopovitsky Kozel темне',
        price: 28.99,
    });
    assert.deepEqual(rankProductAlternatives(beer(), [dark]), []);
});

test('rejects the same brand when alcohol strength is materially different', () => {
    const stronger = beer({
        id: 'kozel-strong',
        slug: 'pyvo-velkopopovitsky-kozel-svitle-strong-333333',
        price: 28.99,
        attributes: { ...beer().attributes, '% спирту': '5,2%' },
    });
    assert.deepEqual(rankProductAlternatives(beer(), [stronger]), []);
});

test('rejects a different package-size range', () => {
    const multipack = beer({
        id: 'kozel-pack',
        slug: 'pyvo-velkopopovitsky-kozel-svitle-pack-123456',
        price: 29.99,
        attributes: { ...beer().attributes, "Розмір/об'єм": '2-2,99', 'Тип упаковки': 'Пак' },
    });
    assert.deepEqual(rankProductAlternatives(beer(), [multipack]), []);
});

test('rejects savings below five percent', () => {
    const candidate = beer({
        id: 'kozel-small-saving',
        slug: 'pyvo-velkopopovitsky-kozel-svitle-654321',
        price: 34.49,
    });
    assert.deepEqual(rankProductAlternatives(beer(), [candidate]), []);
});

test('ranks semantic similarity before the absolute lowest price', () => {
    const close = beer({
        id: 'kozel-close',
        slug: 'pyvo-velkopopovitsky-kozel-svitle-classic-111111',
        name: 'Пиво Velkopopovitsky Kozel світле класичне',
        price: 31.49,
    });
    const looser = beer({
        id: 'kozel-looser',
        slug: 'pyvo-velkopopovitsky-kozel-svitle-special-222222',
        name: 'Пиво Velkopopovitsky Kozel світле special edition',
        price: 28.99,
    });
    const ranked = rankProductAlternatives(beer(), [looser, close]);
    assert.equal(ranked[0].productId, 'kozel-close');
});
