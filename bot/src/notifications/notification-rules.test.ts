import assert from 'node:assert/strict';
import test from 'node:test';
import { discountPercent, meaningfulPriceDrop, nextStableBoolean, shouldRecheckAlternative } from './notification-rules';

test('ignores tiny price noise', () => {
    assert.equal(meaningfulPriceDrop(100, 99), null);
    assert.equal(meaningfulPriceDrop(1000, 995), null);
    assert.equal(meaningfulPriceDrop(100, 96), null);
});

test('accepts a meaningful drop and explains it', () => {
    const drop = meaningfulPriceDrop(100, 94);
    assert.ok(drop);
    assert.equal(drop.amount, 6);
    assert.equal(Math.round(drop.percent), 6);
});

test('calculates only real discounts', () => {
    assert.equal(discountPercent(100, 80), 20);
    assert.equal(discountPercent(80, 100), 0);
});

test('rechecks alternatives after a price change or six hours', () => {
    const recent = { current_price: 100, alternative_checked_at: '2026-08-09T10:00:00Z' };
    const now = Date.parse('2026-08-09T12:00:00Z');
    assert.equal(shouldRecheckAlternative(recent, 100, now), false);
    assert.equal(shouldRecheckAlternative(recent, 90, now), true);
    assert.equal(shouldRecheckAlternative(recent, 100, Date.parse('2026-08-09T17:00:00Z')), true);
});

test('requires two matching observations before changing availability', () => {
    const first = nextStableBoolean(false, false, 0, true);
    assert.deepEqual(first, { stable: false, observed: true, observationCount: 1, changed: false });
    const second = nextStableBoolean(first.stable, first.observed, first.observationCount, true);
    assert.deepEqual(second, { stable: true, observed: true, observationCount: 0, changed: true });
});

test('discards a one-cycle availability glitch', () => {
    const glitch = nextStableBoolean(true, true, 0, false);
    const recovered = nextStableBoolean(glitch.stable, glitch.observed, glitch.observationCount, true);
    assert.equal(recovered.stable, true);
    assert.equal(recovered.changed, false);
});
