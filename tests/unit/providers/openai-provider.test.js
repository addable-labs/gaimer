import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createOpenAIProvider } from '../../../src/providers/openai-provider.js'

// The client the provider made last
const openai = vi.hoisted(() => ({ client: null }))

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
      // Some of the models the API lists for a key: besides chat models,
      // models for audio, realtime, transcription and web search, and
      // older models that write at most 4096 tokens
      this.models = {
        list: vi.fn(async () => [
          'gpt-3.5-turbo', 'gpt-4-turbo', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-audio-preview',
          'gpt-4o-mini', 'gpt-4o-mini-transcribe', 'gpt-4o-realtime-preview', 'gpt-4o-search-preview',
        ].map((id) => ({ id, object: 'model' }))),
      }
      openai.client = this
    }
  }
  return { default: MockOpenAI }
})

// The models the provider offers
const offered = ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini']

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

  describe('listModels', () => {
    it('offers its own short list, not every model the API lists for the key', async () => {
      await provider.connect({ apiKey: 'sk-test-key' })
      expect(await provider.listModels()).toEqual(offered)
    })

    it('offers the same models before an API key is saved', async () => {
      expect(await provider.listModels()).toEqual(offered)
    })

    it('offers the model it generates with when none is chosen', async () => {
      await provider.connect({ apiKey: 'sk-test-key' })
      await provider.generateGame('A game of pong').next()

      const { model } = openai.client.chat.completions.create.mock.lastCall[0]
      expect(model).toBe('gpt-4o')
      expect(await provider.listModels()).toContain(model)
    })
  })

  it('generateGame is an async generator function', () => {
    expect(provider.generateGame).toBeDefined()
    expect(typeof provider.generateGame).toBe('function')
  })
})
