import { shellExec, shellExecWithInput, withTempFile } from "../helpers/shell.js";
import { safeParseGameJSON } from "../helpers/json-utils.js";

/**
 * Returns the answer from what `claude -p --output-format json` printed: one
 * line of JSON holding the result message, or every message of the run when
 * the user's Claude settings turn on verbose output. The login shell can print
 * lines of its own around it.
 */
function cliResult(output) {
    for (const line of output.split("\n").reverse()) {
        let parsed;
        try {
            parsed = JSON.parse(line);
        } catch {
            continue;
        }
        const messages = Array.isArray(parsed) ? parsed : [parsed];
        const result = messages.filter((message) => message?.type === "result").pop();
        if (!result) continue;
        if (result.is_error) {
            const reason = result.result || result.errors?.join("\n") || result.subtype;
            throw new Error(`Claude CLI error: ${reason}`);
        }
        return result.result;
    }
    throw new Error("Claude CLI printed no result");
}

/**
 * Creates an Anthropic provider that uses the Claude CLI (Claude Code).
 * Requires a Claude Pro/Max subscription — no API key needed.
 * Authentication is handled by `claude auth login` outside the app.
 */
export function createAnthropicProvider() {
    let connected = false;
    // Numbers the calls of connect() and disconnect(): sign-in checks can
    // overlap, and only the latest call sets connected
    let calls = 0;

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
            const call = ++calls;
            let signedIn = false;
            try {
                const output = await shellExec(
                    "claude auth status",
                    10000
                );
                const trimmed = output.trim();
                signedIn =
                    trimmed.includes('"loggedIn": true') ||
                    trimmed.includes('"loggedIn":true') ||
                    trimmed.includes("Logged in");
                if (signedIn) {
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
            } finally {
                // A check that ends after a newer connect() or disconnect()
                // has started is out of date, and leaves connected alone
                if (call === calls) connected = signedIn;
            }
        },

        async disconnect() {
            calls++;
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

            // Run Claude as a plain completion: Gaimer's system prompt
            // replaces Claude Code's, the built-in tools are off, and no
            // session is saved to disk. Only the user's description goes on
            // stdin.
            const output = await withTempFile("gaimer-system", systemMessage, (systemFile) =>
                shellExecWithInput(
                    `claude -p --model ${model} --tools "" --system-prompt-file '${systemFile}' --no-session-persistence --output-format json`,
                    prompt
                )
            );

            const result = safeParseGameJSON(cliResult(output));
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
