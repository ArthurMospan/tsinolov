export async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
    const token = process.env.BOT_TOKEN?.trim().replace(/^("|')(.*)\1$/, '$2').trim();
    if (!token) throw new Error('BOT_TOKEN is missing');

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: false })
    });
    const data = await response.json();
    if (!response.ok || !data?.ok) throw new Error(`Telegram send failed: ${JSON.stringify(data).slice(0, 500)}`);
}
