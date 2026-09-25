import OpenAI from "openai";
import { safeParseGameJSON } from "../helpers/json-utils.js";

// Room for a GPT-5 model's reasoning, on top of the room for the game
// (maxTokens): its token limit counts both
const REASONING_TOKENS = 16384;

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
        // mode, with a temperature and max_tokens, or with only
        // max_completion_tokens for a GPT-5 model. OpenAI serves the other
        // GPT-5 models (Pro, Codex, Cyber) only through its Responses API,
        // and has deprecated gpt-5, gpt-5-mini and gpt-5-nano.
        async listModels() {
            return [
                "gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini",
                "gpt-5.1", "gpt-5.2", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano",
                "gpt-5.5", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna",
            ];
        },

        async *generateGame(prompt, options = {}) {
            if (!client) throw new Error("Provider not connected");

            const systemMessage = options.systemMessage || "";
            const model = options.model || "gpt-4o";
            const maxTokens = options.maxTokens || 16384;
            const temperature = options.temperature ?? 0.2;

            // A GPT-5 model rejects a temperature whenever it reasons
            // (gpt-5.5 and gpt-5.6 do by default), so it gets none. Its
            // limit is max_completion_tokens, which counts the reasoning as
            // well as the game, so the limit adds room for the reasoning.
            const reasoning = model.startsWith("gpt-5");
            const limit = reasoning ? maxTokens + REASONING_TOKENS : maxTokens;

            const response = await client.chat.completions.create({
                messages: [
                    { role: "system", content: systemMessage },
                    { role: "user", content: prompt },
                ],
                model,
                ...(reasoning
                    ? { max_completion_tokens: limit }
                    : { temperature, max_tokens: limit }),
                response_format: { type: "json_object" },
            });

            // An answer that reaches the limit stops partway through the
            // game, or before it starts when the reasoning used up the limit
            const choice = response.choices[0];
            if (choice?.finish_reason === "length") {
                throw new Error(
                    `The answer from ${model} was cut off at the limit of ${limit} tokens` +
                        (reasoning ? ", reasoning included," : "") +
                        " before the game was complete. Retry, or describe a simpler game."
                );
            }

            const content = choice?.message?.content;
            if (!content) throw new Error("Empty response from OpenAI");

            const result = safeParseGameJSON(content);
            if (!result.ok) {
                throw new Error(`Failed to parse game response: ${result.error}`);
            }
            yield { type: "complete", data: result.data };
        },
    };
}
