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
    console.log("[storage] Initializing storage at:", dir);
    try {
        const dirExists = await exists(dir);
        if (!dirExists) {
            await mkdir(dir, { recursive: true });
            console.log("[storage] Created directory");
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

/**
 * Load a game by ID. Scans directory for matching file.
 * @param {string} id - Game ID (timestamp)
 * @returns {object} Game object with content as JSON string (for compatibility)
 */
export async function loadGame(id) {
    const dir = await getStorageDir();
    const entries = await readDir(dir);
    const match = entries.find((e) => e.name && e.name.startsWith(id + "-") && e.name.endsWith(".json") && !e.name.endsWith(".state.json"));
    if (!match) throw new Error(`Game not found: ${id}`);
    const filePath = await join(dir, match.name);
    const raw = await readTextFile(filePath);
    const data = JSON.parse(raw);
    // Return in the format App.vue expects: { id, prompt, content }
    const { id: gameId, prompt, ...gameContent } = data;
    return {
        id: gameId || id,
        prompt: prompt || "",
        content: JSON.stringify(gameContent),
    };
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
 * Delete a game by ID.
 * @param {string} id - Game ID (timestamp)
 */
export async function deleteGame(id) {
    const dir = await getStorageDir();
    const entries = await readDir(dir);
    const match = entries.find((e) => e.name && e.name.startsWith(id + "-") && !e.name.endsWith(".state.json"));
    if (!match) return;
    const filePath = await join(dir, match.name);
    await remove(filePath);
    // Also remove state file
    await deleteGameState(id);
}

/**
 * Save game state to a separate file.
 */
export async function saveGameState(id, stateData) {
    const dir = await getStorageDir();
    const entries = await readDir(dir);
    const match = entries.find((e) => e.name && e.name.startsWith(id + "-") && e.name.endsWith(".json") && !e.name.endsWith(".state.json"));
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
    const match = entries.find((e) => e.name && e.name.startsWith(id + "-") && e.name.endsWith(".state.json"));
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
    const match = entries.find((e) => e.name && e.name.startsWith(id + "-") && e.name.endsWith(".state.json"));
    if (!match) return;
    try {
        const filePath = await join(dir, match.name);
        await remove(filePath);
    } catch {
        // ignore
    }
}
