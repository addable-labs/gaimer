import OpenAI from "openai";
import { safeParseGameJSON } from "../helpers/json-utils.js";

/**
 * Creates an OpenAI provider implementing the AIProvider interface.
 * Wraps the existing OpenAI integration behind the standard provider contract.
 */
export function createOpenAIProvider() {
    let client = null;
    let connected = false;

    return {
        id: "openai",
        name: "OpenAI",
        authMethod: "apikey",

        async connect(credentials = {}) {
            if (!credentials.apiKey) {
                // Not connected, even when an earlier connect succeeded
                client = null;
                connected = false;
                return { success: false, error: "API key is required" };
            }
            client = new OpenAI({
                apiKey: credentials.apiKey,
                dangerouslyAllowBrowser: true, // TODO: route through Tauri proxy
            });
            connected = true;
            return { success: true };
        },

        async disconnect() {
            client = null;
            connected = false;
        },

        isConnected() {
            return connected;
        },

        // Chat models that work with the request generateGame() sends: JSON
        // mode, a temperature of 0.2 and max_tokens of 16384. Reasoning
        // models such as o3 and gpt-5 reject the last two.
        async listModels() {
            return ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"];
        },

        async *generateGame(prompt, options = {}) {
            if (!client) throw new Error("Provider not connected");

            const systemMessage = options.systemMessage || "";
            const model = options.model || "gpt-4o";
            const maxTokens = options.maxTokens || 16384;
            const temperature = options.temperature ?? 0.2;

            const response = await client.chat.completions.create({
                messages: [
                    { role: "system", content: systemMessage },
                    { role: "user", content: prompt },
                ],
                model,
                temperature,
                max_tokens: maxTokens,
                response_format: { type: "json_object" },
            });

            const content = response.choices[0]?.message?.content;
            if (!content) throw new Error("Empty response from OpenAI");

            const result = safeParseGameJSON(content);
            if (!result.ok) {
                throw new Error(`Failed to parse game response: ${result.error}`);
            }
            yield { type: "complete", data: result.data };
        },
    };
}
