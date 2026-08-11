import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
import db from '../db/index';
import { callMCPTool } from '../api/mcp-direct';
import { getStoreContext, parseMcpContent } from '../api/store-context';
import { getUserStoreContext } from '../api/user-store-context';
import { startServer } from '../server/index';
import { runChecker, startChecker } from './checker';

dotenv.config();

const token = process.env.BOT_TOKEN?.trim().replace(/^("|')(.*)\1$/, '$2').trim();
if (!token) {
    console.error('❌ BOT_TOKEN is required');
    process.exit(1);
}

const webAppUrl = process.env.WEBAPP_URL?.trim() || '';
if (!webAppUrl || !/^https:\/\//i.test(webAppUrl)) {
    console.error('❌ WEBAPP_URL must be a public HTTPS address');
    process.exit(1);
}

const bot = new Telegraf(token);

function shoppingCartIdFrom(value: any, visited = new Set<any>()): string | undefined {
    if (!value || typeof value !== 'object' || visited.has(value)) return undefined;
    visited.add(value);
    const direct = value.shoppingCartId || value.cartId;
    if (direct) return String(direct);
    if (Array.isArray(value)) {
        for (const item of value) {
            const nested = shoppingCartIdFrom(item, visited);
            if (nested) return nested;
        }
        return undefined;
    }
    for (const nestedValue of Object.values(value)) {
        const nested = shoppingCartIdFrom(nestedValue, visited);
        if (nested) return nested;
    }
    return undefined;
}

const getOrCreateUser = async (tgId: number) => {
    let user = await db.prepare('SELECT * FROM users WHERE tg_id = ?').get(tgId);
    if (!user) {
        await db.prepare('INSERT INTO users (tg_id) VALUES (?)').run(tgId);
        user = await db.prepare('SELECT * FROM users WHERE tg_id = ?').get(tgId);
    }
    await db.prepare('INSERT OR IGNORE INTO user_settings (tg_id) VALUES (?)').run(tgId);
    return user;
};

const mainMenu = Markup.keyboard([
    [Markup.button.webApp('📱 Відкрити застосунок', webAppUrl)]
]).resize();

bot.start(async (ctx) => {
    const tgId = ctx.from.id;
    await getOrCreateUser(tgId);
    
    await ctx.setChatMenuButton({
        type: 'web_app',
        text: '📱 Цінолов',
        web_app: { url: webAppUrl }
    });

    ctx.reply(
        'Вітаємо у *Цінолов від Сільпо*! 🍊\n\n' +
        'Допоможу зловити *найкращі ціни* на твої улюблені товари. Встановлюй *бажану вартість*, ' +
        'а я повідомлю, щойно товар подешевшає до цієї суми! Крім того, ділитимуся з тобою ' +
        'найсмачнішими акціями.\n\n' +
        'Натискай на кнопку нижче, щоб перейти до *«Улюблених товарів»* та налаштувати сповіщення.',
        {
            parse_mode: 'Markdown',
            ...mainMenu
        }
    );
});

bot.command('test_notification', async (ctx) => {
    await getOrCreateUser(ctx.from.id);
    await ctx.reply('✅ Тестове сповіщення працює. Telegram успішно отримує повідомлення від бота.');
});

bot.command('check_now', async (ctx) => {
    await getOrCreateUser(ctx.from.id);
    await ctx.reply('⏳ Запускаю перевірку цін для цього користувача...');
    const result = await runChecker(bot, ctx.from.id);
    await ctx.reply(result);
});

bot.action(/^cart:([a-f0-9]{16})$/, async (ctx) => {
    const actionId = ctx.match[1];
    const tgId = ctx.from.id;
    const action = await db.prepare(`
        SELECT product_id, company_id, quantity
        FROM telegram_cart_actions
        WHERE action_id = ? AND tg_id = ? AND created_at >= datetime('now', '-7 days')
    `).get(actionId, tgId) as any;
    if (!action) {
        await ctx.answerCbQuery('Ця кнопка вже неактивна', { show_alert: true });
        return;
    }

    await ctx.answerCbQuery('Додаю в кошик…');
    try {
        const user = await db.prepare('SELECT mcp_token FROM users WHERE tg_id = ?').get(tgId) as any;
        if (!user?.mcp_token) throw new Error('Silpo account is not connected');
        const context = await getUserStoreContext(tgId, String(user.mcp_token));
        const cartContext = await getStoreContext(String(user.mcp_token));
        if (context.branchId !== cartContext.branchId
            || context.deliveryType.toLowerCase() !== cartContext.deliveryType.toLowerCase()) {
            throw new Error('CONTEXT_MISMATCH');
        }
        const cartResponse = await callMCPTool(String(user.mcp_token), 'silpo_get_my_shopping_cart');
        const shoppingCartId = shoppingCartIdFrom(parseMcpContent(cartResponse));
        if (!shoppingCartId) throw new Error('MCP did not return shopping cart id');

        await callMCPTool(String(user.mcp_token), 'silpo_add_or_update_cart_products', {
            shoppingCartId: String(shoppingCartId),
            products: [{
                productId: String(action.product_id),
                companyId: String(action.company_id),
                branchId: context.branchId,
                quantity: Math.max(1, Number(action.quantity) || 1),
                addQuantity: true,
            }],
        });
        await db.prepare('DELETE FROM telegram_cart_actions WHERE action_id = ?').run(actionId);
        await ctx.editMessageReplyMarkup({
            inline_keyboard: [[{ text: '✅ Додано в корзину', callback_data: 'cart_done' }]],
        }).catch(() => undefined);
    } catch (error) {
        console.error('[Telegram] Failed to add notification product to cart:', error);
        await ctx.reply(error instanceof Error && error.message === 'CONTEXT_MISMATCH'
            ? 'У Сільпо зараз вибрана інша адреса або магазин. Змініть спосіб отримання в Сільпо й спробуйте ще раз.'
            : 'Не вдалося додати товар у кошик. Спробуйте ще раз трохи пізніше.');
    }
});

bot.action('cart_done', async ctx => {
    await ctx.answerCbQuery('Товар уже додано в корзину');
});

startServer();

let stopping = false;
let pollingRetryTimer: NodeJS.Timeout | undefined;
let pollingRetryAttempt = 0;

async function startTelegramPolling(): Promise<void> {
    try {
        await bot.launch();
        console.log('✅ Telegram Bot started!');
        bot.telegram.setChatMenuButton({
            menuButton: {
                type: 'web_app',
                text: '📱 Цінолов',
                web_app: { url: webAppUrl }
            }
        }).catch(console.error);
    } catch (error) {
        if (stopping) return;

        // Render may briefly overlap the old and new release. Telegram permits only
        // one long-polling session, so a temporary conflict must not kill the API.
        pollingRetryAttempt += 1;
        const retryMs = Math.min(30_000, 1_000 * 2 ** Math.min(pollingRetryAttempt, 5));
        console.error(`Telegram polling failed; retrying in ${retryMs / 1000}s`, error);
        pollingRetryTimer = setTimeout(() => void startTelegramPolling(), retryMs);
    }
}

void startTelegramPolling();

function stopBot(signal: 'SIGINT' | 'SIGTERM') {
    stopping = true;
    if (pollingRetryTimer) clearTimeout(pollingRetryTimer);
    bot.stop(signal);
}

process.once('SIGINT', () => stopBot('SIGINT'));
process.once('SIGTERM', () => stopBot('SIGTERM'));

startChecker(bot);
