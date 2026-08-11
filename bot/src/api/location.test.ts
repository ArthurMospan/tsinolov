import assert from 'node:assert/strict';
import test from 'node:test';
import { coordinatesOf, distanceKm } from './location';

test('reads direct and nested branch coordinates', () => {
    assert.deepEqual(coordinatesOf({ latitude: '50.45', longitude: '30.52' }), {
        latitude: 50.45,
        longitude: 30.52,
    });
    assert.deepEqual(coordinatesOf({ geoLocation: { lat: 50.46, lng: 30.53 } }), {
        latitude: 50.46,
        longitude: 30.53,
    });
});

test('reads GeoJSON coordinate arrays in longitude-latitude order', () => {
    assert.deepEqual(coordinatesOf({ geometry: { coordinates: [30.52, 50.45] } }), {
        latitude: 50.45,
        longitude: 30.52,
    });
});

test('rejects invalid coordinate ranges', () => {
    assert.equal(coordinatesOf({ latitude: 120, longitude: 30 }), null);
    assert.equal(coordinatesOf({ latitude: 50, longitude: 200 }), null);
});

test('keeps enough distance precision for nearest-store sorting', () => {
    const origin = { latitude: 50.45, longitude: 30.52 };
    const closer = distanceKm(origin, { latitude: 50.4501, longitude: 30.52 });
    const farther = distanceKm(origin, { latitude: 50.4504, longitude: 30.52 });
    assert.ok(closer < farther);
});
