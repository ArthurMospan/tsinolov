import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticNotificationsAllowed, kyivHour } from './notification-schedule';

test('uses Europe/Kyiv summer time for notification hours', () => {
    assert.equal(kyivHour(new Date('2026-08-10T21:59:00Z')), 0);
    assert.equal(automaticNotificationsAllowed(new Date('2026-08-10T21:59:00Z')), true);
    assert.equal(automaticNotificationsAllowed(new Date('2026-08-10T22:00:00Z')), false);
    assert.equal(automaticNotificationsAllowed(new Date('2026-08-11T05:59:00Z')), false);
    assert.equal(automaticNotificationsAllowed(new Date('2026-08-11T06:00:00Z')), true);
});

test('uses Europe/Kyiv winter time without a fixed UTC offset', () => {
    assert.equal(automaticNotificationsAllowed(new Date('2026-01-10T06:59:00Z')), false);
    assert.equal(automaticNotificationsAllowed(new Date('2026-01-10T07:00:00Z')), true);
});
