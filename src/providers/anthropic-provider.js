import { shellExec, shellExecWithInput, withTempFile } from "../helpers/shell.js";
import { AnswerFormatError, safeParseGameJSON } from "../helpers/json-utils.js";

// The model a game is generated with when the user has chosen none
const DEFAULT_MODEL = "sonnet";

// A game took about a minute to write at effort low, but the user's own
// Claude setup can raise the effort (see generateGame): at high, sonnet's
// default in the CLI, a Tetris took about 8
const GAME_CALL_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Returns the result message from what `claude -p --output-format json`
 * printed, or undefined when there is none. The CLI prints one line of JSON
 * holding it, or every message of the run when the user's Claude settings
 * turn on verbose output. The login shell can print lines of its own around
 * it.
 */
function resultMessage(output) {
    for (const line of output.split("\n").reverse()) {
        let parsed;
        try {
            parsed = JSON.parse(line);
        } catch {
            continue;
        }
        const messages = Array.isArray(parsed) ? parsed : [parsed];
        const result = messages.filter((message) => message?.type === "result").pop();
        if (result) return result;
    }
    return undefined;
}

/**
 * Returns the answer from what `claude -p --output-format json` printed.
 */
function cliResult(output) {
    const result = resultMessage(output);
    if (!result) throw new Error("Claude CLI printed no result");
    if (result.is_error) {
        const reason = result.result || result.errors?.join("\n") || result.subtype;
        throw new Error(`Claude CLI error: ${reason}`);
    }
    return result.result;
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
        defaultModel: DEFAULT_MODEL,

        async connect() {
            const call = ++calls;
            let signedIn = false;
            try {
                // The Claude CLI exits with code 1 when it is not signed
                // in, and prints its status as usual
                const output = await shellExec(
                    "claude auth status",
                    10000
                ).catch((err) => {
                    if (err?.stdout?.includes('"loggedIn"')) return err.stdout;
                    throw err;
                });
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

        // The Claude CLI's aliases, each for the latest model of its kind
        async listModels() {
            return ["sonnet", "opus", "haiku"];
        },

        async *generateGame(prompt, options = {}) {
            if (!connected)
                throw new Error("Provider not connected");

            const model = options.model || DEFAULT_MODEL;
            const systemMessage = options.systemMessage || "";

            // Run Claude as a plain completion: Gaimer's system prompt
            // replaces Claude Code's, the built-in tools are off, and no
            // session is saved to disk. Only the prompt goes on stdin: the
            // user's description, or a request to fix or change a game. The
            // command line is the same for each. At --effort low Claude
            // thinks next to nothing before it answers, so a game takes
            // about a minute, not several (haiku has no effort levels, and
            // the CLI sends its calls without one). Most of the user's own
            // Claude Code setup stays out of it:
            // --safe-mode skips their CLAUDE.md, hooks, plugins and skills
            // but still reads the subscription sign-in (--bare would not),
            // and --strict-mcp-config with no --mcp-config starts no MCP
            // servers. Their settings.json is still read: --effort decides
            // over an effortLevel there, but a CLAUDE_CODE_EFFORT_LEVEL in
            // their environment or in that file's env decides over --effort,
            // and alwaysThinkingEnabled: false still turns thinking off,
            // which matters little at low effort.
            const output = await withTempFile("gaimer-system", systemMessage, (systemFile) =>
                shellExecWithInput(
                    `claude -p --model ${model} --effort low --tools "" --system-prompt-file '${systemFile}' --no-session-persistence --safe-mode --strict-mcp-config --output-format json`,
                    prompt,
                    GAME_CALL_TIMEOUT_MS
                )
            ).catch((err) => {
                // The Claude CLI exits with code 1 when the result is an
                // error, and prints that result as usual: its message says
                // more than the exit code
                if (resultMessage(err?.stdout ?? "")?.is_error) return err.stdout;
                throw err;
            });

            // The answer is a game, unless the caller reads it with a parse
            // function of its own
            const parse = options.parse || safeParseGameJSON;
            const result = parse(cliResult(output));
            if (!result.ok) {
                throw new AnswerFormatError(result.error);
            }
            yield { type: "complete", data: result.data };
        },
    };
}
