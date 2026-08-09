import OpenAI from 'openai';
import { mcpClient } from '../api/mcp-client';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Helper to convert MCP tools to OpenAI tools format
function mcpToolsToOpenAITools(mcpTools: any[]): any[] {
    return mcpTools.map(tool => ({
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema || { type: 'object', properties: {} }
        }
    }));
}

export async function handleAgentQuery(userId: number, text: string): Promise<string> {
    try {
        // 1. Fetch available tools from Silpo MCP
        const mcpTools = await mcpClient.getTools();
        const openAiTools = mcpToolsToOpenAITools(mcpTools);

        const messages: any[] = [
            { 
                role: 'system', 
                content: 'Ти — AI-асистент "Цінолов". Допомагаєш гостям Сільпо керувати Улюбленими товарами, знаходити акції та справді вигідні варіанти. Спілкуйся привітно й конкретно. Викликай необхідні інструменти для отримання даних і не вигадуй ціни, наявність або умови пропозицій.'
            },
            { role: 'user', content: text }
        ];

        let isFinished = false;
        let responseContent = 'Вибач, я не зміг обробити твій запит.';

        while (!isFinished) {
            // 2. Ask LLM to decide what to do
            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: messages,
                tools: openAiTools.length > 0 ? openAiTools : undefined,
                tool_choice: 'auto'
            });

            const message = response.choices[0].message;
            messages.push(message);

            if (message.tool_calls) {
                // 3. LLM decided to call tools
                for (const toolCall of message.tool_calls) {
                    if (!('function' in toolCall)) continue;
                    const functionName = toolCall.function.name;
                    const functionArgs = JSON.parse(toolCall.function.arguments);

                    console.log(`[AI Agent] LLM calls tool ${functionName}`);

                    // 4. Execute tool against Silpo MCP
                    let toolResult;
                    try {
                        const mcpResponse = await mcpClient.callTool(functionName, functionArgs);
                        // MCP SDK returns { content: [{ type: "text", text: "..." }] }
                        const content = Array.isArray(mcpResponse.content) ? mcpResponse.content : [];
                        toolResult = content.map((c: any) => c.text || '').join('\n');
                    } catch (err: any) {
                        toolResult = `Error executing tool: ${err.message}`;
                    }

                    // 5. Send result back to LLM
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        name: functionName,
                        content: toolResult
                    });
                }
            } else {
                // LLM provided a final text response
                isFinished = true;
                responseContent = message.content || '...';
            }
        }

        return responseContent;
    } catch (error) {
        console.error('❌ Agent error:', error);
        return 'Ой, сталася помилка під час обробки твого запиту 😔 Спробуй пізніше!';
    }
}
