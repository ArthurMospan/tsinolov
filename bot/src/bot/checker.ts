import { Telegraf } from 'telegraf';
import db from '../db/index';
import { runUserCheck } from '../notifications/engine';

export async function runChecker(bot: Telegraf, onlyTgId?: number): Promise<string> {
    const users = await db.prepare(
        onlyTgId
            ? 'SELECT tg_id FROM users WHERE tg_id = ? AND mcp_token IS NOT NULL'
            : 'SELECT tg_id FROM users WHERE mcp_token IS NOT NULL'
    ).all(...(onlyTgId ? [onlyTgId] : [])) as any[];

    let checked = 0;
    let products = 0;
    let notifications = 0;
    let errors = 0;

    for (const user of users) {
        const result = await runUserCheck(Number(user.tg_id), (chatId, text) => bot.telegram.sendMessage(chatId, text));
        if (result.checked) checked++;
        products += result.products;
        notifications += result.notifications;
        if (result.error) errors++;
    }

    return `Перевірка завершена: користувачів — ${checked}, товарів — ${products}, сповіщень — ${notifications}, помилок — ${errors}.`;
}

export function startChecker(bot: Telegraf) {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try { await runChecker(bot); }
        finally { running = false; }
    };
    setTimeout(() => void run(), 5000);
    // Five minutes is responsive enough for price tracking and avoids hammering Silpo MCP.
    setInterval(() => void run(), 5 * 60 * 1000);
}
