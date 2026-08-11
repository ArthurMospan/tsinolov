import test from 'node:test';
import assert from 'node:assert/strict';
import { sendTelegramMessage } from './telegram';

test('sends automatic Telegram alerts without notification sound', async () => {
    const originalFetch = globalThis.fetch;
    const originalToken = process.env.BOT_TOKEN;
    const payloads: Record<string, unknown>[] = [];
    process.env.BOT_TOKEN = 'test-token';
    globalThis.fetch = (async (_input, init) => {
        payloads.push(JSON.parse(String(init?.body || '{}')));
        return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    }) as typeof fetch;

    try {
        await sendTelegramMessage(123, 'Price alert');
        await sendTelegramMessage(123, 'Photo alert', 'https://example.com/product.jpg');
    } finally {
        globalThis.fetch = originalFetch;
        if (originalToken === undefined) delete process.env.BOT_TOKEN;
        else process.env.BOT_TOKEN = originalToken;
    }

    assert.equal(payloads.length, 2);
    assert.equal(payloads[0].disable_notification, true);
    assert.equal(payloads[1].disable_notification, true);
});
