import db from '../db/index';

// The Silpo login takes the guest away between /auth/start and /auth/callback.
// Each attempt is kept in the database under its own `state`, so a restart in
// between or a second tap on "Підключити" no longer loses the handshake.

export interface PendingAuth {
    tgId: number;
    clientId: string;
    codeVerifier: string;
    redirectUri: string;
}

const PENDING_TTL_SECONDS = 10 * 60;

export async function rememberPendingAuth(state: string, pending: PendingAuth): Promise<void> {
    await db.prepare(`
        INSERT INTO oauth_states (state, tg_id, client_id, code_verifier, redirect_uri, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(
        state,
        pending.tgId,
        pending.clientId,
        pending.codeVerifier,
        pending.redirectUri,
        Math.floor(Date.now() / 1000) + PENDING_TTL_SECONDS
    );
}

/** Reads a pending login and consumes it, so an authorization code cannot be replayed. */
export async function takePendingAuth(state: string): Promise<PendingAuth | null> {
    const now = Math.floor(Date.now() / 1000);
    const row = await db.prepare('SELECT * FROM oauth_states WHERE state = ?').get(state) as any;
    await db.prepare('DELETE FROM oauth_states WHERE state = ? OR expires_at < ?').run(state, now);
    if (!row || Number(row.expires_at) <= now) return null;
    return {
        tgId: Number(row.tg_id),
        clientId: String(row.client_id),
        codeVerifier: String(row.code_verifier),
        redirectUri: String(row.redirect_uri),
    };
}
