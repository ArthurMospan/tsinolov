import express from 'express';
import cors from 'cors';
import db from '../db/index';

const app = express();
app.use(cors());
app.use(express.json());

// GET /api/favorites?tg_id=123
app.get('/api/favorites', (req, res) => {
    const tgId = req.query.tg_id;
    if (!tgId) return res.status(400).json({ error: 'Missing tg_id' });

    const favorites = db.prepare(`
        SELECT uf.*, ps.name, ps.current_price, ps.old_price, ps.image_url, ps.has_promo 
        FROM user_favorites uf
        JOIN products_state ps ON uf.product_id = ps.product_id
        WHERE uf.tg_id = ?
    `).all(tgId);

    // Mock initial data if empty (for hackathon demo purposes)
    if (favorites.length === 0) {
        db.prepare('INSERT OR IGNORE INTO products_state (product_id, name, current_price, old_price, image_url) VALUES (?, ?, ?, ?, ?)').run(
            '12345', 'Coca-Cola 2L', 35.50, 45.00, 'https://cdn.silpo.ua/product/12345.png'
        );
        db.prepare('INSERT OR IGNORE INTO user_favorites (tg_id, product_id, added_price) VALUES (?, ?, ?)').run(
            tgId, '12345', 45.00
        );
        return res.json(db.prepare(`
            SELECT uf.*, ps.name, ps.current_price, ps.old_price, ps.image_url, ps.has_promo 
            FROM user_favorites uf
            JOIN products_state ps ON uf.product_id = ps.product_id
            WHERE uf.tg_id = ?
        `).all(tgId));
    }

    res.json(favorites);
});

// POST /api/favorites/target
app.post('/api/favorites/target', (req, res) => {
    const { tg_id, product_id, target_price } = req.body;
    if (!tg_id || !product_id || target_price === undefined) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    db.prepare(`UPDATE user_favorites SET target_price = ? WHERE tg_id = ? AND product_id = ?`).run(target_price, tg_id, product_id);
    res.json({ success: true });
});

// GET /api/settings?tg_id=123
app.get('/api/settings', (req, res) => {
    const tgId = req.query.tg_id;
    if (!tgId) return res.status(400).json({ error: 'Missing tg_id' });

    let settings = db.prepare('SELECT * FROM user_settings WHERE tg_id = ?').get(tgId);
    if (!settings) {
        db.prepare('INSERT OR IGNORE INTO users (tg_id) VALUES (?)').run(tgId);
        db.prepare('INSERT OR IGNORE INTO user_settings (tg_id) VALUES (?)').run(tgId);
        settings = db.prepare('SELECT * FROM user_settings WHERE tg_id = ?').get(tgId);
    }

    res.json(settings);
});

// POST /api/settings
app.post('/api/settings', (req, res) => {
    const { tg_id, ...updates } = req.body;
    if (!tg_id) return res.status(400).json({ error: 'Missing tg_id' });

    for (const [key, value] of Object.entries(updates)) {
        // Safe mapping to prevent SQL injection
        if (['price_drop', 'price_target', 'promo_new', 'in_stock', 'alt_cheaper', 'smart_buy'].includes(key)) {
            db.prepare(`UPDATE user_settings SET ${key} = ? WHERE tg_id = ?`).run(value ? 1 : 0, tg_id);
        }
    }
    res.json({ success: true });
});

export const startServer = (port = 3000) => {
    app.listen(port, () => {
        console.log(`✅ API Server is running on port ${port}`);
    });
};
