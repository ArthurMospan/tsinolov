import db from '../db/index';

export const RECONNECT_HINT = 'Відкрийте «🏷️ Цінолов» і підключіть акаунт Сільпо ще раз.';

// Silpo refuses a token only once the session behind it has ended, so the token
// is dropped and every surface asks the guest to reconnect. It is matched by
// value: a check that began before the guest reconnected must not wipe the new one.
export async function forgetSilpoToken(tgId: number, rejectedToken: string): Promise<void> {
    await db.prepare('UPDATE users SET mcp_token = NULL WHERE tg_id = ? AND mcp_token = ?').run(tgId, rejectedToken);
}
