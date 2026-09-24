import assert from 'node:assert/strict';
import test from 'node:test';

// A throwaway database, even when a developer's .env points at Turso.
process.env.TURSO_DATABASE_URL = '';
process.env.DATABASE_PATH = ':memory:';

function stubSilpo(status: number) {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'invalid_token' }), { status })) as typeof fetch;
    return () => { globalThis.fetch = original; };
}

async function storedToken(tgId: number): Promise<unknown> {
    const { default: db } = await import('../db/index');
    const user = await db.prepare('SELECT mcp_token FROM users WHERE tg_id = ?').get(tgId) as any;
    return user?.mcp_token ?? null;
}

test('an ended Silpo session pauses the checks and tells the guest how to reconnect', async () => {
    const { default: db } = await import('../db/index');
    const { runUserCheck } = await import('./engine');
    await db.prepare('INSERT INTO users (tg_id, mcp_token) VALUES (?, ?)').run(7, 'ended');

    const sent: string[] = [];
    const restore = stubSilpo(401);
    try {
        const result = await runUserCheck(7, async (_chatId, text) => { sent.push(text); });
        assert.equal(result.checked, false);
    } finally {
        restore();
    }

    assert.equal(await storedToken(7), null);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /підключіть акаунт/);
});

test('a Silpo outage keeps the connection for the next check', async () => {
    const { default: db } = await import('../db/index');
    const { runUserCheck } = await import('./engine');
    await db.prepare('INSERT INTO users (tg_id, mcp_token) VALUES (?, ?)').run(8, 'alive');

    const sent: string[] = [];
    const restore = stubSilpo(503);
    try {
        await runUserCheck(8, async (_chatId, text) => { sent.push(text); });
    } finally {
        restore();
    }

    assert.equal(await storedToken(8), 'alive');
    assert.equal(sent.length, 0);
});
