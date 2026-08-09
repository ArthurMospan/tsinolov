import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

// Configuration
const MCP_ENDPOINT = 'https://mcp.silpo.ua/mcp'; // Provided by Hackathon
const MCP_TOKEN = process.env.SILPO_MCP_TOKEN || 'test-token';

export class SilpoMCPClient {
    private client: Client;
    private transport: SSEClientTransport;
    private isConnected: boolean = false;

    constructor() {
        this.client = new Client({
            name: "Silpo Smart Watchlist Bot",
            version: "1.0.0"
        }, {
            capabilities: {}
        });

        // Initialize transport for SSE (Server-Sent Events) over HTTP
        const url = new URL(MCP_ENDPOINT);
        this.transport = new SSEClientTransport(url, {
            headers: {
                'Authorization': `Bearer ${MCP_TOKEN}`
            }
        });
    }

    public async connect() {
        if (this.isConnected) return;
        
        try {
            await this.client.connect(this.transport);
            this.isConnected = true;
            console.log('✅ Connected to Silpo MCP Server');
        } catch (error) {
            console.error('❌ Failed to connect to Silpo MCP:', error);
            throw error;
        }
    }

    public async getTools() {
        if (!this.isConnected) await this.connect();
        const response = await this.client.listTools();
        return response.tools;
    }

    public async callTool(name: string, args: Record<string, any> = {}) {
        if (!this.isConnected) await this.connect();
        console.log(`[MCP] Calling tool: ${name} with args:`, args);
        try {
            const result = await this.client.callTool({
                name,
                arguments: args
            });
            return result;
        } catch (error) {
            console.error(`[MCP] Tool call ${name} failed:`, error);
            throw error;
        }
    }
    
    public async close() {
        await this.client.close();
        this.isConnected = false;
    }
}

// Singleton instance
export const mcpClient = new SilpoMCPClient();
