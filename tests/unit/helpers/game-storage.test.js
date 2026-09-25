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

import { exists, mkdir } from "@tauri-apps/plugin-fs";
import {
    initStorage,
    saveGame,
    loadGame,
    listGames,
    deleteGame,
    saveGameState,
    loadGameState,
    addGameVersion,
    replaceGameVersion,
    undoGameVersion,
} from "../../../src/helpers/game-storage.js";

// The folder the games are kept in, in iCloud Drive
const gamesFolder = "/Users/test/Library/Mobile Documents/com~apple~CloudDocs/Gaimer";

describe("game-storage", () => {
    beforeEach(() => {
        mockFiles.clear();
        vi.clearAllMocks();
    });

    it("initStorage creates the games folder when it does not exist", async () => {
        exists.mockResolvedValueOnce(false);
        await initStorage();
        expect(exists).toHaveBeenCalledWith(gamesFolder);
        expect(mkdir).toHaveBeenCalledExactlyOnceWith(gamesFolder, { recursive: true });
    });

    it("initStorage leaves the games folder alone when it exists", async () => {
        await initStorage();
        expect(exists).toHaveBeenCalledWith(gamesFolder);
        expect(mkdir).not.toHaveBeenCalled();
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

    it("saveGame keeps the game's id and prompt when the content has its own", async () => {
        await initStorage();
        const game = {
            id: "555",
            prompt: '"a maze"',
            content: JSON.stringify({ id: "999", prompt: "other", title: "Maze", code: "// code" }),
        };
        await saveGame(game);
        const key = [...mockFiles.keys()][0];
        const saved = JSON.parse(mockFiles.get(key));
        expect(saved.id).toBe("555");
        expect(saved.prompt).toBe('"a maze"');
        expect(saved.title).toBe("Maze");
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

    describe("saved state", () => {
        beforeEach(async () => {
            await initStorage();
            await saveGame({
                id: "321",
                prompt: '"test"',
                content: JSON.stringify({ title: "Saved Game", code: "// code" }),
            });
        });

        it("saveGameState writes the state next to the game's file, and loadGameState reads it back", async () => {
            await saveGameState("321", { level: 2, score: 42 });
            expect(mockFiles.get(`${gamesFolder}/321-saved-game.state.json`)).toBe('{"level":2,"score":42}');
            expect(await loadGameState("321")).toEqual({ level: 2, score: 42 });
        });

        it("saveGameState fails for a game that is not in the folder, and writes nothing", async () => {
            await expect(saveGameState("999", { score: 42 })).rejects.toThrow("Game not found: 999");
            expect([...mockFiles.keys()]).toEqual([`${gamesFolder}/321-saved-game.json`]);
        });

        it("loadGameState returns null for a game with no saved state", async () => {
            expect(await loadGameState("321")).toBeNull();
        });

        it("loadGameState returns null for a saved state that is not JSON", async () => {
            mockFiles.set(`${gamesFolder}/321-saved-game.state.json`, "{ score: 4");
            expect(await loadGameState("321")).toBeNull();
        });

        it("listGames marks the games that have a saved state, and lists no state file as a game", async () => {
            await saveGame({
                id: "400",
                prompt: '""',
                content: JSON.stringify({ title: "New Game", code: "// code" }),
            });
            await saveGameState("321", { score: 42 });
            const games = await listGames();
            expect(games.map(({ id, title, hasSavedState }) => ({ id, title, hasSavedState }))).toEqual([
                { id: "400", title: "New Game", hasSavedState: false },
                { id: "321", title: "Saved Game", hasSavedState: true },
            ]);
        });

        it("deleteGame deletes the game's saved state too", async () => {
            await saveGameState("321", { score: 42 });
            expect(mockFiles.size).toBe(2);
            await deleteGame("321");
            expect(mockFiles.size).toBe(0);
        });
    });

    describe("versions", () => {
        // A game of Pong, made from a description, and two changes of it
        const pong = { title: "Pong", description: "Two paddles", rules: "First to 5", code: "ball(5);" };
        const fasterPong = { ...pong, code: "ball(8);" };
        const bigPong = { ...pong, title: "Big Pong", rules: "First to 7", code: "ball(8); big();" };
        const pongFile = `${gamesFolder}/500-pong.json`;
        const bigPongFile = `${gamesFolder}/500-big-pong.json`;

        // The files in the folder, by name
        function fileNames() {
            return [...mockFiles.keys()].map((path) => path.split("/").pop());
        }

        // The file's data
        function readFile(path) {
            return JSON.parse(mockFiles.get(path));
        }

        beforeEach(async () => {
            await initStorage();
            await saveGame({ id: "500", prompt: '"A game of pong"', content: JSON.stringify(pong) });
        });

        it("loadGame gives a game that has not been changed with no change requests", async () => {
            expect(await loadGame("500")).toEqual({
                id: "500",
                prompt: '"A game of pong"',
                content: JSON.stringify(pong),
                changeRequests: [],
            });
        });

        it("addGameVersion saves the changed game as the game's version, and keeps the one before with the request that changed it", async () => {
            const saved = await addGameVersion("500", fasterPong, "Make the ball faster");

            expect(readFile(pongFile)).toEqual({
                ...fasterPong,
                id: "500",
                prompt: '"A game of pong"',
                versions: [{ game: pong, request: "Make the ball faster" }],
            });
            // The game as loadGame gives it: the version, without the earlier ones
            const loaded = await loadGame("500");
            expect(saved).toEqual(loaded);
            expect(loaded).toEqual({
                id: "500",
                prompt: '"A game of pong"',
                content: JSON.stringify(fasterPong),
                changeRequests: ["Make the ball faster"],
            });
        });

        it("keeps each version before a change, oldest first", async () => {
            await addGameVersion("500", fasterPong, "Make the ball faster");
            await addGameVersion("500", bigPong, "Make it big");

            expect(readFile(bigPongFile).versions).toEqual([
                { game: pong, request: "Make the ball faster" },
                { game: fasterPong, request: "Make it big" },
            ]);
            expect((await loadGame("500")).changeRequests).toEqual(["Make the ball faster", "Make it big"]);
        });

        it("undoGameVersion goes back one version at a time, to the first, and then fails, changing nothing", async () => {
            await addGameVersion("500", fasterPong, "Make the ball faster");
            await addGameVersion("500", bigPong, "Make it big");

            const once = await undoGameVersion("500");
            expect(once).toEqual({
                id: "500",
                prompt: '"A game of pong"',
                content: JSON.stringify(fasterPong),
                changeRequests: ["Make the ball faster"],
            });
            expect(await loadGame("500")).toEqual(once);

            const twice = await undoGameVersion("500");
            expect(twice).toEqual({ id: "500", prompt: '"A game of pong"', content: JSON.stringify(pong), changeRequests: [] });
            expect(readFile(pongFile)).toEqual({ ...pong, id: "500", prompt: '"A game of pong"', versions: [] });

            const files = new Map(mockFiles);
            await expect(undoGameVersion("500")).rejects.toThrow("The game has no earlier version: 500");
            expect(mockFiles).toEqual(files);
        });

        it("a change of title leaves one file, under the new title, where the game is found by its id", async () => {
            await addGameVersion("500", bigPong, "Make it big");

            expect(fileNames()).toEqual(["500-big-pong.json"]);
            expect(JSON.parse((await loadGame("500")).content).title).toBe("Big Pong");
            await saveGameState("500", { score: 3 });
            expect(await loadGameState("500")).toEqual({ score: 3 });
            expect(fileNames()).toEqual(["500-big-pong.json", "500-big-pong.state.json"]);

            // An undo that goes back to the old title goes back to its file
            await undoGameVersion("500");
            expect(fileNames()).toEqual(["500-pong.json"]);

            await addGameVersion("500", bigPong, "Make it big");
            await deleteGame("500");
            expect(mockFiles.size).toBe(0);
        });

        it("listGames lists a changed game once, as its version, and no earlier version", async () => {
            await addGameVersion("500", fasterPong, "Make the ball faster");
            await addGameVersion("500", bigPong, "Make it big");

            expect(await listGames()).toEqual([
                { id: "500", title: "Big Pong", description: "Two paddles", controls: undefined, rules: "First to 7", hasSavedState: false },
            ]);
        });

        it("deleteGame deletes everything of a changed game: its file, with its versions, and its saved state", async () => {
            await addGameVersion("500", fasterPong, "Make the ball faster");
            await saveGameState("500", { score: 3 });
            // And a second file of the game, which a change of title that
            // failed halfway would leave
            mockFiles.set(bigPongFile, JSON.stringify({ ...bigPong, id: "500" }));
            await saveGame({ id: "600", prompt: '"A game of snake"', content: JSON.stringify({ title: "Snake", code: "snake();" }) });

            await deleteGame("500");

            expect(fileNames()).toEqual(["600-snake.json"]);
        });

        it("a change, an undo and a replaced version each delete the game's saved state, which was saved from other code", async () => {
            const steps = [
                () => addGameVersion("500", fasterPong, "Make the ball faster"),
                () => replaceGameVersion("500", { ...fasterPong, code: "ball(9);" }),
                () => undoGameVersion("500"),
            ];
            for (const step of steps) {
                await saveGameState("500", { score: 3 });
                expect(await loadGameState("500")).toEqual({ score: 3 });

                await step();

                expect(await loadGameState("500")).toBeNull();
                expect(fileNames().some((name) => name.endsWith(".state.json"))).toBe(false);
            }
        });

        it("replaceGameVersion replaces the game's version, and keeps its earlier versions", async () => {
            await addGameVersion("500", fasterPong, "Make the ball faster");
            const fixed = { ...bigPong, code: "ball(8); big(); fixed();" };

            const saved = await replaceGameVersion("500", fixed);

            expect(fileNames()).toEqual(["500-big-pong.json"]);
            expect(readFile(bigPongFile)).toEqual({
                ...fixed,
                id: "500",
                prompt: '"A game of pong"',
                versions: [{ game: pong, request: "Make the ball faster" }],
            });
            expect(saved).toEqual({
                id: "500",
                prompt: '"A game of pong"',
                content: JSON.stringify(fixed),
                changeRequests: ["Make the ball faster"],
            });
        });

        it("keeps the game's own id, description and versions over keys of the same name in a game from the model", async () => {
            const answer = { ...fasterPong, id: "999", prompt: "other", versions: [] };

            await addGameVersion("500", answer, "Make the ball faster");

            expect(readFile(pongFile)).toEqual({
                ...fasterPong,
                id: "500",
                prompt: '"A game of pong"',
                versions: [{ game: pong, request: "Make the ball faster" }],
            });
        });

        it("fails for a game that is not in the folder, and writes nothing", async () => {
            for (const step of [
                () => addGameVersion("999", fasterPong, "Make the ball faster"),
                () => replaceGameVersion("999", fasterPong),
                () => undoGameVersion("999"),
            ]) {
                await expect(step()).rejects.toThrow("Game not found: 999");
            }
            expect(fileNames()).toEqual(["500-pong.json"]);
        });
    });
});
