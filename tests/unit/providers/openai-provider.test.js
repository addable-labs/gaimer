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
            choices: [{ message: { content: '{"title":"Test Game","code":"// test"}' }, finish_reason: 'stop' }]
          })
        }
      }
      // Some of the models the API lists for a key: besides chat models,
      // models for audio, realtime, transcription and web search, older
      // models that write at most 4096 tokens, and GPT-5 models that
      // OpenAI serves only through its Responses API
      this.models = {
        list: vi.fn(async () => [
          'gpt-3.5-turbo', 'gpt-4-turbo', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-audio-preview',
          'gpt-4o-mini', 'gpt-4o-mini-transcribe', 'gpt-4o-realtime-preview', 'gpt-4o-search-preview',
          'gpt-5-pro', 'gpt-5.3-codex', 'gpt-5.5', 'gpt-5.5-pro',
        ].map((id) => ({ id, object: 'model' }))),
      }
      openai.client = this
    }
  }
  return { default: MockOpenAI }
})

// The models the provider offers
const offered = [
  'gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini',
  'gpt-5.1', 'gpt-5.2', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano',
  'gpt-5.5', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
]
const gpt5 = offered.filter((model) => model.startsWith('gpt-5'))

// What the app passes to generateGame()
const options = { systemMessage: 'Reply with a game as JSON', maxTokens: 16384, temperature: 0.2 }
const messages = [
  { role: 'system', content: 'Reply with a game as JSON' },
  { role: 'user', content: 'A game of pong' },
]

// Generates a game with the model and returns the request sent to OpenAI
async function requestFor(provider, model) {
  await provider.generateGame('A game of pong', { ...options, model }).next()
  return openai.client.chat.completions.create.mock.lastCall[0]
}

// Generates a game with the model, OpenAI answering with the choice
function generateWithAnswer(provider, model, choice) {
  openai.client.chat.completions.create.mockResolvedValueOnce({ choices: [choice] })
  return provider.generateGame('A game of pong', { ...options, model }).next()
}

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

  it('is not connected once a later connect fails', async () => {
    await provider.connect({ apiKey: 'sk-test-key' })

    const result = await provider.connect({})

    expect(result.success).toBe(false)
    expect(provider.isConnected()).toBe(false)
    await expect(provider.generateGame('A game of pong').next()).rejects.toThrow('Provider not connected')
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

    it('offers and names as its default the model it generates with when none is chosen', async () => {
      await provider.connect({ apiKey: 'sk-test-key' })
      await provider.generateGame('A game of pong').next()

      const { model } = openai.client.chat.completions.create.mock.lastCall[0]
      expect(model).toBe('gpt-4o')
      expect(await provider.listModels()).toContain(model)
      expect(provider.defaultModel).toBe(model)
    })
  })

  describe('request', () => {
    beforeEach(async () => {
      await provider.connect({ apiKey: 'sk-test-key' })
    })

    it('sends the GPT-4 models a temperature and max_tokens, as before', async () => {
      for (const model of ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini']) {
        expect(await requestFor(provider, model), model).toStrictEqual({
          messages,
          model,
          temperature: 0.2,
          max_tokens: 16384,
          response_format: { type: 'json_object' },
        })
      }
    })

    it('sends a GPT-5 model no temperature, and room for its reasoning in max_completion_tokens', async () => {
      // No reasoning_effort either: each model's own default applies
      for (const model of gpt5) {
        expect(await requestFor(provider, model), model).toStrictEqual({
          messages,
          model,
          max_completion_tokens: 32768,
          response_format: { type: 'json_object' },
        })
      }
    })

    it('decides by the model id, so a GPT-5 snapshot gets the same request', async () => {
      const request = await requestFor(provider, 'gpt-5.4-2026-03-05')
      expect(request).not.toHaveProperty('temperature')
      expect(request).not.toHaveProperty('max_tokens')
      expect(request.max_completion_tokens).toBe(32768)
    })
  })

  describe('an answer cut off at the token limit', () => {
    beforeEach(async () => {
      await provider.connect({ apiKey: 'sk-test-key' })
    })

    it('says so when the reasoning used up the limit before the game', async () => {
      const answer = generateWithAnswer(provider, 'gpt-5.5', { message: { content: '' }, finish_reason: 'length' })
      await expect(answer).rejects.toThrow(
        'The answer from gpt-5.5 was cut off at the limit of 32768 tokens, reasoning included, before the game was complete. Retry, or describe a simpler game.'
      )
    })

    it('says so when the game stops partway', async () => {
      const partial = { message: { content: '{"title":"Pong","code":"function dra' }, finish_reason: 'length' }
      await expect(generateWithAnswer(provider, 'gpt-5.6-luna', partial)).rejects.toThrow(
        'The answer from gpt-5.6-luna was cut off at the limit of 32768 tokens, reasoning included, before the game was complete. Retry, or describe a simpler game.'
      )
      await expect(generateWithAnswer(provider, 'gpt-4o', partial)).rejects.toThrow(
        'The answer from gpt-4o was cut off at the limit of 16384 tokens before the game was complete. Retry, or describe a simpler game.'
      )
    })

    it('still gives a complete answer as a game', async () => {
      const answer = { message: { content: '{"title":"Pong","code":"draw()"}' }, finish_reason: 'stop' }
      const { value } = await generateWithAnswer(provider, 'gpt-5.5', answer)
      expect(value).toEqual({ type: 'complete', data: { title: 'Pong', code: 'draw()' } })
    })
  })

  it('generateGame gives the game in the one chunk App reads with for await', async () => {
    await provider.connect({ apiKey: 'sk-test-key' })

    const chunks = []
    for await (const chunk of provider.generateGame('A game of pong', options)) chunks.push(chunk)

    expect(chunks).toEqual([{ type: 'complete', data: { title: 'Test Game', code: '// test' } }])
  })
})
