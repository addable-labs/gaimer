import { mkdir, writeTextFile, readTextFile, readDir, remove, exists } from "@tauri-apps/plugin-fs";
import { homeDir, join } from "@tauri-apps/api/path";

const ICLOUD_SUBPATH = "Library/Mobile Documents/com~apple~CloudDocs/Gaimer";

let storageDir = null;

function sanitizeTitle(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 50);
}

function gameFileName(id, title) {
    return `${id}-${sanitizeTitle(title || "untitled")}.json`;
}

// Whether a file in the folder is the file of the game with the id,
// <id>-<title>.json
function isGameFile(name, id) {
    return typeof name === "string" && name.startsWith(id + "-") && name.endsWith(".json") && !name.endsWith(".state.json");
}

// Whether a file in the folder is the saved state of the game with the id,
// <id>-<title>.state.json
function isStateFile(name, id) {
    return typeof name === "string" && name.startsWith(id + "-") && name.endsWith(".state.json");
}

// A game file's parts: the game, as the provider wrote it, and what the app
// keeps with it: the game's id, the user's description (prompt), and its
// earlier versions, oldest first, each { game, request } with the request
// that changed it
function gameFileParts({ id, prompt, versions = [], ...game }) {
    return { id, prompt, versions, game };
}

// A game as loadGame returns it, from its file's data
function savedGame(data, id) {
    const { id: gameId, prompt, versions, game } = gameFileParts(data);
    return {
        id: gameId || id,
        prompt: prompt || "",
        content: JSON.stringify(game),
        changeRequests: versions.map((version) => version.request),
    };
}

async function getStorageDir() {
    if (storageDir) return storageDir;
    const home = await homeDir();
    storageDir = await join(home, ICLOUD_SUBPATH);
    return storageDir;
}

/**
 * Ensure the Gaimer storage directory exists.
 */
export async function initStorage() {
    const dir = await getStorageDir();
    try {
        const dirExists = await exists(dir);
        if (!dirExists) {
            await mkdir(dir, { recursive: true });
        }
    } catch (err) {
        console.warn("[storage] Could not check/create directory, attempting mkdir:", err.message);
        try {
            await mkdir(dir, { recursive: true });
        } catch {
            // Directory might already exist
        }
    }
}

/**
 * Save a game to the filesystem.
 * @param {object} game - { id, prompt, content } where content is a JSON string
 */
export async function saveGame(game) {
    const dir = await getStorageDir();
    const parsed = typeof game.content === "string" ? JSON.parse(game.content) : game.content;
    const fileData = {
        ...parsed,
        id: game.id,
        prompt: game.prompt,
    };
    const fileName = gameFileName(game.id, parsed.title);
    const filePath = await join(dir, fileName);
    await writeTextFile(filePath, JSON.stringify(fileData, null, 2));
}

// Reads the file of the game with the id. Returns the folder, the folder's
// entries and the file's data.
async function readGameFile(id) {
    const dir = await getStorageDir();
    const entries = await readDir(dir);
    const match = entries.find((e) => isGameFile(e.name, id));
    if (!match) throw new Error(`Game not found: ${id}`);
    const raw = await readTextFile(await join(dir, match.name));
    return { dir, entries, data: JSON.parse(raw) };
}

/**
 * Load a game by ID. Scans directory for matching file.
 * @param {string} id - Game ID (timestamp)
 * @returns {object} { id, prompt, content, changeRequests }: content is the
 *   game's JSON as a string (for compatibility), without its earlier
 *   versions; changeRequests are the requests that changed the game, oldest
 *   first, one for each earlier version
 */
export async function loadGame(id) {
    const { data } = await readGameFile(id);
    return savedGame(data, id);
}

// Writes the game's file anew, with the data that change() makes of it, and
// deletes the game's saved state, which was saved from other code. The file
// is named after the game's title, so a new title gives a new file: the old
// one is then removed, and the game still has one file. Returns the game as
// loadGame does.
async function rewriteGame(id, change) {
    const { dir, entries, data } = await readGameFile(id);
    const newData = change(data);
    for (const entry of entries.filter((e) => isStateFile(e.name, id))) {
        await remove(await join(dir, entry.name));
    }
    const fileName = gameFileName(id, newData.title);
    await writeTextFile(await join(dir, fileName), JSON.stringify(newData, null, 2));
    for (const entry of entries.filter((e) => isGameFile(e.name, id) && e.name !== fileName)) {
        await remove(await join(dir, entry.name));
    }
    return savedGame(newData, id);
}

/**
 * Save a changed game as the game's new version. The version it replaces
 * is kept as an earlier version, with the request that changed it.
 * @param {string} id - Game ID (timestamp)
 * @param {object} game - The changed game
 * @param {string} request - The user's request for the change
 * @returns {object} The game as loadGame returns it
 */
export async function addGameVersion(id, game, request) {
    return rewriteGame(id, (data) => {
        const { prompt, versions, game: current } = gameFileParts(data);
        return { ...game, id, prompt, versions: [...versions, { game: current, request }] };
    });
}

/**
 * Replace the game's version with another, such as the version fixed, and
 * keep its earlier versions.
 * @param {string} id - Game ID (timestamp)
 * @param {object} game - The game in place of the version
 * @returns {object} The game as loadGame returns it
 */
export async function replaceGameVersion(id, game) {
    return rewriteGame(id, (data) => {
        const { prompt, versions } = gameFileParts(data);
        return { ...game, id, prompt, versions };
    });
}

/**
 * Go back to the game's version before its last change. The version it
 * goes back from is dropped.
 * @param {string} id - Game ID (timestamp)
 * @returns {object} The game as loadGame returns it
 */
export async function undoGameVersion(id) {
    return rewriteGame(id, (data) => {
        const { prompt, versions } = gameFileParts(data);
        if (versions.length === 0) throw new Error(`The game has no earlier version: ${id}`);
        return { ...versions.at(-1).game, id, prompt, versions: versions.slice(0, -1) };
    });
}

/**
 * List all games (metadata only, no code).
 * @returns {Array<{id, title, description, controls, rules}>}
 */
export async function listGames() {
    const dir = await getStorageDir();
    let entries;
    try {
        entries = await readDir(dir);
    } catch {
        return [];
    }
    const games = [];
    for (const entry of entries) {
        if (!entry.name || !entry.name.endsWith(".json") || entry.name.endsWith(".state.json")) continue;
        try {
            const filePath = await join(dir, entry.name);
            const raw = await readTextFile(filePath);
            const data = JSON.parse(raw);
            const stateFileName = entry.name.replace(".json", ".state.json");
            const hasState = entries.some((e) => e.name === stateFileName);
            games.push({
                id: data.id,
                title: data.title,
                description: data.description,
                controls: data.controls,
                rules: data.rules,
                hasSavedState: hasState,
            });
        } catch {
            // Skip corrupt files
        }
    }
    // Sort newest first
    games.sort((a, b) => Number(b.id) - Number(a.id));
    return games;
}

/**
 * Delete a game by ID: its file, which holds its earlier versions, and its
 * saved state.
 * @param {string} id - Game ID (timestamp)
 */
export async function deleteGame(id) {
    const dir = await getStorageDir();
    const entries = await readDir(dir);
    // A game has one file, but a change of title that fails between writing
    // the new file and removing the old one leaves two
    for (const entry of entries.filter((e) => isGameFile(e.name, id))) {
        await remove(await join(dir, entry.name));
    }
    // Also remove state file
    await deleteGameState(id);
}

/**
 * Save game state to a separate file.
 */
export async function saveGameState(id, stateData) {
    const dir = await getStorageDir();
    const entries = await readDir(dir);
    const match = entries.find((e) => isGameFile(e.name, id));
    if (!match) throw new Error(`Game not found: ${id}`);
    const stateFileName = match.name.replace(".json", ".state.json");
    const filePath = await join(dir, stateFileName);
    await writeTextFile(filePath, JSON.stringify(stateData));
}

/**
 * Load saved game state, or return null if none exists.
 */
export async function loadGameState(id) {
    const dir = await getStorageDir();
    let entries;
    try {
        entries = await readDir(dir);
    } catch {
        return null;
    }
    const match = entries.find((e) => isStateFile(e.name, id));
    if (!match) return null;
    try {
        const filePath = await join(dir, match.name);
        const raw = await readTextFile(filePath);
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/**
 * Delete saved game state.
 */
export async function deleteGameState(id) {
    const dir = await getStorageDir();
    let entries;
    try {
        entries = await readDir(dir);
    } catch {
        return;
    }
    const match = entries.find((e) => isStateFile(e.name, id));
    if (!match) return;
    try {
        const filePath = await join(dir, match.name);
        await remove(filePath);
    } catch {
        // ignore
    }
}
