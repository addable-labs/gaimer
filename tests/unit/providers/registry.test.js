import { describe, it, expect, beforeEach } from 'vitest'
import { createProviderRegistry } from '../../../src/providers/registry.js'
import { createOpenAIProvider } from '../../../src/providers/openai-provider.js'
import { createAnthropicProvider } from '../../../src/providers/anthropic-provider.js'

// Mock provider that implements the AIProvider interface
function createMockProvider(id, overrides = {}) {
  return {
    id,
    name: overrides.name || `Mock ${id}`,
    authMethod: overrides.authMethod || 'apikey',
    connect: overrides.connect || (async () => ({ success: true })),
    disconnect: overrides.disconnect || (async () => {}),
    isConnected: overrides.isConnected || (() => false),
    generateGame: overrides.generateGame || (async function* () {}),
  }
}

describe('ProviderRegistry', () => {
  let registry

  beforeEach(() => {
    registry = createProviderRegistry()
  })

  describe('register', () => {
    it('registers a provider', () => {
      const provider = createMockProvider('anthropic')
      registry.register(provider)
      expect(registry.get('anthropic')).toBe(provider)
    })

    it('overwrites a provider with the same id', () => {
      const provider1 = createMockProvider('openai', { name: 'First' })
      const provider2 = createMockProvider('openai', { name: 'Second' })
      registry.register(provider1)
      registry.register(provider2)
      expect(registry.get('openai').name).toBe('Second')
    })
  })

  describe('get', () => {
    it('returns registered provider by id', () => {
      const provider = createMockProvider('anthropic')
      registry.register(provider)
      expect(registry.get('anthropic')).toBe(provider)
    })

    it('returns null for unknown id', () => {
      expect(registry.get('nonexistent')).toBeNull()
    })
  })

  describe('setActive / getActive', () => {
    it('sets and gets the active provider', () => {
      const provider = createMockProvider('anthropic')
      registry.register(provider)
      registry.setActive('anthropic')
      expect(registry.getActive()).toBe(provider)
    })

    it('returns null when no active provider', () => {
      expect(registry.getActive()).toBeNull()
    })

    it('throws when setting active to unknown provider', () => {
      expect(() => registry.setActive('nonexistent')).toThrow('Provider "nonexistent" is not registered')
    })
  })

  describe('deactivate', () => {
    it('leaves no active provider when the given one is active', () => {
      const provider = createMockProvider('anthropic')
      registry.register(provider)
      registry.setActive('anthropic')
      registry.deactivate('anthropic')
      expect(registry.getActive()).toBeNull()
      expect(registry.get('anthropic')).toBe(provider)
    })

    it('keeps another provider active', () => {
      const openai = createMockProvider('openai')
      registry.register(openai)
      registry.register(createMockProvider('anthropic'))
      registry.setActive('openai')
      registry.deactivate('anthropic')
      expect(registry.getActive()).toBe(openai)
    })
  })
})

describe('AIProvider interface', () => {
  it('is implemented by each provider App registers', async () => {
    for (const provider of [createOpenAIProvider(), createAnthropicProvider()]) {
      expect(provider, provider.id).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        authMethod: expect.stringMatching(/^(apikey|subscription)$/),
        defaultModel: expect.any(String),
        connect: expect.any(Function),
        disconnect: expect.any(Function),
        isConnected: expect.any(Function),
        listModels: expect.any(Function),
        generateGame: expect.any(Function),
      })
      expect(provider.isConnected(), provider.id).toBe(false)
      expect(await provider.listModels(), provider.id).toContain(provider.defaultModel)
      // App reads the game from it with for await
      expect(provider.generateGame('A game of pong')[Symbol.asyncIterator], provider.id).toBeTypeOf('function')
    }
  })
})
