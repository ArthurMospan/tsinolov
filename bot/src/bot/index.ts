import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
import db from '../db/index';
import { startServer } from '../server/index';

dotenv.config();

const token = process.env.BOT_TOKEN;
if (!token) {
    console.error('❌ BOT_TOKEN is missing in .env');
    process.exit(1);
}

const bot = new Telegraf(token);

// Helper: get or create user
const getOrCreateUser = (tgId: number) => {
    let user = db.prepare('SELECT * FROM users WHERE tg_id = ?').get(tgId);
    if (!user) {
        db.prepare('INSERT INTO users (tg_id) VALUES (?)').run(tgId);
        db.prepare('INSERT INTO user_settings (tg_id) VALUES (?)').run(tgId);
        user = db.prepare('SELECT * FROM users WHERE tg_id = ?').get(tgId);
    }
    return user;
};

// Main Menu Keyboard with WebApp
const webAppUrl = process.env.WEBAPP_URL || 'https://example.com'; // In dev, use ngrok url

const mainMenu = Markup.keyboard([
    [Markup.button.webApp('📱 Відкрити застосунок', webAppUrl)]
]).resize();

bot.start((ctx) => {
    const tgId = ctx.from.id;
    getOrCreateUser(tgId);
    
    ctx.reply(
        '👋 Вітаємо у **Цінолов** від Сільпо! 🍊\n\n' +
        'Я допоможу тобі слідкувати за улюбленими товарами, повідомлятиму про круті знижки, ' +
        'смачні акції та вигідні пропозиції (Smart Buy) 🧠!\n\n' +
        'Натисни на кнопку нижче, щоб переглянути своє Обране та налаштувати сповіщення.',
        {
            parse_mode: 'Markdown',
            ...mainMenu
        }
    );
});

// Start API Server
startServer(3000);

bot.launch().then(() => {
    console.log('✅ Telegram Bot started!');
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
