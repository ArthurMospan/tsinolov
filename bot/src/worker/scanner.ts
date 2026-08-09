import cron from 'node-cron';
import dotenv from 'dotenv';
import db from '../db/index';
import { sendTelegramMessage } from '../api/telegram';
import { runUserCheck } from '../notifications/engine';

dotenv.config();

let running = false;

async function scanAllUsers() {
    if (running) return;
    running = true;
    try {
        const users = await db.prepare('SELECT tg_id FROM users WHERE mcp_token IS NOT NULL').all() as any[];
        for (const user of users) {
            const result = await runUserCheck(Number(user.tg_id), sendTelegramMessage);
            console.log(`[Scanner] tg_id=${user.tg_id} products=${result.products} notifications=${result.notifications} error=${result.error || 'none'}`);
        }
    } finally {
        running = false;
    }
}

console.log('Starting notification scanner...');
void scanAllUsers();
cron.schedule('* * * * *', () => void scanAllUsers());
