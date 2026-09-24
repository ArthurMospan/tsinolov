import assert from 'node:assert/strict';
import test from 'node:test';

// A throwaway database, even when a developer's .env points at Turso.
process.env.TURSO_DATABASE_URL = '';
process.env.DATABASE_PATH = ':memory:';

const pending = {
    tgId: 42,
    clientId: 'client',
    codeVerifier: 'verifier',
    redirectUri: 'https://example.test/auth/callback',
};

test('a login waits for Silpo to send the guest back and cannot be replayed', async () => {
    const { rememberPendingAuth, takePendingAuth } = await import('./oauth-state');
    await rememberPendingAuth('state-a', pending);
    assert.deepEqual(await takePendingAuth('state-a'), pending);
    assert.equal(await takePendingAuth('state-a'), null);
});

test('starting the login again does not break the first attempt', async () => {
    const { rememberPendingAuth, takePendingAuth } = await import('./oauth-state');
    await rememberPendingAuth('first', pending);
    await rememberPendingAuth('second', { ...pending, codeVerifier: 'other' });
    assert.equal((await takePendingAuth('first'))?.codeVerifier, 'verifier');
    assert.equal((await takePendingAuth('second'))?.codeVerifier, 'other');
});

test('an abandoned login expires', async () => {
    const { default: db } = await import('../db/index');
    const { takePendingAuth } = await import('./oauth-state');
    await db.prepare(`
        INSERT INTO oauth_states (state, tg_id, client_id, code_verifier, redirect_uri, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run('stale', 42, 'client', 'verifier', pending.redirectUri, Math.floor(Date.now() / 1000) - 1);
    assert.equal(await takePendingAuth('stale'), null);
});
