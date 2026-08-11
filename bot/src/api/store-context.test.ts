import assert from 'node:assert/strict';
import test from 'node:test';
import { preferredPickupBranch, publicStoreLabel, sameStoreContext } from './store-context';

test('builds a public store label without using a delivery address', () => {
    assert.equal(
        publicStoreLabel({ city: 'Київ', address: 'вул. Хрещатик, 1' }),
        'Київ, вул. Хрещатик, 1'
    );
});

test('reads the current Silpo branch field names', () => {
    assert.equal(publicStoreLabel({ cityFull: 'Софіївська Борщагівка', addressFull: 'вул. Київська, 1/102' }),
        'Софіївська Борщагівка, вул. Київська, 1/102');
});

test('prefers the pickup branch when Silpo has two branches at one address', () => {
    const delivery = { branchId: 'delivery', cityFull: 'Софіївська Борщагівка', addressFull: 'вул. Київська, 1/102', hasPickup: null };
    const pickup = { branchId: 'pickup', cityFull: 'Софіївська Борщагівка', addressFull: 'вул. Київська, 1/102', hasPickup: true };
    assert.equal(preferredPickupBranch(delivery, [delivery, pickup]), pickup);
});
test('treats old rows without store context as a fresh baseline', () => {
    assert.equal(sameStoreContext({ current_price: 100 }, { branchId: 'a', deliveryType: 'DeliveryHome' }), false);
});

test('compares both branch and delivery type', () => {
    const previous = { branch_id: 'a', delivery_type: 'DeliveryHome' };
    assert.equal(sameStoreContext(previous, { branchId: 'a', deliveryType: 'deliveryhome' }), true);
    assert.equal(sameStoreContext(previous, { branchId: 'b', deliveryType: 'DeliveryHome' }), false);
});
