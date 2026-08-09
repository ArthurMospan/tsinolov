export const MCP_BASE = 'https://mcp.silpo.ua';

export async function callMCPTool(token: string, toolName: string, args: Record<string, any> = {}) {
    const resp = await fetch(`${MCP_BASE}/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'tools/call',
            params: { name: toolName, arguments: args },
        }),
    });

    const data = await resp.json();
    if (!resp.ok) throw new Error(`MCP HTTP ${resp.status}: ${JSON.stringify(data).slice(0, 500)}`);
    if (data?.error) throw new Error(`MCP error: ${JSON.stringify(data.error).slice(0, 500)}`);
    if (data?.result?.isError) throw new Error(`MCP tool error: ${JSON.stringify(data.result.content).slice(0, 500)}`);
    return data;
}
