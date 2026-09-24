import db from '../db/index';
import { telegramDisplayName } from '../api/telegram';
import { bold, escapeTelegramHtml } from '../notifications/telegram-format';
import type { ActivityEvent } from './activity';
import { DETAIL_LABELS } from './stats-page';

// Tells the owner, through a separate admin bot, that someone new arrived or got
// stuck. The guest-facing bot is never used for this, and without ADMIN_BOT_TOKEN
// and ADMIN_TG_ID nothing is sent at all.

const SAME_GUEST_QUIET_MINUTES = 60;
const ANONYMOUS_QUIET_MINUTES = 15;

function adminBotToken(): string {
    return (process.env.ADMIN_BOT_TOKEN || '').trim().replace(/^("|')(.*)\1$/, '$2').trim();
}

function alertText(event: ActivityEvent, detail: string, who: string): string {
    const reason = escapeTelegramHtml(DETAIL_LABELS[detail] || detail);
    switch (event) {
        case 'start':
            return detail === 'new' ? `🆕 ${bold('Нова людина в Цінолові')}\n${who}` : `🔁 ${bold('Знову /start')}\n${who}`;
        case 'connected':
            return `✅ ${bold('Підключено Сільпо')}\n${who}`;
        case 'connect_failed':
            return `⚠️ ${bold('Вхід у Сільпо не вдався')}\n${who || 'Хто саме, невідомо'}\n${reason}`;
        case 'session_ended':
            return `⏳ ${bold('Сесія Сільпо завершилась')}\n${who}\nЗастосунок попросив увійти знову (${reason}).`;
        case 'load_failed':
            return `⚠️ ${bold('Дані не завантажились')}\n${who}\n${reason}`;
        case 'identity_rejected':
            return `⚠️ ${bold('Telegram-підпис не пройшов перевірку')}\n${who}`;
        case 'opened_without_identity':
            return `⚠️ ${bold('Застосунок відкрили без даних Telegram')}\n${reason}. Хто саме, Telegram не передає.`;
    }
}

/** Called right after an event is stored; the same event from the same guest is reported once an hour. */
export async function alertOwner(tgId: number | null, event: ActivityEvent, detail: string): Promise<void> {
    const owner = Number(process.env.ADMIN_TG_ID || 0);
    const token = adminBotToken();
    if (!owner || !token || tgId === owner) return;

    const quietMinutes = tgId === null ? ANONYMOUS_QUIET_MINUTES : SAME_GUEST_QUIET_MINUTES;
    const recent = await db.prepare(`
        SELECT COUNT(*) AS count FROM user_events
        WHERE tg_id IS ? AND event = ? AND created_at >= datetime('now', ?)
    `).get(tgId, event, `-${quietMinutes} minutes`) as any;
    if (Number(recent?.count) > 1) return;

    const who = tgId === null ? '' : escapeTelegramHtml(await telegramDisplayName(tgId) || `ID ${tgId}`);
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: owner,
            text: alertText(event, detail, who),
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
        }),
    });
    const data: any = await response.json().catch(() => null);
    if (!data?.ok) throw new Error(`Admin bot could not reach the owner: ${JSON.stringify(data).slice(0, 200)}`);
}
