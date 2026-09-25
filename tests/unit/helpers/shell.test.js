import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { Command } from '@tauri-apps/plugin-shell'
import { shellExec, shellExecWithInput, withTempFile } from '../../../src/helpers/shell.js'
import { shellRuns } from '../../capability.js'
import * as plugin from '../../plugin-shell.js'

vi.mock('@tauri-apps/plugin-shell', () => ({
  Command: { create: vi.fn() },
}))

// The temp directory, as a map of file path to text
const tempFiles = new Map()
vi.mock('@tauri-apps/plugin-fs', () => ({
  writeTextFile: vi.fn(async (path, text) => { tempFiles.set(path, text) }),
  remove: vi.fn(async (path) => { tempFiles.delete(path) }),
}))

vi.mock('@tauri-apps/api/path', () => ({
  tempDir: vi.fn(async () => '/tmp'),
  join: vi.fn(async (...parts) => parts.join('/')),
}))

// A command that prints stdout and then exits with code
function fakeCommand(stdout, code = 0) {
  const on = {}
  return {
    on: (event, handler) => { on[event] = handler },
    stdout: { on: (event, handler) => { on.stdout = handler } },
    stderr: { on: (event, handler) => { on.stderr = handler } },
    spawn: async () => {
      on.stdout(stdout)
      on.close({ code })
    },
  }
}

// A command that tauri-plugin-shell runs under the app's capability, in a
// real process with the environment env. Like the plugin, kill() sends
// SIGKILL to the process it started, and to no other. Once the command is
// spawned, printed resolves to what the process prints first, and exited
// resolves when the process has ended.
function processCommand(program, args, env) {
  const on = {}
  const command = {
    on: (event, handler) => { on[event] = handler },
    stdout: { on: (event, handler) => { on.stdout = handler } },
    stderr: { on: (event, handler) => { on.stderr = handler } },
    spawn: async () => {
      const run = shellRuns('spawn', program, args)
      if (!run) throw new Error(`program not allowed on the configured shell scope: ${program}`)
      const child = spawn(run.cmd, run.args, { env })
      command.printed = new Promise((resolve) => child.stdout.once('data', (data) => resolve(String(data))))
      command.exited = new Promise((resolve) => child.once('exit', resolve))
      child.stdout.on('data', (data) => on.stdout(String(data)))
      child.stderr.on('data', (data) => on.stderr(String(data)))
      child.on('close', (code, signal) => on.close({ code, signal }))
      return { pid: child.pid, kill: async () => { child.kill('SIGKILL') } }
    },
  }
  return command
}

// Whether a process with this pid is running
function isRunning(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    if (err.code === 'ESRCH') return false
    throw err
  }
}

describe('shell', () => {
  beforeEach(() => {
    tempFiles.clear()
    vi.spyOn(Date, 'now').mockReturnValue(1790000000000)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('shellExec', () => {
    it('kills the process when the command times out', async () => {
      // A sign-in check that never ends, run as the shell plugin would
      // under the app's capability
      Command.create.mockImplementationOnce(plugin.Command.create)
      plugin.shell.exits = () => false

      await expect(shellExec('claude auth status', 10)).rejects.toThrow('Command timed out')
      await flushPromises()

      expect(plugin.shell.killed).toEqual([{ cmd: '/bin/zsh', args: ['-l', '-c', 'exec claude auth status'] }])
    })

    it('passes what the command printed along when it fails', async () => {
      Command.create.mockImplementationOnce(() => fakeCommand('{"type":"result","is_error":true}\n', 1))

      await expect(shellExec('claude -p --output-format json')).rejects.toMatchObject({
        message: 'Exit code 1',
        stdout: '{"type":"result","is_error":true}\n',
      })
    })

    // zsh is the shell the app runs commands in, on macOS
    describe.skipIf(!existsSync('/bin/zsh'))('in zsh', () => {
      let home
      // The pid of the stand-in for the Claude CLI
      let pid

      beforeEach(() => {
        // A home folder whose login files set an EXIT trap, as a user's may,
        // and put a stand-in for the Claude CLI first on the PATH. The
        // stand-in prints its pid and waits.
        home = mkdtempSync(`${tmpdir()}/gaimer-zsh-`)
        writeFileSync(`${home}/.zshenv`, "trap 'true' EXIT\n")
        writeFileSync(`${home}/.zlogin`, 'PATH="$ZDOTDIR/bin:$PATH"\n')
        mkdirSync(`${home}/bin`)
        writeFileSync(`${home}/bin/claude`, '#!/bin/sh\necho $$\nexec sleep 30\n', { mode: 0o755 })
        pid = undefined
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      })

      afterEach(() => {
        vi.useRealTimers()
        if (pid && isRunning(pid)) process.kill(pid, 'SIGKILL')
        rmSync(home, { recursive: true, force: true })
      })

      it('kills the command, not only zsh, when the user\'s login files set an EXIT trap', async () => {
        let command
        Command.create.mockImplementationOnce((program, args) => {
          command = processCommand(program, args, { HOME: home, ZDOTDIR: home, PATH: '/usr/bin:/bin' })
          return command
        })

        const timedOut = expect(shellExec('claude auth status', 1000)).rejects.toThrow('Command timed out')
        pid = Number(await command.printed)
        vi.advanceTimersByTime(1000)
        await timedOut
        await command.exited

        expect(isRunning(pid)).toBe(false)
      })
    })
  })

  describe('withTempFile', () => {
    it('writes the text to a new temp file and removes it afterwards', async () => {
      let seen
      const result = await withTempFile('gaimer-system', 'You write games.', async (path) => {
        seen = { path, text: tempFiles.get(path) }
        return 'done'
      })

      expect(result).toBe('done')
      expect(seen).toEqual({ path: '/tmp/gaimer-system-1790000000000.txt', text: 'You write games.' })
      expect(tempFiles.size).toBe(0)
    })

    it('removes the file when the work fails', async () => {
      let written
      await expect(withTempFile('gaimer-system', 'You write games.', async (path) => {
        written = tempFiles.has(path)
        throw new Error('Command timed out')
      })).rejects.toThrow('Command timed out')

      expect(written).toBe(true)
      expect(tempFiles.size).toBe(0)
    })
  })

  describe('shellExecWithInput', () => {
    it('runs the command in a login shell with the input file on stdin', async () => {
      let input
      Command.create.mockImplementationOnce(() => {
        input = tempFiles.get('/tmp/gaimer-prompt-1790000000000.txt')
        return fakeCommand('{"type":"result"}\n')
      })

      const output = await shellExecWithInput('claude -p --output-format json', 'A game of pong')

      expect(Command.create).toHaveBeenCalledWith('shell-cmd', [
        '-l',
        '-c',
        `exec claude -p --output-format json < '/tmp/gaimer-prompt-1790000000000.txt'`,
      ])
      expect(input).toBe('A game of pong')
      expect(output).toBe('{"type":"result"}\n')
      expect(tempFiles.size).toBe(0)
    })
  })
})
