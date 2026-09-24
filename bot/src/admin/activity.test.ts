import assert from 'node:assert/strict';
import test from 'node:test';

// A throwaway database, even when a developer's .env points at Turso.
process.env.TURSO_DATABASE_URL = '';
process.env.DATABASE_PATH = ':memory:';

test('events are kept with the newest first', async () => {
    const { recordActivity, activitySnapshot } = await import('./activity');
    await recordActivity(1, 'start', 'new');
    await recordActivity(1, 'connected');
    const { events } = await activitySnapshot();
    assert.deepEqual(events.slice(0, 2).map(event => [event.tgId, event.event]), [[1, 'connected'], [1, 'start']]);
});

test('an anonymous event is kept at most once a minute, so the open endpoint cannot flood the log', async () => {
    const { recordActivity, activitySnapshot } = await import('./activity');
    await recordActivity(null, 'opened_without_identity', 'ios');
    await recordActivity(null, 'opened_without_identity', 'ios');
    const { events } = await activitySnapshot();
    assert.equal(events.filter(event => event.event === 'opened_without_identity').length, 1);
});

test('each guest gets a Silpo status: connected, login expired, or never connected', async () => {
    const { default: db } = await import('../db/index');
    const { activitySnapshot } = await import('./activity');
    await db.prepare('INSERT INTO users (tg_id, mcp_token) VALUES (?, ?)').run(20, 'live');
    await db.prepare('INSERT INTO users (tg_id) VALUES (?)').run(21);
    await db.prepare(`
        INSERT INTO user_product_state (tg_id, product_id, last_checked) VALUES (?, ?, ?)
    `).run(21, 'milk', '2026-09-09 21:56:00');
    await db.prepare('INSERT INTO users (tg_id) VALUES (?)').run(22);

    const statuses = new Map((await activitySnapshot()).users.map(user => [user.tgId, user]));
    assert.equal(statuses.get(20)?.status, 'connected');
    assert.equal(statuses.get(21)?.status, 'expired');
    assert.equal(statuses.get(21)?.lastCheck, '2026-09-09 21:56:00');
    assert.equal(statuses.get(22)?.status, 'never');
});
