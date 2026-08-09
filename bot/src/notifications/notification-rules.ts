export interface PriceDrop {
    amount: number;
    percent: number;
}

export interface StableBooleanState {
    stable: boolean;
    observed: boolean;
    observationCount: number;
    changed: boolean;
}

const MIN_PRICE_DROP_AMOUNT = 2;
const MIN_PRICE_DROP_PERCENT = 2;

export function meaningfulPriceDrop(previousPrice: unknown, currentPrice: unknown): PriceDrop | null {
    const previous = Number(previousPrice);
    const current = Number(currentPrice);
    if (!Number.isFinite(previous) || !Number.isFinite(current) || previous <= 0 || current <= 0 || current >= previous) {
        return null;
    }
    const amount = previous - current;
    const percent = amount / previous * 100;
    if (amount < MIN_PRICE_DROP_AMOUNT || percent < MIN_PRICE_DROP_PERCENT) return null;
    return { amount, percent };
}

export function discountPercent(oldPrice: unknown, currentPrice: unknown): number {
    const oldValue = Number(oldPrice);
    const currentValue = Number(currentPrice);
    if (!Number.isFinite(oldValue) || !Number.isFinite(currentValue) || oldValue <= currentValue || currentValue <= 0) return 0;
    return Math.round((1 - currentValue / oldValue) * 100);
}

export function shouldRecheckAlternative(previous: any, currentPrice: number, now = Date.now()): boolean {
    if (!previous) return true;
    if (Math.abs(Number(previous.current_price || 0) - currentPrice) >= 0.01) return true;
    const lastChecked = Date.parse(String(previous.alternative_checked_at || ''));
    return !Number.isFinite(lastChecked) || now - lastChecked >= 6 * 60 * 60 * 1000;
}

export function nextStableBoolean(
    stable: boolean,
    previousObserved: boolean,
    previousCount: number,
    current: boolean,
    confirmations = 2
): StableBooleanState {
    if (current === stable) {
        return { stable, observed: current, observationCount: 0, changed: false };
    }
    const observationCount = current === previousObserved ? previousCount + 1 : 1;
    if (observationCount >= confirmations) {
        return { stable: current, observed: current, observationCount: 0, changed: true };
    }
    return { stable, observed: current, observationCount, changed: false };
}
