import db from '../db/index';
import { getStoreContext, type StoreContext } from './store-context';

export async function getUserStoreContext(tgId: number, token: string): Promise<StoreContext> {
    const preference = await db.prepare(`
        SELECT monitor_branch_id, monitor_delivery_type, monitor_store_label, monitor_context_source
        FROM users WHERE tg_id = ?
    `).get(tgId) as any;
    return getStoreContext(token, preference?.monitor_branch_id && preference?.monitor_context_source === 'manual' ? {
        branchId: String(preference.monitor_branch_id),
        deliveryType: String(preference.monitor_delivery_type || 'SelfPickup'),
        storeLabel: String(preference.monitor_store_label || ''),
    } : undefined);
}
