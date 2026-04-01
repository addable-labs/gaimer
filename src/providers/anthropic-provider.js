import { shellExec, shellExecWithInput } from "../helpers/shell.js";
import { safeParseGameJSON } from "../helpers/json-utils.js";

/**
 * Creates an Anthropic provider that uses the Claude CLI (Claude Code).
 * Requires a Claude Pro/Max subscription — no API key needed.
 * Authentication is handled by `claude auth login` outside the app.
 */
export function createAnthropicProvider() {
    let connected = false;

    return {
        id: "anthropic",
        name: "Anthropic Claude",
        authMethod: "subscription",

        capabilities: {
            streaming: false,
            imageGeneration: false,
            maxOutputTokens: 16384,
            sandboxedExecution: false,
        },

        async connect() {
            try {
                const output = await shellExec(
                    "claude auth status",
                    10000
                );
                const trimmed = output.trim();
                if (
                    trimmed.includes('"loggedIn": true') ||
                    trimmed.includes('"loggedIn":true') ||
                    trimmed.includes("Logged in")
                ) {
                    connected = true;
                    return { success: true };
                }
                return {
                    success: false,
                    error: 'Not logged in. Run "claude auth login" in your terminal.',
                };
            } catch (err) {
                const msg = String(err.message || err);
                return {
                    success: false,
                    error: msg.includes("not found") || msg.includes("No such file")
                        ? 'Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code'
                        : msg,
                };
            }
        },

        async disconnect() {
            connected = false;
        },

        isConnected() {
            return connected;
        },

        async listModels() {
            return [
                "claude-sonnet-4-6",
                "claude-opus-4-6",
                "claude-haiku-4-5",
            ];
        },

        async *generateGame(prompt, options = {}) {
            if (!connected)
                throw new Error("Provider not connected");

            const model = options.model || "claude-sonnet-4-6";
            const systemMessage = options.systemMessage || "";

            const fullPrompt = systemMessage
                ? `${systemMessage}\n\n---\n\nUser request: ${prompt}`
                : prompt;

            const cmd = `claude -p --model ${model} --max-turns 1 --output-format text`;

            // Write prompt to temp file and redirect to stdin
            const output = await shellExecWithInput(cmd, fullPrompt);

            const result = safeParseGameJSON(output);
            if (!result.ok) {
                throw new Error(`Failed to parse game response: ${result.error}`);
            }
            yield { type: "complete", data: result.data };
        },

        async generateSprite() {
            throw new Error(
                "Sprite generation is not supported by the Anthropic provider"
            );
        },
    };
}
