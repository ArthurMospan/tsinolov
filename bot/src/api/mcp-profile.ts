export interface ProfileIdentity {
    name: string;
    avatar: string;
}

export function profileIdentityFromMcp(response: any): ProfileIdentity {
    const content = response?.result?.content;
    if (!Array.isArray(content)) return { name: '', avatar: '' };

    for (const item of content) {
        if (item?.type !== 'text' || typeof item.text !== 'string') continue;
        try {
            const parsed = JSON.parse(item.text);
            const profile = parsed?.profile || parsed?.data?.profile || parsed?.data || parsed;
            const firstName = String(profile?.firstName || profile?.first_name || '').trim();
            const lastName = String(profile?.lastName || profile?.last_name || '').trim();
            const avatar = String(profile?.avatar || profile?.picture || profile?.photoUrl || profile?.photo_url || '');
            const name = [firstName, lastName].filter(Boolean).join(' ');
            if (name || avatar) return { name, avatar };
        } catch {
            // Ignore non-JSON content blocks and continue to the next one.
        }
    }
    return { name: '', avatar: '' };
}
