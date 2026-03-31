import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useProviderStore } from '../../../src/stores/provider-store.js'

describe('provider-store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('has no active provider initially', () => {
    const store = useProviderStore()
    expect(store.activeProviderId).toBeNull()
  })

  it('has empty connections initially', () => {
    const store = useProviderStore()
    expect(store.connections).toEqual({})
  })

  it('setActiveProvider updates activeProviderId', () => {
    const store = useProviderStore()
    store.setActiveProvider('anthropic')
    expect(store.activeProviderId).toBe('anthropic')
  })

  it('addConnection stores connection info', () => {
    const store = useProviderStore()
    store.addConnection('anthropic', { connected: true, authMethod: 'oauth' })
    expect(store.connections.anthropic).toEqual({ connected: true, authMethod: 'oauth' })
  })

  it('removeConnection removes connection info', () => {
    const store = useProviderStore()
    store.addConnection('anthropic', { connected: true })
    store.removeConnection('anthropic')
    expect(store.connections.anthropic).toBeUndefined()
  })

  it('removeConnection clears active if it was the active provider', () => {
    const store = useProviderStore()
    store.setActiveProvider('anthropic')
    store.addConnection('anthropic', { connected: true })
    store.removeConnection('anthropic')
    expect(store.activeProviderId).toBeNull()
  })

  it('isProviderConnected returns correct state', () => {
    const store = useProviderStore()
    expect(store.isProviderConnected('anthropic')).toBe(false)
    store.addConnection('anthropic', { connected: true })
    expect(store.isProviderConnected('anthropic')).toBe(true)
  })
})
