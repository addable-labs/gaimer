import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @tauri-apps/plugin-fs
const mockFiles = new Map();
vi.mock("@tauri-apps/plugin-fs", () => ({
    mkdir: vi.fn(),
    exists: vi.fn().mockResolvedValue(true),
    writeTextFile: vi.fn((path, content) => {
        mockFiles.set(path, content);
        return Promise.resolve();
    }),
    readTextFile: vi.fn((path) => {
        const content = mockFiles.get(path);
        if (!content) return Promise.reject(new Error("File not found"));
        return Promise.resolve(content);
    }),
    readDir: vi.fn(() => {
        const entries = [];
        for (const [path] of mockFiles) {
            const name = path.split("/").pop();
            entries.push({ name });
        }
        return Promise.resolve(entries);
    }),
    remove: vi.fn((path) => {
        mockFiles.delete(path);
        return Promise.resolve();
    }),
}));

// Mock @tauri-apps/api/path
vi.mock("@tauri-apps/api/path", () => ({
    homeDir: vi.fn().mockResolvedValue("/Users/test"),
    join: vi.fn((...parts) => Promise.resolve(parts.join("/"))),
}));

import {
    initStorage,
    saveGame,
    loadGame,
    listGames,
    deleteGame,
    saveGameState,
} from "../../../src/helpers/game-storage.js";

describe("game-storage", () => {
    beforeEach(() => {
        mockFiles.clear();
    });

    it("initStorage creates directory", async () => {
        const { mkdir } = await import("@tauri-apps/plugin-fs");
        await initStorage();
        // Should not throw
    });

    it("saveGame writes a JSON file", async () => {
        await initStorage();
        const game = {
            id: "123",
            prompt: '"test"',
            content: JSON.stringify({ title: "Test Game", code: "// code" }),
        };
        await saveGame(game);
        expect(mockFiles.size).toBe(1);
        const key = [...mockFiles.keys()][0];
        expect(key).toContain("123-test-game.json");
        const saved = JSON.parse(mockFiles.get(key));
        expect(saved.title).toBe("Test Game");
        expect(saved.id).toBe("123");
    });

    it("loadGame reads and returns compatible format", async () => {
        await initStorage();
        const game = {
            id: "456",
            prompt: '"test"',
            content: JSON.stringify({ title: "Loaded Game", code: "// code" }),
        };
        await saveGame(game);
        const loaded = await loadGame("456");
        expect(loaded.id).toBe("456");
        expect(loaded.content).toContain("Loaded Game");
    });

    it("loadGame skips the saved state when readDir lists it first", async () => {
        await initStorage();
        await saveGame({
            id: "321",
            prompt: '"test"',
            content: JSON.stringify({ title: "Saved Game", code: "// code" }),
        });
        await saveGameState("321", { score: 42 });
        // The filesystem does not sort, so the state file can come first
        const { readDir } = await import("@tauri-apps/plugin-fs");
        readDir.mockResolvedValueOnce([
            { name: "321-saved-game.state.json" },
            { name: "321-saved-game.json" },
        ]);
        const loaded = await loadGame("321");
        expect(JSON.parse(loaded.content).title).toBe("Saved Game");
    });

    it("listGames returns metadata", async () => {
        await initStorage();
        await saveGame({
            id: "100",
            prompt: '""',
            content: JSON.stringify({
                title: "Game A",
                description: "Desc A",
                controls: "WASD",
                rules: "Rules A",
                code: "// a",
            }),
        });
        await saveGame({
            id: "200",
            prompt: '""',
            content: JSON.stringify({
                title: "Game B",
                description: "Desc B",
                controls: "Arrow",
                rules: "Rules B",
                code: "// b",
            }),
        });
        const games = await listGames();
        expect(games).toHaveLength(2);
        expect(games[0].title).toBeDefined();
        expect(games[0].id).toBeDefined();
    });

    it("deleteGame removes the file", async () => {
        await initStorage();
        await saveGame({
            id: "789",
            prompt: '""',
            content: JSON.stringify({ title: "Delete Me", code: "// x" }),
        });
        expect(mockFiles.size).toBe(1);
        await deleteGame("789");
        expect(mockFiles.size).toBe(0);
    });

    it("loadGame throws for missing game", async () => {
        await initStorage();
        await expect(loadGame("nonexistent")).rejects.toThrow("not found");
    });
});
