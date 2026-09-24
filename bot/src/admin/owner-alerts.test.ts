import assert from 'node:assert/strict';
import test from 'node:test';

// A throwaway database and fake bots, whatever the developer's .env says.
process.env.TURSO_DATABASE_URL = '';
process.env.DATABASE_PATH = ':memory:';
process.env.BOT_TOKEN = 'main-bot';
process.env.ADMIN_BOT_TOKEN = 'admin-bot';
process.env.ADMIN_TG_ID = '1000';

const sent: { token: string; chatId: number; text: string }[] = [];
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const [, token, method] = String(url).match(/\/bot([^/]+)\/(\w+)/) || [];
    const body = JSON.parse(String(init?.body || '{}'));
    if (method === 'sendMessage') sent.push({ token, chatId: body.chat_id, text: body.text });
    const result = method === 'getChat' ? { first_name: 'Kate', username: 'kate' } : {};
    return new Response(JSON.stringify({ ok: true, result }));
}) as typeof fetch;

test('the owner hears about a new guest from the separate admin bot, once an hour at most', async () => {
    const { recordActivity } = await import('./activity');
    await recordActivity(7, 'start', 'new');
    await recordActivity(7, 'start', 'again');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].token, 'admin-bot');
    assert.equal(sent[0].chatId, 1000);
    assert.match(sent[0].text, /Нова людина/);
    assert.match(sent[0].text, /Kate \(@kate\)/);
});

test('the owner is not told about their own actions', async () => {
    const { recordActivity } = await import('./activity');
    const before = sent.length;
    await recordActivity(1000, 'connected');
    assert.equal(sent.length, before);
});

test('an unsigned launch is reported with the device, since Telegram gives no name', async () => {
    const { recordActivity } = await import('./activity');
    const before = sent.length;
    await recordActivity(null, 'opened_without_identity', 'ios');
    assert.equal(sent.length, before + 1);
    assert.match(sent.at(-1)!.text, /без даних Telegram[\s\S]*iPhone/);
});

test('without the admin bot configured nothing is sent', async () => {
    const { recordActivity } = await import('./activity');
    const before = sent.length;
    process.env.ADMIN_BOT_TOKEN = '';
    try {
        await recordActivity(8, 'start', 'new');
    } finally {
        process.env.ADMIN_BOT_TOKEN = 'admin-bot';
    }
    assert.equal(sent.length, before);
});
