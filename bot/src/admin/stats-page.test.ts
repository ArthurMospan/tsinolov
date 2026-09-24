import assert from 'node:assert/strict';
import test from 'node:test';
import { adminKeyMatches, renderStatsPage } from './stats-page';

const snapshot = {
    users: [
        { tgId: 1, startedAt: '2026-08-09 18:00:00', status: 'connected' as const, lastCheck: '2026-09-24 10:50:00' },
        { tgId: 2, startedAt: '2026-08-10 09:32:00', status: 'expired' as const, lastCheck: '2026-09-19 21:36:00' },
        { tgId: 3, startedAt: '2026-08-22 06:28:00', status: 'never' as const, lastCheck: null },
    ],
    events: [
        { tgId: null, event: 'opened_without_identity' as const, detail: 'ios', at: '2026-09-24 10:54:00' },
        { tgId: 3, event: 'connect_failed' as const, detail: 'expired', at: '2026-09-24 10:40:00' },
        { tgId: 2, event: 'start' as const, detail: 'again', at: '2026-09-24 10:30:00' },
    ],
};

test('the page shows every guest, their Silpo status and what happened, in Kyiv time', () => {
    const names = new Map([[1, 'Arthur (@arthur)'], [2, 'Olexiy (@olexiy)'], [3, 'Kate (@kate)']]);
    const html = renderStatsPage(snapshot, names);
    assert.match(html, /Arthur \(@arthur\)[\s\S]*підключено/);
    assert.match(html, /Olexiy \(@olexiy\)[\s\S]*вхід закінчився/);
    assert.match(html, /Kate \(@kate\)[\s\S]*не підключено/);
    assert.match(html, /Відкрито без даних Telegram[\s\S]*iPhone/);
    assert.match(html, /Вхід у Сільпо не вдався[\s\S]*не завершено або почато двічі/);
    assert.match(html, /24\.09, 13:54/);
});

test('names from Telegram cannot inject markup into the page', () => {
    const html = renderStatsPage(snapshot, new Map([[1, '<script>alert(1)</script>']]));
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;script&gt;/);
});

test('the page opens only with the exact, long enough key', () => {
    const key = 'k'.repeat(32);
    assert.equal(adminKeyMatches(key, key), true);
    assert.equal(adminKeyMatches('k'.repeat(31), key), false);
    assert.equal(adminKeyMatches('', key), false);
    assert.equal(adminKeyMatches('short', 'short'), false, 'a short configured key must never open the page');
    assert.equal(adminKeyMatches(key, undefined), false);
});
