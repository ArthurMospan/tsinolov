import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import path from 'path';
import { createClient, type Client, type InArgs, type ResultSet } from '@libsql/client';

dotenv.config();

const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;
const turso: Client | null = tursoUrl
    ? createClient({ url: tursoUrl, authToken: tursoToken })
    : null;
const local = turso ? null : new Database(process.env.DATABASE_PATH || path.resolve(__dirname, '../../database.sqlite'));

if (local) local.pragma('foreign_keys = ON');

const schemaStatements = [
    `CREATE TABLE IF NOT EXISTS users (
        tg_id INTEGER PRIMARY KEY,
        access_token TEXT,
        refresh_token TEXT,
        mcp_token TEXT,
        notification_frequency TEXT DEFAULT 'all',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS user_settings (
        tg_id INTEGER PRIMARY KEY,
        price_drop BOOLEAN DEFAULT 1,
        price_target BOOLEAN DEFAULT 1,
        promo_new BOOLEAN DEFAULT 1,
        promo_personal BOOLEAN DEFAULT 1,
        in_stock BOOLEAN DEFAULT 1,
        delivery_available BOOLEAN DEFAULT 1,
        alt_cheaper BOOLEAN DEFAULT 1,
        smart_buy BOOLEAN DEFAULT 1,
        FOREIGN KEY(tg_id) REFERENCES users(tg_id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS products_state (
        product_id TEXT PRIMARY KEY,
        name TEXT,
        current_price REAL,
        old_price REAL,
        in_stock BOOLEAN,
        has_promo BOOLEAN,
        image_url TEXT,
        last_checked DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS user_favorites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tg_id INTEGER,
        product_id TEXT,
        target_price REAL,
        added_price REAL,
        FOREIGN KEY(tg_id) REFERENCES users(tg_id) ON DELETE CASCADE,
        FOREIGN KEY(product_id) REFERENCES products_state(product_id) ON DELETE CASCADE,
        UNIQUE(tg_id, product_id)
    )`,
    `CREATE TABLE IF NOT EXISTS user_product_state (
        tg_id INTEGER NOT NULL,
        product_id TEXT NOT NULL,
        current_price REAL,
        in_stock INTEGER,
        has_promo INTEGER,
        is_personal_promo INTEGER,
        delivery_available INTEGER,
        is_smart_buy INTEGER,
        alternative_price REAL,
        alternative_product_id TEXT,
        alternative_slug TEXT,
        alternative_comparison_price REAL,
        alternative_checked_at DATETIME,
        branch_id TEXT,
        delivery_type TEXT,
        observed_in_stock INTEGER,
        in_stock_observation_count INTEGER DEFAULT 0,
        observed_delivery_available INTEGER,
        delivery_observation_count INTEGER DEFAULT 0,
        last_checked DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (tg_id, product_id),
        FOREIGN KEY(tg_id) REFERENCES users(tg_id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS user_promo_state (
        tg_id INTEGER NOT NULL,
        promo_id TEXT NOT NULL,
        signature TEXT NOT NULL,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (tg_id, promo_id),
        FOREIGN KEY(tg_id) REFERENCES users(tg_id) ON DELETE CASCADE
    )`
];

function normalizeArgs(args: unknown[]): InArgs {
    return args.map(value => value === undefined ? null : value) as InArgs;
}

async function executeRemote(sql: string, args: unknown[] = []): Promise<ResultSet> {
    if (!turso) throw new Error('Turso is not configured');
    return turso.execute({ sql, args: normalizeArgs(args) });
}

async function runSchemaStatement(sql: string): Promise<void> {
    if (turso) {
        await turso.execute(sql);
    } else {
        local!.exec(sql);
    }
}

async function bootstrap(): Promise<void> {
    for (const statement of schemaStatements) await runSchemaStatement(statement);

    for (const [column, type] of [
        ['is_personal_promo', 'INTEGER'],
        ['delivery_available', 'INTEGER'],
        ['alternative_product_id', 'TEXT'],
        ['alternative_slug', 'TEXT'],
        ['alternative_comparison_price', 'REAL'],
        ['alternative_checked_at', 'DATETIME'],
        ['branch_id', 'TEXT'],
        ['delivery_type', 'TEXT'],
        ['observed_in_stock', 'INTEGER'],
        ['in_stock_observation_count', 'INTEGER DEFAULT 0'],
        ['observed_delivery_available', 'INTEGER'],
        ['delivery_observation_count', 'INTEGER DEFAULT 0']
    ] as const) {
        try {
            await runSchemaStatement(`ALTER TABLE user_product_state ADD COLUMN ${column} ${type}`);
        } catch {
            // The column already exists on an initialized database.
        }
    }
}

export const dbReady = bootstrap();

const db = {
    prepare(sql: string) {
        return {
            async get(...args: unknown[]) {
                await dbReady;
                if (turso) {
                    const result = await executeRemote(sql, args);
                    return result.rows[0] || undefined;
                }
                return local!.prepare(sql).get(...args);
            },
            async all(...args: unknown[]) {
                await dbReady;
                if (turso) {
                    const result = await executeRemote(sql, args);
                    return result.rows;
                }
                return local!.prepare(sql).all(...args);
            },
            async run(...args: unknown[]) {
                await dbReady;
                if (turso) {
                    const result = await executeRemote(sql, args);
                    return { changes: Number(result.rowsAffected || 0), lastInsertRowid: result.lastInsertRowid };
                }
                return local!.prepare(sql).run(...args);
            }
        };
    },
    async exec(sql: string) {
        await dbReady;
        if (turso) {
            const statements = sql.split(/;\s*(?=\n|$)/).map(statement => statement.trim()).filter(Boolean);
            for (const statement of statements) await turso.execute(statement);
            return;
        }
        local!.exec(sql);
    },
    async pragma(sql: string) {
        await dbReady;
        if (local) local.pragma(sql);
    }
};

export const usingTurso = Boolean(turso);
export default db;
