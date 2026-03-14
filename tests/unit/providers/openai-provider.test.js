import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createOpenAIProvider } from '../../../src/providers/openai-provider.js'

// Mock OpenAI SDK - must be a class since source uses `new OpenAI()`
vi.mock('openai', () => {
  class MockOpenAI {
    constructor() {
      this.chat = {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: '{"title":"Test Game","code":"// test"}' } }]
          })
        }
      }
    }
  }
  return { default: MockOpenAI }
})

describe('OpenAI Provider', () => {
  let provider

  beforeEach(() => {
    provider = createOpenAIProvider()
  })

  it('has correct id', () => {
    expect(provider.id).toBe('openai')
  })

  it('has correct name', () => {
    expect(provider.name).toBe('OpenAI')
  })

  it('has apikey auth method', () => {
    expect(provider.authMethod).toBe('apikey')
  })

  it('is not connected initially', () => {
    expect(provider.isConnected()).toBe(false)
  })

  it('connect with API key sets connected state', async () => {
    const result = await provider.connect({ apiKey: 'sk-test-key' })
    expect(result.success).toBe(true)
    expect(provider.isConnected()).toBe(true)
  })

  it('connect without API key fails', async () => {
    const result = await provider.connect({})
    expect(result.success).toBe(false)
  })

  it('disconnect clears connected state', async () => {
    await provider.connect({ apiKey: 'sk-test-key' })
    await provider.disconnect()
    expect(provider.isConnected()).toBe(false)
  })

  it('has correct capabilities', () => {
    expect(provider.capabilities.streaming).toBe(true)
    expect(provider.capabilities.imageGeneration).toBe(true)
    expect(provider.capabilities.maxOutputTokens).toBeGreaterThanOrEqual(4096)
    expect(provider.capabilities.sandboxedExecution).toBe(false)
  })

  it('generateGame is an async generator function', () => {
    expect(provider.generateGame).toBeDefined()
    expect(typeof provider.generateGame).toBe('function')
  })
})
