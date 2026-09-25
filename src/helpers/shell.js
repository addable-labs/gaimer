import { Command } from "@tauri-apps/plugin-shell";
import { writeTextFile, remove } from "@tauri-apps/plugin-fs";
import { tempDir, join } from "@tauri-apps/api/path";

/**
 * Run a command through a login shell to ensure the user's full PATH is available.
 * This is necessary because macOS apps launched from Finder/Dock don't inherit
 * the user's shell PATH (e.g. ~/.local/bin won't be found).
 * The shell runs the command with exec, so it must be a single command.
 * Resolves to what the command printed on stdout. When the command exits with
 * an error code, it rejects with stderr (or the code) as the message, and
 * with what the command printed on stdout as error.stdout.
 */
export async function shellExec(command, timeoutMs = 180000) {
    // With exec the shell's process becomes the command's, so a timeout
    // kills the command itself. Without it, zsh runs the command as a child
    // when the user's login files set an EXIT trap, and the kill stops only
    // zsh.
    const cmd = Command.create("shell-cmd", ["-l", "-c", `exec ${command}`]);
    let stdout = "";
    let stderr = "";

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            // Stop the process as well: left running, a Claude call goes on
            // using the user's subscription
            spawned.then((child) => child.kill()).catch(() => {
                /* the command has failed already */
            });
            reject(new Error("Command timed out"));
        }, timeoutMs);

        cmd.on("close", (data) => {
            clearTimeout(timer);
            if (data.code === 0) {
                resolve(stdout);
            } else {
                // The Claude CLI prints why a call failed on stdout
                reject(
                    Object.assign(
                        new Error(stderr.trim() || `Exit code ${data.code}`),
                        { stdout }
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

        const spawned = cmd.spawn();
        spawned.catch((err) => {
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
