import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAnthropicProvider } from '../../../src/providers/anthropic-provider.js'
import { shellExec, shellExecWithInput, withTempFile } from '../../../src/helpers/shell.js'

// Mock the shell helper
vi.mock('../../../src/helpers/shell.js', () => ({
  shellExec: vi.fn().mockRejectedValue(new Error('not in test')),
  shellExecWithInput: vi.fn().mockRejectedValue(new Error('not in test')),
  withTempFile: vi.fn(),
}))

// What "claude auth status" prints
const signedIn = JSON.stringify({ loggedIn: true }, null, 2)
const signedOut = JSON.stringify({ loggedIn: false }, null, 2)

// What "claude -p --output-format json" prints when Claude answers
function cliOutput(answer) {
  return JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    num_turns: 1,
    result: answer,
    session_id: '00000000-0000-0000-0000-000000000000',
  }) + '\n'
}

const game = { title: 'Pong', description: 'Two paddles and a ball', code: 'draw()' }

// A sign-in check that keeps running until the test ends it
function holdCheck() {
  const check = {}
  shellExec.mockImplementationOnce(() => new Promise((resolve, reject) => {
    check.succeed = resolve
    check.fail = reject
  }))
  return check
}

describe('Anthropic Provider', () => {
  let provider

  beforeEach(() => {
    provider = createAnthropicProvider()
  })

  it('has correct id', () => {
    expect(provider.id).toBe('anthropic')
  })

  it('has correct name', () => {
    expect(provider.name).toBe('Anthropic Claude')
  })

  it('has subscription auth method', () => {
    expect(provider.authMethod).toBe('subscription')
  })

  it('is not connected initially', () => {
    expect(provider.isConnected()).toBe(false)
  })

  it('disconnect clears connected state', async () => {
    await provider.disconnect()
    expect(provider.isConnected()).toBe(false)
  })

  describe('connect', () => {
    it('is connected when the Claude CLI is signed in', async () => {
      shellExec.mockResolvedValueOnce(signedIn)

      expect(await provider.connect()).toEqual({ success: true })
      expect(provider.isConnected()).toBe(true)
    })

    it('is not connected once a later check finds the CLI signed out', async () => {
      shellExec.mockResolvedValueOnce(signedIn)
      await provider.connect()

      shellExec.mockResolvedValueOnce(signedOut)
      const result = await provider.connect()

      expect(result.success).toBe(false)
      expect(provider.isConnected()).toBe(false)
      await expect(provider.generateGame('A game of pong').next()).rejects.toThrow('Provider not connected')
    })

    it('is not connected once a later check fails', async () => {
      shellExec.mockResolvedValueOnce(signedIn)
      await provider.connect()

      shellExec.mockRejectedValueOnce(new Error('Command timed out'))
      const result = await provider.connect()

      expect(result).toEqual({ success: false, error: 'Command timed out' })
      expect(provider.isConnected()).toBe(false)
    })

    it('keeps the result of the latest check when an older one ends last', async () => {
      const olderCheck = holdCheck()
      const olderConnect = provider.connect()
      shellExec.mockResolvedValueOnce(signedIn)
      await provider.connect()

      olderCheck.fail(new Error('Command timed out'))
      await olderConnect

      expect(provider.isConnected()).toBe(true)
    })

    it('stays disconnected when a check ends after disconnect()', async () => {
      const check = holdCheck()
      const connecting = provider.connect()
      await provider.disconnect()

      check.succeed(signedIn)
      await connecting

      expect(provider.isConnected()).toBe(false)
    })
  })

  describe('listModels', () => {
    it('offers the Claude CLI\'s aliases, each for the latest model of its kind', async () => {
      expect(await provider.listModels()).toEqual(['sonnet', 'opus', 'haiku'])
    })
  })

  it('has correct capabilities', () => {
    expect(provider.capabilities.streaming).toBe(false)
    expect(provider.capabilities.imageGeneration).toBe(false)
    expect(provider.capabilities.maxOutputTokens).toBeGreaterThanOrEqual(4096)
  })

  it('generateGame is a function', () => {
    expect(provider.generateGame).toBeDefined()
    expect(typeof provider.generateGame).toBe('function')
  })

  describe('generateGame', () => {
    // What the provider wrote to temp files, by file name prefix
    let tempFiles

    async function generate(prompt = 'A game of pong', options = {}) {
      const chunks = []
      for await (const chunk of provider.generateGame(prompt, options)) chunks.push(chunk)
      return chunks
    }

    // The words of the last command line the provider ran
    function commandWords() {
      return shellExecWithInput.mock.lastCall[0].split(' ')
    }

    beforeEach(async () => {
      tempFiles = {}
      withTempFile.mockImplementation(async (prefix, text, fn) => {
        tempFiles[prefix] = text
        return fn(`/tmp/${prefix}-1.txt`)
      })
      shellExec.mockResolvedValueOnce(signedIn)
      await provider.connect()
    })

    it('runs the Claude CLI as a plain completion with the system prompt in a file', async () => {
      shellExecWithInput.mockResolvedValueOnce(cliOutput(JSON.stringify(game)))

      await generate('A game of pong', { model: 'sonnet', systemMessage: 'You write games.' })

      expect(shellExecWithInput).toHaveBeenLastCalledWith(
        `claude -p --model sonnet --tools "" --system-prompt-file '/tmp/gaimer-system-1.txt' --no-session-persistence --safe-mode --strict-mcp-config --output-format json`,
        'A game of pong'
      )
      expect(tempFiles['gaimer-system']).toBe('You write games.')
    })

    it('runs sonnet when no model is chosen', async () => {
      shellExecWithInput.mockResolvedValueOnce(cliOutput(JSON.stringify(game)))

      await generate()

      expect(shellExecWithInput.mock.lastCall[0]).toMatch(/^claude -p --model sonnet /)
    })

    it('starts no MCP servers from the Claude config', async () => {
      shellExecWithInput.mockResolvedValueOnce(cliOutput(JSON.stringify(game)))

      await generate()

      // With --strict-mcp-config only the servers passed with --mcp-config
      // start, and none are passed
      expect(commandWords()).toContain('--strict-mcp-config')
      expect(commandWords()).not.toContain('--mcp-config')
    })

    it('skips CLAUDE.md, hooks, plugins and skills but keeps the sign-in', async () => {
      shellExecWithInput.mockResolvedValueOnce(cliOutput(JSON.stringify(game)))

      await generate()

      // --bare would skip them too, but it never reads the Pro/Max sign-in
      expect(commandWords()).toContain('--safe-mode')
      expect(commandWords()).not.toContain('--bare')
    })

    it('returns the game in the result field', async () => {
      shellExecWithInput.mockResolvedValueOnce(cliOutput(JSON.stringify(game)))

      expect(await generate()).toEqual([{ type: 'complete', data: game }])
    })

    it('finds the result when the login shell prints lines around it', async () => {
      shellExecWithInput.mockResolvedValueOnce(
        'Welcome back!\n' + cliOutput(JSON.stringify(game)) + 'Goodbye\n'
      )

      expect(await generate()).toEqual([{ type: 'complete', data: game }])
    })

    it('finds the result when the Claude settings turn on verbose output', async () => {
      const messages = [
        { type: 'system', subtype: 'init', tools: [] },
        { type: 'assistant', message: { content: [{ type: 'text', text: JSON.stringify(game) }] } },
        JSON.parse(cliOutput(JSON.stringify(game))),
      ]
      shellExecWithInput.mockResolvedValueOnce(JSON.stringify(messages) + '\n')

      expect(await generate()).toEqual([{ type: 'complete', data: game }])
    })

    it('fails with the message of a result that is an error', async () => {
      shellExecWithInput.mockResolvedValueOnce(JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: true,
        result: 'Not logged in · Please run /login',
      }) + '\n')

      await expect(generate()).rejects.toThrow('Claude CLI error: Not logged in · Please run /login')
    })

    it('fails with the message of a result that is an error when the Claude CLI exits with code 1', async () => {
      shellExecWithInput.mockRejectedValueOnce(Object.assign(new Error('Exit code 1'), {
        stdout: JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: true,
          result: 'Not logged in · Please run /login',
        }) + '\n',
      }))

      await expect(generate()).rejects.toThrow('Claude CLI error: Not logged in · Please run /login')
    })

    it('fails with the shell\'s error when the Claude CLI exits without printing a result', async () => {
      shellExecWithInput.mockRejectedValueOnce(Object.assign(new Error('zsh:1: command not found: claude'), {
        stdout: 'Welcome back!\n',
      }))

      await expect(generate()).rejects.toThrow('zsh:1: command not found: claude')
    })

    it('fails when the Claude CLI prints no result', async () => {
      shellExecWithInput.mockResolvedValueOnce('Welcome back!\n')

      await expect(generate()).rejects.toThrow('Claude CLI printed no result')
    })

    it('fails when the result is not a game', async () => {
      shellExecWithInput.mockResolvedValueOnce(cliOutput('Here is your game!'))

      await expect(generate()).rejects.toThrow('Failed to parse game response')
    })
  })

  it('generateSprite throws not supported', async () => {
    await expect(provider.generateSprite()).rejects.toThrow('not supported')
  })
})
