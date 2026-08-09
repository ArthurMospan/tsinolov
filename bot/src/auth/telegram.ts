import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';

function initDataFromRequest(req: Request): string {
    const header = req.headers['x-telegram-init-data'];
    if (typeof header === 'string' && header) return header;
    const queryValue = req.query.init_data;
    return typeof queryValue === 'string' ? queryValue : '';
}

function validateInitData(initData: string, expectedTgId: number): boolean {
    const botToken = process.env.BOT_TOKEN;
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
        return res.status(401).json({ error: 'Invalid Telegram WebApp identity' });
    }
    next();
}
