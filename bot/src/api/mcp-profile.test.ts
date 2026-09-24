import assert from 'node:assert/strict';
import test from 'node:test';
import { profileIdentityFromMcp } from './mcp-profile';

test('reads the nested profile shape returned by Silpo MCP', () => {
    const response = {
        result: {
            content: [{
                type: 'text',
                text: JSON.stringify({ success: true, profile: { firstName: 'Артур', lastName: 'Моспан' } })
            }]
        }
    };
    assert.deepEqual(profileIdentityFromMcp(response), { name: 'Артур Моспан', avatar: '' });
});

test('returns an empty identity instead of showing Guest or Error', () => {
    assert.deepEqual(profileIdentityFromMcp({ result: { content: [] } }), { name: '', avatar: '' });
});
