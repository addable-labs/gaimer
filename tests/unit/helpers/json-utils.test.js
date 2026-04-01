import { describe, it, expect } from "vitest";
import { safeParseGameJSON } from "../../../src/helpers/json-utils.js";

describe("safeParseGameJSON", () => {
    const validGame = JSON.stringify({
        title: "Test Game",
        description: "A test",
        code: "const canvas = document.getElementById('game-canvas');",
    });

    it("parses valid game JSON", () => {
        const result = safeParseGameJSON(validGame);
        expect(result.ok).toBe(true);
        expect(result.data.title).toBe("Test Game");
        expect(result.data.code).toContain("game-canvas");
    });

    it("strips ```json fences", () => {
        const fenced = "```json\n" + validGame + "\n```";
        const result = safeParseGameJSON(fenced);
        expect(result.ok).toBe(true);
        expect(result.data.title).toBe("Test Game");
    });

    it("strips plain ``` fences", () => {
        const fenced = "```\n" + validGame + "\n```";
        const result = safeParseGameJSON(fenced);
        expect(result.ok).toBe(true);
    });

    it("fails on empty input", () => {
        expect(safeParseGameJSON("").ok).toBe(false);
        expect(safeParseGameJSON(null).ok).toBe(false);
        expect(safeParseGameJSON(undefined).ok).toBe(false);
    });

    it("fails on malformed JSON", () => {
        const result = safeParseGameJSON("{bad json");
        expect(result.ok).toBe(false);
        expect(result.error).toContain("Invalid JSON");
    });

    it("fails when title is missing", () => {
        const noTitle = JSON.stringify({ code: "// game" });
        const result = safeParseGameJSON(noTitle);
        expect(result.ok).toBe(false);
        expect(result.error).toContain("title");
    });

    it("fails when code is missing", () => {
        const noCode = JSON.stringify({ title: "Game" });
        const result = safeParseGameJSON(noCode);
        expect(result.ok).toBe(false);
        expect(result.error).toContain("code");
    });

    it("fails on non-object JSON", () => {
        const result = safeParseGameJSON('"just a string"');
        expect(result.ok).toBe(false);
        expect(result.error).toContain("not a JSON object");
    });

    it("handles whitespace around fences", () => {
        const padded = "  ```json\n  " + validGame + "\n  ```  ";
        const result = safeParseGameJSON(padded);
        expect(result.ok).toBe(true);
    });
});
