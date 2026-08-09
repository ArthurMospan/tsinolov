DROP TABLE IF EXISTS user_favorites;
DROP TABLE IF EXISTS user_product_state;
DROP TABLE IF EXISTS products_state;
DROP TABLE IF EXISTS user_settings;
DROP TABLE IF EXISTS users;

CREATE TABLE IF NOT EXISTS users (
    tg_id INTEGER PRIMARY KEY,
    access_token TEXT,
    refresh_token TEXT,
    mcp_token TEXT,
    notification_frequency TEXT DEFAULT 'all', -- 'important', 'all', 'daily_digest'
    monitor_branch_id TEXT,
    monitor_delivery_type TEXT,
    monitor_store_label TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_settings (
    tg_id INTEGER PRIMARY KEY,
    price_drop BOOLEAN DEFAULT 0,
    price_target BOOLEAN DEFAULT 0,
    promo_new BOOLEAN DEFAULT 0,
    promo_personal BOOLEAN DEFAULT 0,
    in_stock BOOLEAN DEFAULT 0,
    delivery_available BOOLEAN DEFAULT 0,
    alt_cheaper BOOLEAN DEFAULT 0,
    smart_buy BOOLEAN DEFAULT 0,
    onboarding_completed BOOLEAN DEFAULT 0,
    FOREIGN KEY(tg_id) REFERENCES users(tg_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS products_state (
    product_id TEXT PRIMARY KEY,
    name TEXT,
    current_price REAL,
    old_price REAL,
    in_stock BOOLEAN,
    has_promo BOOLEAN,
    image_url TEXT,
    last_checked DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tg_id INTEGER,
    product_id TEXT,
    target_price REAL,
    added_price REAL,
    FOREIGN KEY(tg_id) REFERENCES users(tg_id) ON DELETE CASCADE,
    FOREIGN KEY(product_id) REFERENCES products_state(product_id) ON DELETE CASCADE,
    UNIQUE(tg_id, product_id)
);

CREATE TABLE IF NOT EXISTS user_product_state (
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
    availability_reliable INTEGER DEFAULT 1,
    last_checked DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tg_id, product_id),
    FOREIGN KEY(tg_id) REFERENCES users(tg_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_promo_state (
    tg_id INTEGER NOT NULL,
    promo_id TEXT NOT NULL,
    signature TEXT NOT NULL,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tg_id, promo_id),
    FOREIGN KEY(tg_id) REFERENCES users(tg_id) ON DELETE CASCADE
);
