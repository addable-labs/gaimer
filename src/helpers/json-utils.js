/**
 * The error a provider throws for an answer it cannot read as the request
 * asked: as a game, or as the caller's parse function reads it. The caller
 * can tell it from a request that failed.
 */
export class AnswerFormatError extends Error {
    constructor(reason) {
        super(`Failed to parse game response: ${reason}`);
        this.name = "AnswerFormatError";
    }
}

/**
 * Safely parse an AI answer that should be a JSON object.
 * Strips markdown fences and parses the JSON.
 *
 * @param {string} raw - Raw string from AI provider
 * @returns {{ ok: boolean, data?: object, error?: string }}
 */
export function parseJSONObject(raw) {
    if (!raw || typeof raw !== "string") {
        return { ok: false, error: "Empty response" };
    }

    let cleaned = raw.trim();

    // Strip markdown code fences
    if (cleaned.startsWith("```json")) {
        cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith("```")) {
        cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith("```")) {
        cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    let data;
    try {
        data = JSON.parse(cleaned);
    } catch (err) {
        return { ok: false, error: `Invalid JSON: ${err.message}` };
    }

    if (typeof data !== "object" || data === null) {
        return { ok: false, error: "Response is not a JSON object" };
    }

    return { ok: true, data };
}

/**
 * Safely parse AI-generated game JSON.
 * Strips markdown fences, parses JSON, validates required fields.
 *
 * @param {string} raw - Raw string from AI provider
 * @returns {{ ok: boolean, data?: object, error?: string }}
 */
export function safeParseGameJSON(raw) {
    const result = parseJSONObject(raw);
    if (!result.ok) {
        return result;
    }
    const data = result.data;

    if (!data.title) {
        return { ok: false, error: "Missing required field: title" };
    }

    if (!data.code) {
        return { ok: false, error: "Missing required field: code" };
    }

    return { ok: true, data };
}
