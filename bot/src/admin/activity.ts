import db from '../db/index';

// A private log for the owner: who started the bot, who connected Silpo, and
// where guests got stuck. It never holds anything from the Silpo account.

export type ActivityEvent =
    | 'start'
    | 'connected'
    | 'connect_failed'
    | 'session_ended'
    | 'load_failed'
    | 'identity_rejected'
    | 'opened_without_identity';

export interface ActivityRecord {
    tgId: number | null;
    event: ActivityEvent;
    detail: string;
    at: string;
}

export interface GuestStatus {
    tgId: number;
    startedAt: string;
    status: 'connected' | 'expired' | 'never';
    lastCheck: string | null;
}

export interface ActivitySnapshot {
    users: GuestStatus[];
    events: ActivityRecord[];
}

/** Never throws: a log that fails must not break the flow it describes. */
export async function recordActivity(tgId: number | null, event: ActivityEvent, detail = ''): Promise<void> {
    try {
        if (tgId === null) {
            // Anonymous events come from an open endpoint; one a minute says enough.
            const recent = await db.prepare(`
                SELECT 1 FROM user_events
                WHERE tg_id IS NULL AND event = ? AND created_at >= datetime('now', '-1 minutes')
            `).get(event);
            if (recent) return;
        }
        await db.prepare('INSERT INTO user_events (tg_id, event, detail) VALUES (?, ?, ?)').run(tgId, event, detail);
    } catch (error) {
        console.error(`[Activity] Failed to record ${event}:`, error);
    }
}

export async function activitySnapshot(eventLimit = 100): Promise<ActivitySnapshot> {
    const users = await db.prepare(`
        SELECT u.tg_id,
               u.created_at,
               u.mcp_token IS NOT NULL AS connected,
               COALESCE(s.onboarding_completed, 0) AS onboarded,
               (SELECT MAX(last_checked) FROM user_product_state p WHERE p.tg_id = u.tg_id) AS last_check
        FROM users u
        LEFT JOIN user_settings s ON s.tg_id = u.tg_id
        ORDER BY u.created_at DESC
    `).all() as any[];
    const events = await db.prepare(`
        SELECT tg_id, event, detail, created_at FROM user_events ORDER BY id DESC LIMIT ?
    `).all(eventLimit) as any[];

    return {
        users: users.map(row => ({
            tgId: Number(row.tg_id),
            startedAt: String(row.created_at),
            // A guest who ever got a price check or finished onboarding had connected.
            status: Number(row.connected) ? 'connected'
                : row.last_check || Number(row.onboarded) ? 'expired'
                : 'never',
            lastCheck: row.last_check ? String(row.last_check) : null,
        })),
        events: events.map(row => ({
            tgId: row.tg_id === null || row.tg_id === undefined ? null : Number(row.tg_id),
            event: row.event as ActivityEvent,
            detail: String(row.detail || ''),
            at: String(row.created_at),
        })),
    };
}
