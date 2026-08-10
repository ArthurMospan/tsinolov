export const MCP_BASE = 'https://mcp.silpo.ua';

async function callMCP(token: string, method: string, params?: Record<string, any>) {
    const resp = await fetch(`${MCP_BASE}/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method,
            ...(params ? { params } : {}),
        }),
    });

    const data = await resp.json();
    if (!resp.ok) throw new Error(`MCP HTTP ${resp.status}: ${JSON.stringify(data).slice(0, 500)}`);
    if (data?.error) throw new Error(`MCP error: ${JSON.stringify(data.error).slice(0, 500)}`);
    if (data?.result?.isError) throw new Error(`MCP tool error: ${JSON.stringify(data.result.content).slice(0, 500)}`);
    return data;
}

export async function callMCPTool(token: string, toolName: string, args: Record<string, any> = {}) {
    return callMCP(token, 'tools/call', { name: toolName, arguments: args });
}

export interface MCPToolDefinition {
    name: string;
    inputSchema?: {
        properties?: Record<string, any>;
        required?: string[];
    };
}

let toolDefinitionsCache: MCPToolDefinition[] | null = null;

export async function listMCPTools(token: string): Promise<MCPToolDefinition[]> {
    if (toolDefinitionsCache) return toolDefinitionsCache;
    const response = await callMCP(token, 'tools/list');
    const tools = Array.isArray(response?.result?.tools) ? response.result.tools : [];
    toolDefinitionsCache = tools;
    return tools;
}
