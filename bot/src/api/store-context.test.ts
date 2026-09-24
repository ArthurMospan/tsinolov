import assert from 'node:assert/strict';
import test from 'node:test';
import {
    fulfillmentMode,
    preferredPickupBranch,
    publicDeliveryAddressLabel,
    publicStoreLabel,
    sameStoreContext,
    supportsPickup,
    uniquePhysicalStores,
} from './store-context';

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

test('formats a user delivery address separately from a fulfillment branch', () => {
    assert.equal(publicDeliveryAddressLabel({
        tag: 'Дім',
        city: 'Київ',
        street: 'вул. Липківського',
        building: '15',
        apartment: '8',
    }), 'Дім · Київ, вул. Липківського, 15 · кв. 8');
});

test('separates delivery from physical pickup', () => {
    assert.equal(fulfillmentMode('DeliveryHome'), 'delivery');
    assert.equal(fulfillmentMode('SelfPickup'), 'pickup');
});

test('prefers the pickup branch when Silpo has two branches at one address', () => {
    const delivery = { branchId: 'delivery', cityFull: 'Софіївська Борщагівка', addressFull: 'вул. Київська, 1/102', hasPickup: null };
    const pickup = { branchId: 'pickup', cityFull: 'Софіївська Борщагівка', addressFull: 'вул. Київська, 1/102', hasPickup: true };
    assert.equal(preferredPickupBranch(delivery, [delivery, pickup]), pickup);
});

test('only treats explicitly supported branches as pickup locations', () => {
    assert.equal(supportsPickup({ hasPickup: true }), true);
    assert.equal(supportsPickup({ deliveryType: 'SelfPickup' }), true);
    assert.equal(supportsPickup({ availableDeliveryTypes: ['DeliveryHome', 'SelfPickup'] }), true);
    assert.equal(supportsPickup({ hasPickup: false, deliveryType: 'DeliveryHome' }), false);
    assert.equal(supportsPickup({}), false);
});

test('deduplicates technical pickup branches that represent one physical store', () => {
    const stores = uniquePhysicalStores([
        { branchId: 'delivery-copy', cityFull: 'Київ', addressFull: 'вул. Васильківська, 100', hasPickup: false },
        { branchId: 'pickup', cityFull: 'Київ', addressFull: 'вул Васильківська 100', hasPickup: true },
        { branchId: 'pickup-copy', cityFull: 'Київ', addressFull: 'вул. Васильківська, 100', hasPickup: true },
    ]);
    assert.equal(stores.length, 1);
    assert.equal(stores[0].branchId, 'pickup');
});

test('keeps physical stores at the same street address in different cities', () => {
    const stores = uniquePhysicalStores([
        { branchId: 'kyiv', city: 'Київ', address: 'вул. Центральна, 1', hasPickup: true },
        { branchId: 'lviv', city: 'Львів', address: 'вул. Центральна, 1', hasPickup: true },
    ]);
    assert.equal(stores.length, 2);
});

test('does not merge branches when a public address is missing', () => {
    const stores = uniquePhysicalStores([
        { branchId: 'a', hasPickup: true },
        { branchId: 'b', hasPickup: true },
    ]);
    assert.equal(stores.length, 2);
});
test('treats old rows without store context as a fresh baseline', () => {
    assert.equal(sameStoreContext({ current_price: 100 }, { branchId: 'a', deliveryType: 'DeliveryHome' }), false);
});

test('compares both branch and delivery type', () => {
    const previous = { branch_id: 'a', delivery_type: 'DeliveryHome' };
    assert.equal(sameStoreContext(previous, { branchId: 'a', deliveryType: 'deliveryhome' }), true);
    assert.equal(sameStoreContext(previous, { branchId: 'b', deliveryType: 'DeliveryHome' }), false);
});
