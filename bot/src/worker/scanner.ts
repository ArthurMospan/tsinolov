import cron from 'node-cron';
import db from '../db/index';
import { getMyFavorites } from '../api/silpo';

console.log('⏳ Starting background scanner...');

// Scan every hour (for hackathon testing, maybe every minute)
cron.schedule('* * * * *', async () => {
    console.log('🔄 Running scan for price drops and promotions...');

    // Fetch all users who have authorized
    const users = db.prepare('SELECT * FROM users WHERE access_token IS NOT NULL').all() as any[];

    for (const user of users) {
        try {
            const favorites = await getMyFavorites(user.access_token);

            for (const product of favorites) {
                // Fetch previous state
                const prevState = db.prepare('SELECT * FROM products_state WHERE product_id = ?').get(product.product_id) as any;

                if (!prevState) {
                    // First time seeing this product
                    db.prepare(`
                        INSERT INTO products_state (product_id, name, current_price, old_price, in_stock, has_promo, image_url)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `).run(product.product_id, product.name, product.current_price, product.old_price, product.in_stock ? 1 : 0, product.has_promo ? 1 : 0, product.image_url);
                    continue;
                }

                // Analytics logic for notifications
                let notifyMessage = '';
                
                // Fetch user settings
                const settings = db.prepare('SELECT * FROM user_settings WHERE tg_id = ?').get(user.tg_id) as any;
                // Fetch favorite info to get added_price and target_price
                const favoriteInfo = db.prepare('SELECT * FROM user_favorites WHERE tg_id = ? AND product_id = ?').get(user.tg_id, product.product_id) as any;
                
                const addedPrice = favoriteInfo?.added_price || prevState.current_price;
                const targetPrice = favoriteInfo?.target_price;

                // Price drop event
                if (settings.price_drop && product.current_price < prevState.current_price) {
                    notifyMessage += `📉 Зниження ціни на **${product.name}**!\n`;
                    notifyMessage += `💵 Зараз: ${product.current_price} грн (було ${prevState.current_price} грн).\n`;
                    notifyMessage += `🔖 Ви додавали товар з ціною: ${addedPrice} грн.\n\n`;
                }
                
                // Target price reached
                if (settings.price_target && targetPrice && product.current_price <= targetPrice && prevState.current_price > targetPrice) {
                    notifyMessage += `🎯 Цільова ціна досягнута для **${product.name}**!\n`;
                    notifyMessage += `💵 Зараз: ${product.current_price} грн (Ваша стеля: ${targetPrice} грн).\n\n`;
                }

                // In stock event
                if (settings.in_stock && product.in_stock && !prevState.in_stock) {
                    notifyMessage += `📦 Товар **${product.name}** знову в наявності!\n\n`;
                }

                if (notifyMessage) {
                    // Route to notification engine (TODO)
                    console.log(`[Notification Engine] to TG ID ${user.tg_id}: \n[Photo: ${product.image_url}]\n${notifyMessage}`);
                }

                // Update state
                db.prepare(`
                    UPDATE products_state 
                    SET current_price = ?, old_price = ?, in_stock = ?, has_promo = ?, image_url = ?, last_checked = CURRENT_TIMESTAMP
                    WHERE product_id = ?
                `).run(product.current_price, product.old_price, product.in_stock ? 1 : 0, product.has_promo ? 1 : 0, product.image_url, product.product_id);
            }
        } catch (err) {
            console.error(`❌ Failed to scan for user ${user.tg_id}:`, err);
        }
    }
});
