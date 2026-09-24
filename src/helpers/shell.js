import { Command } from "@tauri-apps/plugin-shell";

/**
 * Run a command through a login shell to ensure the user's full PATH is available.
 * This is necessary because macOS apps launched from Finder/Dock don't inherit
 * the user's shell PATH (e.g. ~/.local/bin won't be found).
 */
export async function shellExec(command, timeoutMs = 180000) {
    const cmd = Command.create("shell-cmd", ["-l", "-c", command]);
    let stdout = "";
    let stderr = "";

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error("Command timed out"));
        }, timeoutMs);

        cmd.on("close", (data) => {
            clearTimeout(timer);
            if (data.code === 0) {
                resolve(stdout);
            } else {
                reject(
                    new Error(
                        stderr.trim() || `Exit code ${data.code}`
                    )
                );
            }
        });

        cmd.on("error", (error) => {
            clearTimeout(timer);
            reject(new Error(String(error)));
        });

        cmd.stdout.on("data", (line) => {
            stdout += line;
        });

        cmd.stderr.on("data", (line) => {
            stderr += line;
        });

        cmd.spawn().catch((err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

/**
 * Write text to a new file in the temp directory and pass its path to fn.
 * The file is removed once fn has finished.
 */
export async function withTempFile(prefix, text, fn) {
    const { writeTextFile, remove } = await import("@tauri-apps/plugin-fs");
    const { tempDir, join } = await import("@tauri-apps/api/path");

    const tmp = await tempDir();
    const tmpFile = await join(tmp, `${prefix}-${Date.now()}.txt`);

    await writeTextFile(tmpFile, text);

    try {
        return await fn(tmpFile);
    } finally {
        try { await remove(tmpFile); } catch { /* ignore cleanup errors */ }
    }
}

/**
 * Run a command through a login shell, feeding input via a temp file redirect.
 * Tauri's shell plugin cannot close stdin, so we write to a file and use < redirection.
 */
export async function shellExecWithInput(command, input, timeoutMs = 300000) {
    return withTempFile("gaimer-prompt", input, (tmpFile) =>
        shellExec(`${command} < '${tmpFile}'`, timeoutMs)
    );
}
