import { Markup } from 'telegraf';

// Telegram gives no signed initData to a Mini App opened from a reply-keyboard
// button, so the app could not tell who opened it. Inline and menu buttons carry it.
export function openAppKeyboard(webAppUrl: string) {
    return Markup.inlineKeyboard([[Markup.button.webApp('📱 Відкрити застосунок', webAppUrl)]]);
}
