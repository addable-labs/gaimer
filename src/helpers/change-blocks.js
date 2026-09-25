import { parseJSONObject } from "./json-utils.js";

// The keys of a game that hold text, as the system message gives the game's
// format: every key but "code", which a change answer changes only through
// its change blocks
export const GAME_TEXT_KEYS = [
    "title", "description", "rules", "goals", "controls", "enemies", "levels",
    "obstacles", "player", "power-ups", "rewards", "other",
];

/**
 * Reads the answer to a change request: a JSON object with the change
 * blocks, { "changes": [{ "find": "...", "replace": "..." }] }, and those
 * other keys of the game whose text changes. Only the shape is checked
 * here: applyChanges() checks the blocks against the game's code. Keys
 * that are not a game's are left out.
 *
 * @param {string} raw - Raw string from AI provider
 * @returns {{ ok: boolean, data?: { changes: Array<{ find: string, replace: string }>, keys: object }, error?: string }}
 */
export function parseChangeAnswer(raw) {
    const result = parseJSONObject(raw);
    if (!result.ok) {
        return result;
    }
    const answer = result.data;

    if (!Array.isArray(answer.changes)) {
        return { ok: false, error: 'Missing required field: changes (a list of change blocks)' };
    }
    // The whole code would leave it unclear which of the two to take
    if ("code" in answer) {
        return { ok: false, error: "The answer gives the whole code, not only change blocks" };
    }

    const changes = [];
    for (const [index, change] of answer.changes.entries()) {
        const { find, replace } = change ?? {};
        if (typeof find !== "string" || find === "") {
            return { ok: false, error: `Change block ${index + 1} has no text to find` };
        }
        if (typeof replace !== "string") {
            return { ok: false, error: `Change block ${index + 1} has no text to replace it with` };
        }
        changes.push({ find, replace });
    }

    const keys = {};
    for (const key of GAME_TEXT_KEYS.filter((key) => Object.hasOwn(answer, key))) {
        if (typeof answer[key] !== "string") {
            return { ok: false, error: `The game's ${key} is not text` };
        }
        keys[key] = answer[key];
    }
    if (keys.title === "") {
        return { ok: false, error: "The game's title is empty" };
    }

    return { ok: true, data: { changes, keys } };
}

/**
 * Makes the changes that a change answer (as parseChangeAnswer reads it)
 * gives, and returns the changed game: its code with every change block
 * made, and the keys of the answer in place of the game's own. Each block's
 * text to find must occur exactly once in the code, and no two blocks may
 * overlap. Every block is found in the code as it is before the change, and
 * all of them are made together.
 *
 * @param {object} game - The game as it is now
 * @param {{ changes: Array<{ find: string, replace: string }>, keys: object }} answer
 * @returns {{ ok: boolean, game?: object, error?: string }}
 */
export function applyChanges(game, { changes, keys }) {
    const code = game.code;

    // Where each block's text is in the code
    const places = [];
    for (const [index, { find, replace }] of changes.entries()) {
        const start = code.indexOf(find);
        if (start === -1) {
            return { ok: false, error: `The text of change block ${index + 1} is not in the code` };
        }
        // Looking again from the next character also finds a second
        // occurrence that overlaps the first
        if (code.indexOf(find, start + 1) !== -1) {
            return { ok: false, error: `The text of change block ${index + 1} is in the code more than once` };
        }
        places.push({ block: index + 1, start, end: start + find.length, replace });
    }

    // The code between the blocks, in order, with each block's text replaced
    places.sort((a, b) => a.start - b.start);
    let changedCode = "";
    let end = 0;
    for (const [index, place] of places.entries()) {
        if (place.start < end) {
            return { ok: false, error: `Change blocks ${places[index - 1].block} and ${place.block} overlap` };
        }
        changedCode += code.slice(end, place.start) + place.replace;
        end = place.end;
    }
    changedCode += code.slice(end);

    // An answer that changes nothing has not made the change asked for
    const keysChange = Object.entries(keys).some(([key, text]) => game[key] !== text);
    if (changedCode === code && !keysChange) {
        return { ok: false, error: "The changes leave the game as it was" };
    }

    return { ok: true, game: { ...game, ...keys, code: changedCode } };
}
