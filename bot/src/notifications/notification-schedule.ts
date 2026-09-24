const KYIV_TIME_ZONE = 'Europe/Kyiv';
const QUIET_HOURS_START = 1;
const NOTIFICATIONS_START = 9;

const kyivHourFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: KYIV_TIME_ZONE,
    hour: '2-digit',
    hourCycle: 'h23',
});

export function kyivHour(at = new Date()): number {
    const hour = kyivHourFormatter.formatToParts(at)
        .find(part => part.type === 'hour')?.value;
    return Number(hour);
}

export function automaticNotificationsAllowed(at = new Date()): boolean {
    const hour = kyivHour(at);
    return hour < QUIET_HOURS_START || hour >= NOTIFICATIONS_START;
}
