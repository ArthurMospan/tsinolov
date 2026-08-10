export function escapeTelegramHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function bold(value: unknown): string {
    return `<b>${escapeTelegramHtml(value)}</b>`;
}

export function productLink(name: unknown, slug: unknown): string {
    const safeName = escapeTelegramHtml(name);
    const normalizedSlug = String(slug ?? '').trim();
    if (!normalizedSlug) return `<b>${safeName}</b>`;
    const href = `https://silpo.ua/product/${encodeURIComponent(normalizedSlug)}`;
    return `<b><a href="${href}">${safeName}</a></b>`;
}

export function italic(value: unknown): string {
    return `<i>${escapeTelegramHtml(value)}</i>`;
}
