import assert from 'node:assert/strict';
import test from 'node:test';
import { allProductsUnexpectedlyUnavailable, nextDaytimeReference, productAvailability, productAvailabilityReason } from './monitoring-favorites';

test('recognizes Silpo stock fields without confusing missing data with out of stock', () => {
    assert.equal(productAvailability({ stock: 3, available: true }), true);
    assert.equal(productAvailability({ stock: 0, available: false }), false);
    assert.equal(productAvailability({ stock: 0, available: true }), false);
    assert.equal(productAvailability({ isOutOfStock: true, available: true }), false);
    assert.equal(productAvailability({ deliveryAvailable: true }), null);
    assert.equal(productAvailability({ storeAvailability: false, stock: 10, deliveryAvailable: true }), false);
    assert.equal(productAvailability({ storeAvailability: true, stock: 10, promotions: [{ id: 'expected' }] }), false);
    assert.equal(productAvailability({ name: 'Товар' }), null);
});

test('reads expected and online-only markers from product details', () => {
    assert.equal(productAvailabilityReason({ badges: [{ code: 'expected' }] }), 'expected');
    assert.equal(productAvailabilityReason({ promotions: [{ id: 'only_online' }] }), 'online_only');
});

test('retries only when a multi-product response becomes entirely unavailable', () => {
    assert.equal(allProductsUnexpectedlyUnavailable([{ stock: 0 }, { stock: 0 }]), true);
    assert.equal(allProductsUnexpectedlyUnavailable([{ stock: 0 }, { stock: 2 }]), false);
    assert.equal(allProductsUnexpectedlyUnavailable([{ stock: 0 }]), false);
});

test('creates a stable daytime reference window after the current moment', () => {
    const now = new Date('2026-08-09T20:30:00.000Z');
    const window = nextDaytimeReference(now);
    assert.equal(window.start.toISOString(), '2026-08-10T09:00:00.000Z');
    assert.equal(window.end.getTime() - window.start.getTime(), 2 * 60 * 60 * 1000);
});
