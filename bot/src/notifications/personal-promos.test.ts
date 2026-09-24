import assert from 'node:assert/strict';
import test from 'node:test';
import { activePersonalPromos, personalPromoMessage, promoSignature } from './personal-promos';

const now = Date.parse('2026-08-09T12:00:00Z');

test('keeps only currently active personal promos with IDs', () => {
    const promos = [
        { promoId: 1, beginDate: '2026-08-01T00:00:00Z', endDate: '2026-08-20T00:00:00Z' },
        { promoId: 2, beginDate: '2026-08-10T00:00:00Z', endDate: '2026-08-20T00:00:00Z' },
        { description: 'No id' },
    ];
    assert.deepEqual(activePersonalPromos(promos, now).map(item => item.promoId), [1]);
});

test('signature changes when the reward or validity changes', () => {
    const base = { description: 'Знижка', rewardText: '-20%', endDate: '2026-08-20' };
    assert.notEqual(promoSignature(base), promoSignature({ ...base, rewardText: '-30%' }));
});

test('promo notification is compact and includes the reward', () => {
    const message = personalPromoMessage([{ description: 'На каву', rewardText: '-25%' }]);
    assert.match(message, /<b>На каву<\/b> — <b>-25%<\/b>/);
});
