async function callTelegram(method: 'sendMessage' | 'sendPhoto', payload: Record<string, unknown>): Promise<void> {
    const token = process.env.BOT_TOKEN?.trim().replace(/^("|')(.*)\1$/, '$2').trim();
    if (!token) throw new Error('BOT_TOKEN is missing');

    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok || !data?.ok) throw new Error(`Telegram send failed: ${JSON.stringify(data).slice(0, 500)}`);
}

export interface TelegramInlineButton {
    text: string;
    callbackData: string;
}

export async function sendTelegramMessage(
    chatId: number,
    text: string,
    imageUrl?: string,
    button?: TelegramInlineButton
): Promise<void> {
    const replyMarkup = button
        ? { inline_keyboard: [[{ text: button.text, callback_data: button.callbackData }]] }
        : undefined;
    if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
        try {
            await callTelegram('sendPhoto', {
                chat_id: chatId,
                photo: imageUrl,
                caption: text,
                parse_mode: 'HTML',
                show_caption_above_media: false,
                reply_markup: replyMarkup,
            });
            return;
        } catch (error) {
            // A product host can reject Telegram's image fetch. The alert itself
            // is more important than the media, so retry it as plain text.
            console.warn('[Telegram] Product photo failed; sending text fallback:', error);
        }
    }

    await callTelegram('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: replyMarkup,
    });
}
