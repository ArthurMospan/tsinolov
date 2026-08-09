import assert from 'node:assert/strict';
import test from 'node:test';
import { publicStoreLabel, sameStoreContext } from './store-context';

test('builds a public store label without using a delivery address', () => {
    assert.equal(
        publicStoreLabel({ city: 'Київ', address: 'вул. Хрещатик, 1' }),
        'Київ, вул. Хрещатик, 1'
    );
});
test('treats old rows without store context as a fresh baseline', () => {
    assert.equal(sameStoreContext({ current_price: 100 }, { branchId: 'a', deliveryType: 'DeliveryHome' }), false);
});

test('compares both branch and delivery type', () => {
    const previous = { branch_id: 'a', delivery_type: 'DeliveryHome' };
    assert.equal(sameStoreContext(previous, { branchId: 'a', deliveryType: 'deliveryhome' }), true);
    assert.equal(sameStoreContext(previous, { branchId: 'b', deliveryType: 'DeliveryHome' }), false);
});
