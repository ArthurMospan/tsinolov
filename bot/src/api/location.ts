export interface Coordinates {
    latitude: number;
    longitude: number;
}

function validCoordinates(latitudeValue: unknown, longitudeValue: unknown): Coordinates | null {
    if (latitudeValue === undefined || latitudeValue === null || latitudeValue === ''
        || longitudeValue === undefined || longitudeValue === null || longitudeValue === '') return null;
    const latitude = Number(latitudeValue);
    const longitude = Number(longitudeValue);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
    return { latitude, longitude };
}

function geoJsonCoordinates(value: unknown): Coordinates | null {
    if (!Array.isArray(value) || value.length < 2) return null;
    return validCoordinates(value[1], value[0]);
}

export function coordinatesOf(value: any): Coordinates | null {
    if (!value || typeof value !== 'object') return null;

    const direct = validCoordinates(
        value.latitude ?? value.lat,
        value.longitude ?? value.lng ?? value.lon
    );
    if (direct) return direct;

    for (const candidate of [
        value.location,
        value.coordinates,
        value.position,
        value.geo,
        value.geolocation,
        value.geoLocation,
        value.point,
    ]) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
        const nested = validCoordinates(
            candidate.latitude ?? candidate.lat,
            candidate.longitude ?? candidate.lng ?? candidate.lon
        );
        if (nested) return nested;
    }

    for (const candidate of [
        value.coordinates,
        value.location?.coordinates,
        value.geometry?.coordinates,
        value.geo?.coordinates,
        value.geoLocation?.coordinates,
    ]) {
        const coordinates = geoJsonCoordinates(candidate);
        if (coordinates) return coordinates;
    }

    return null;
}

export function distanceKm(from: Coordinates, to: Coordinates): number {
    const radius = 6371;
    const radians = (degrees: number) => degrees * Math.PI / 180;
    const latitudeDelta = radians(to.latitude - from.latitude);
    const longitudeDelta = radians(to.longitude - from.longitude);
    const a = Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
    return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
