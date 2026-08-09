import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';

function initDataFromRequest(req: Request): string {
    const header = req.headers['x-telegram-init-data'];
    if (typeof header === 'string' && header.trim()) return header.trim();
    if (Array.isArray(header) && header[0]?.trim()) return header[0].trim();
    const queryValue = req.query.init_data;
    return typeof queryValue === 'string' ? queryValue.trim() : '';
}

function telegramBotToken(): string {
    const configured = process.env.BOT_TOKEN?.trim() || '';
    return configured.replace(/^("|')(.*)\1$/, '$2').trim();
}

function validateInitData(initData: string, expectedTgId: number): boolean {
    const botToken = telegramBotToken();
    if (!botToken || !initData) return false;

    const params = new URLSearchParams(initData);
    const receivedHash = params.get('hash');
    if (!receivedHash) return false;
    params.delete('hash');

    const dataCheckString = [...params.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
    const secretKey = crypto.createHmac('sha256', botToken).update('WebAppData').digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (calculatedHash.length !== receivedHash.length) return false;

    const hashMatches = crypto.timingSafeEqual(Buffer.from(calculatedHash), Buffer.from(receivedHash));
    if (!hashMatches) return false;

    try {
        const user = JSON.parse(params.get('user') || '{}');
        return Number(user.id) === expectedTgId;
    } catch {
        return false;
    }
}

export function requireTelegramWebApp(req: Request, res: Response, next: NextFunction) {
    const expectedTgId = Number(req.query.tg_id || req.body?.tg_id);
    if (!expectedTgId) return res.status(400).json({ error: 'Missing tg_id' });

    const initData = initDataFromRequest(req);
    const allowDevelopmentFallback = process.env.NODE_ENV !== 'production';
    if (!initData && allowDevelopmentFallback) return next();
    if (!validateInitData(initData, expectedTgId)) {
        let hasHash = false;
        let hasUser = false;
        try {
            const params = new URLSearchParams(initData);
            hasHash = Boolean(params.get('hash'));
            hasUser = Boolean(params.get('user'));
        } catch {
            // Do not include the signed initData in logs.
        }
        console.warn('[Auth] Telegram WebApp identity rejected', {
            tgId: expectedTgId,
            hasInitData: Boolean(initData),
            initDataLength: initData.length,
            hasHash,
            hasUser,
            hasBotToken: Boolean(telegramBotToken()),
        });
        return res.status(401).json({ error: 'Invalid Telegram WebApp identity' });
    }
    next();
}
