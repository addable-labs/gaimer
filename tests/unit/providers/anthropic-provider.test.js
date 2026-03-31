import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAnthropicProvider } from '../../../src/providers/anthropic-provider.js'

// Mock the shell helper
vi.mock('../../../src/helpers/shell.js', () => ({
  shellExec: vi.fn().mockRejectedValue(new Error('not in test')),
}))

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
