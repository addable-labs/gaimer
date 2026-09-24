import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAnthropicProvider } from '../../../src/providers/anthropic-provider.js'
import { shellExec } from '../../../src/helpers/shell.js'

// Mock the shell helper
vi.mock('../../../src/helpers/shell.js', () => ({
  shellExec: vi.fn().mockRejectedValue(new Error('not in test')),
}))

// What "claude auth status" prints
const signedIn = JSON.stringify({ loggedIn: true }, null, 2)
const signedOut = JSON.stringify({ loggedIn: false }, null, 2)

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

  it('has correct capabilities', () => {
    expect(provider.capabilities.streaming).toBe(false)
    expect(provider.capabilities.imageGeneration).toBe(false)
    expect(provider.capabilities.maxOutputTokens).toBeGreaterThanOrEqual(4096)
  })

  it('generateGame is a function', () => {
    expect(provider.generateGame).toBeDefined()
    expect(typeof provider.generateGame).toBe('function')
  })

  it('generateSprite throws not supported', async () => {
    await expect(provider.generateSprite()).rejects.toThrow('not supported')
  })
})
