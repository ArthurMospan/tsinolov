import assert from 'node:assert/strict';
import test from 'node:test';
import { selectAvailableTimeslot } from './silpo-public-catalog';

test('selects the first available slot whose end is still in the future', () => {
    const slot = selectAvailableTimeslot({ items: [
        { isAvailable: true, datePeriod: { start: '2026-08-11T08:00:00+00:00', end: '2026-08-11T09:00:00+00:00' } },
        { isAvailable: false, datePeriod: { start: '2026-08-11T10:00:00+00:00', end: '2026-08-11T11:00:00+00:00' } },
        { isAvailable: true, datePeriod: { start: '2026-08-11T12:00:00+00:00', end: '2026-08-11T13:30:00+00:00' } },
    ] }, new Date('2026-08-11T10:00:00+00:00'));

    assert.deepEqual(slot, {
        start: '2026-08-11T12:00:00+00:00',
        end: '2026-08-11T13:30:00+00:00',
    });
});
