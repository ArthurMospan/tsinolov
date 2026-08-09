import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
import db from '../db/index';
import { startServer } from '../server/index';
import { runChecker, startChecker } from './checker';

dotenv.config();

const token = process.env.BOT_TOKEN?.trim().replace(/^("|')(.*)\1$/, '$2').trim();
if (!token) {
    console.error('❌ BOT_TOKEN is missing in .env');
    process.exit(1);
}

const bot = new Telegraf(token);

// Helper: get or create user
const getOrCreateUser = async (tgId: number) => {
    let user = await db.prepare('SELECT * FROM users WHERE tg_id = ?').get(tgId);
    if (!user) {
        await db.prepare('INSERT INTO users (tg_id) VALUES (?)').run(tgId);
        user = await db.prepare('SELECT * FROM users WHERE tg_id = ?').get(tgId);
    }
    await db.prepare('INSERT OR IGNORE INTO user_settings (tg_id) VALUES (?)').run(tgId);
    return user;
};

// Main Menu Keyboard with WebApp
const webAppUrl = process.env.WEBAPP_URL || 'https://example.com'; // In dev, use ngrok url

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
        '👋 Вітаємо у **Цінолов** від Сільпо! 🍊\n\n' +
        'Я допоможу тобі слідкувати за улюбленими товарами, повідомлятиму про круті знижки, ' +
        'смачні акції та вигідні пропозиції (Smart Buy) 🧠!\n\n' +
        'Натисни на кнопку нижче, щоб переглянути Улюблені товари та налаштувати сповіщення.',
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

// Start API Server
startServer();

bot.launch().then(() => {
    console.log('✅ Telegram Bot started!');
    bot.telegram.setChatMenuButton({
        menuButton: {
            type: 'web_app',
            text: '📱 Цінолов',
            web_app: { url: webAppUrl }
        }
    }).catch(console.error);
}).catch(err => {
    console.error('❌ Bot launch failed:', err);
    process.exit(1);
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

startChecker(bot);
