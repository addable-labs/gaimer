import { describe, it, expect, beforeEach } from 'vitest'
import { createProviderRegistry } from '../../../src/providers/registry.js'

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
    generateSprite: overrides.generateSprite || (async () => null),
    capabilities: overrides.capabilities || {
      streaming: true,
      imageGeneration: false,
      maxOutputTokens: 4096,
      sandboxedExecution: false,
    },
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

  describe('list', () => {
    it('returns all registered providers', () => {
      registry.register(createMockProvider('anthropic'))
      registry.register(createMockProvider('openai'))
      const list = registry.list()
      expect(list).toHaveLength(2)
      expect(list.map(p => p.id)).toEqual(['anthropic', 'openai'])
    })

    it('returns empty array when no providers', () => {
      expect(registry.list()).toEqual([])
    })
  })

  describe('remove', () => {
    it('removes a registered provider', () => {
      registry.register(createMockProvider('anthropic'))
      registry.remove('anthropic')
      expect(registry.get('anthropic')).toBeNull()
    })

    it('does not error when removing non-existent provider', () => {
      expect(() => registry.remove('nonexistent')).not.toThrow()
    })

    it('clears active if removed provider was active', () => {
      registry.register(createMockProvider('anthropic'))
      registry.setActive('anthropic')
      registry.remove('anthropic')
      expect(registry.getActive()).toBeNull()
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
})

describe('AIProvider interface', () => {
  it('provider has all required properties', () => {
    const provider = createMockProvider('test')
    expect(provider).toHaveProperty('id')
    expect(provider).toHaveProperty('name')
    expect(provider).toHaveProperty('authMethod')
    expect(provider).toHaveProperty('connect')
    expect(provider).toHaveProperty('disconnect')
    expect(provider).toHaveProperty('isConnected')
    expect(provider).toHaveProperty('generateGame')
    expect(provider).toHaveProperty('generateSprite')
    expect(provider).toHaveProperty('capabilities')
  })

  it('capabilities has required flags', () => {
    const provider = createMockProvider('test')
    expect(provider.capabilities).toHaveProperty('streaming')
    expect(provider.capabilities).toHaveProperty('imageGeneration')
    expect(provider.capabilities).toHaveProperty('maxOutputTokens')
    expect(provider.capabilities).toHaveProperty('sandboxedExecution')
  })
})
