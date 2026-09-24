import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Command } from '@tauri-apps/plugin-shell'
import { shellExecWithInput, withTempFile } from '../../../src/helpers/shell.js'

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

describe('shell', () => {
  beforeEach(() => {
    tempFiles.clear()
    vi.spyOn(Date, 'now').mockReturnValue(1790000000000)
  })

  afterEach(() => {
    vi.restoreAllMocks()
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
        `claude -p --output-format json < '/tmp/gaimer-prompt-1790000000000.txt'`,
      ])
      expect(input).toBe('A game of pong')
      expect(output).toBe('{"type":"result"}\n')
      expect(tempFiles.size).toBe(0)
    })
  })
})
