import crypto from 'crypto';
import { escapeTelegramHtml as escapeHtml } from '../notifications/telegram-format';
import type { ActivityRecord, ActivitySnapshot, GuestStatus } from './activity';

const MIN_KEY_LENGTH = 24;

/** The page answers only to its exact secret key, compared in constant time. */
export function adminKeyMatches(provided: string, configured: string | undefined): boolean {
    const expected = Buffer.from(String(configured || ''));
    const given = Buffer.from(provided);
    if (expected.length < MIN_KEY_LENGTH || given.length !== expected.length) return false;
    return crypto.timingSafeEqual(given, expected);
}

const STATUS_LABELS: Record<GuestStatus['status'], string> = {
    connected: '✅ підключено',
    expired: '⏳ вхід закінчився',
    never: '— не підключено',
};

const EVENT_LABELS: Record<ActivityRecord['event'], string> = {
    start: '/start',
    connected: '✅ Підключено Сільпо',
    connect_failed: '⚠️ Вхід у Сільпо не вдався',
    session_ended: '⏳ Сесія Сільпо завершилась',
    load_failed: '⚠️ Дані не завантажились',
    identity_rejected: '⚠️ Telegram-підпис не пройшов перевірку',
    opened_without_identity: '⚠️ Відкрито без даних Telegram',
};

export const DETAIL_LABELS: Record<string, string> = {
    cancelled: 'скасовано на сторінці Сільпо',
    expired: 'не завершено або почато двічі',
    failed: 'Сільпо не видав доступ',
    start_failed: 'Сільпо не відповів на старті входу',
    app: 'у застосунку',
    price_check: 'під час перевірки цін',
    cart_button: 'кнопка «у кошик» у сповіщенні',
    profile: 'профіль і магазин',
    favorites: 'улюблені товари',
    ios: 'iPhone, скоріше за все стара кнопка під полем вводу',
    android: 'Android, скоріше за все стара кнопка під полем вводу',
    tdesktop: 'Telegram на комп\'ютері, скоріше за все стара кнопка',
    macos: 'Telegram на Mac, скоріше за все стара кнопка',
    weba: 'вебверсія Telegram',
    webk: 'вебверсія Telegram',
};

const PROBLEM_EVENTS = new Set<ActivityRecord['event']>([
    'connect_failed', 'session_ended', 'load_failed', 'identity_rejected', 'opened_without_identity',
]);

function fromDb(value: string): Date {
    return new Date(value.replace(' ', 'T') + 'Z');
}

function kyiv(date: Date, withTime = true): string {
    if (!Number.isFinite(date.getTime())) return '—';
    return date.toLocaleString('uk-UA', {
        timeZone: 'Europe/Kyiv',
        day: '2-digit',
        month: '2-digit',
        ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    });
}

function eventLabel(event: ActivityRecord): string {
    if (event.event === 'start') return event.detail === 'new' ? '🆕 Перший /start' : '🔁 Знову /start';
    return EVENT_LABELS[event.event] || event.event;
}

export function renderStatsPage(snapshot: ActivitySnapshot, names: Map<number, string>, now = new Date()): string {
    const who = (tgId: number | null) => escapeHtml(tgId === null ? 'невідомо' : names.get(tgId) || `ID ${tgId}`);
    const count = (status: GuestStatus['status']) => snapshot.users.filter(user => user.status === status).length;
    const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    const recentProblems = snapshot.events
        .filter(event => PROBLEM_EVENTS.has(event.event) && fromDb(event.at).getTime() >= weekAgo).length;

    const tiles = [
        ['Людей', snapshot.users.length],
        ['Підключено', count('connected')],
        ['Вхід закінчився', count('expired')],
        ['Не підключено', count('never')],
        ['Проблем за 7 днів', recentProblems],
    ].map(([label, value]) => `<div class="tile"><span>${label}</span><strong>${value}</strong></div>`).join('');

    const guests = snapshot.users.map(user => `
        <tr>
          <td>${kyiv(fromDb(user.startedAt), false)}</td>
          <td>${who(user.tgId)}</td>
          <td class="status-${user.status}">${STATUS_LABELS[user.status]}</td>
          <td>${user.lastCheck ? kyiv(fromDb(user.lastCheck)) : '—'}</td>
        </tr>`).join('');

    const events = snapshot.events.map(event => `
        <tr class="${PROBLEM_EVENTS.has(event.event) ? 'problem' : ''}">
          <td>${kyiv(fromDb(event.at))}</td>
          <td>${who(event.tgId)}</td>
          <td>${escapeHtml(eventLabel(event))}</td>
          <td>${escapeHtml(DETAIL_LABELS[event.detail] || (event.event === 'start' ? '' : event.detail))}</td>
        </tr>`).join('');

    return `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Цінолов — статистика</title>
<style>
  :root {
    --bg: #f6f4f1; --surface: #ffffff; --ink: #1f1a16; --muted: #6e645c; --line: #e7e1da;
    --accent: #d9581a; --problem: #fff1e8; --good: #1f7a3a;
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #141210; --surface: #1d1a17; --ink: #f1ebe5; --muted: #a99f96; --line: #302a25;
      --accent: #ff8743; --problem: #3a2416; --good: #6fd08f;
      color-scheme: dark;
    }
  }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; padding: 24px 16px 48px; }
  main { max-width: 980px; margin: 0 auto; display: grid; gap: 24px; }
  header { display: grid; gap: 4px; }
  h1 { margin: 0; font-size: 24px; }
  h2 { margin: 0 0 8px; font-size: 16px; }
  .muted { color: var(--muted); font-size: 13px; margin: 0; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
  .tile { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; display: grid; gap: 2px; }
  .tile span { color: var(--muted); font-size: 13px; }
  .tile strong { font-size: 24px; font-variant-numeric: tabular-nums; }
  .table { overflow-x: auto; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; }
  table { width: 100%; border-collapse: collapse; min-width: 560px; }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--muted); font-weight: 600; font-size: 13px; }
  tr:last-child td { border-bottom: 0; }
  td:first-child { white-space: nowrap; font-variant-numeric: tabular-nums; }
  tr.problem { background: var(--problem); }
  .status-connected { color: var(--good); }
  .status-expired { color: var(--accent); }
</style>
</head>
<body>
<main>
  <header>
    <h1>Цінолов — статистика</h1>
    <p class="muted">Оновлено ${kyiv(now)} за Києвом. Сторінка приватна: не діліться посиланням.</p>
  </header>
  <section class="tiles">${tiles}</section>
  <section>
    <h2>Люди</h2>
    <div class="table"><table>
      <thead><tr><th>Перший /start</th><th>Хто</th><th>Сільпо</th><th>Остання перевірка цін</th></tr></thead>
      <tbody>${guests || '<tr><td colspan="4">Ще нікого немає</td></tr>'}</tbody>
    </table></div>
  </section>
  <section>
    <h2>Журнал подій</h2>
    <div class="table"><table>
      <thead><tr><th>Коли</th><th>Хто</th><th>Що сталося</th><th>Деталі</th></tr></thead>
      <tbody>${events || '<tr><td colspan="4">Подій ще немає: журнал почав вестися з цього оновлення</td></tr>'}</tbody>
    </table></div>
  </section>
</main>
</body>
</html>`;
}
