import { bold, escapeTelegramHtml } from './telegram-format';

export function promoIdOf(promo: any): string {
    return String(promo?.promoId ?? promo?.id ?? promo?.promo_id ?? '');
}

export function promoSignature(promo: any): string {
    return [promo?.description, promo?.rewardText, promo?.rewardValue, promo?.beginDate, promo?.endDate]
        .map(value => String(value ?? '').trim())
        .join('|');
}

export function activePersonalPromos(promos: any[], now = Date.now()): any[] {
    return promos.filter(promo => {
        if (!promoIdOf(promo)) return false;
        const startsAt = Date.parse(String(promo?.beginDate || ''));
        const endsAt = Date.parse(String(promo?.endDate || ''));
        if (Number.isFinite(startsAt) && startsAt > now) return false;
        if (Number.isFinite(endsAt) && endsAt < now) return false;
        return true;
    });
}

export function personalPromoMessage(promos: any[]): string {
    const visible = promos.slice(0, 5).map(promo => {
        const description = escapeTelegramHtml(String(promo?.description || 'Персональна пропозиція').trim());
        const reward = String(promo?.rewardText || '').trim();
        return `• <b>${description}</b>${reward ? ` — ${bold(reward)}` : ''}`;
    });
    const remainder = promos.length - visible.length;
    return `⭐ ${bold('Для тебе зʼявилися нові пропозиції')}\n${visible.join('\n')}${remainder > 0 ? `\nІ ще ${bold(remainder)}` : ''}`;
}
