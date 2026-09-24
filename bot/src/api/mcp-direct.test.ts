import assert from 'node:assert/strict';
import test from 'node:test';
import { callMCPTool, isMcpAuthError } from './mcp-direct';

function stubFetch(status: number, body: unknown) {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
    return () => { globalThis.fetch = original; };
}

test('marks a rejected Silpo token as an auth error so the user can reconnect', async () => {
    const restore = stubFetch(401, { error: 'invalid_token', error_description: 'Invalid access token' });
    try {
        const error = await callMCPTool('expired', 'silpo_get_my_shopping_cart').catch(err => err);
        assert.equal(isMcpAuthError(error), true);
    } finally {
        restore();
    }
});

test('keeps Silpo outages separate from expired sessions', async () => {
    const restore = stubFetch(503, { error: 'unavailable' });
    try {
        const error = await callMCPTool('valid', 'silpo_get_my_shopping_cart').catch(err => err);
        assert.ok(error instanceof Error);
        assert.equal(isMcpAuthError(error), false);
    } finally {
        restore();
    }
});
