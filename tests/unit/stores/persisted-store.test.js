import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { usePersistedStore } from '../../../src/stores/persisted-store.js'
import { createAnthropicProvider } from '../../../src/providers/anthropic-provider.js'

function saved(key) {
  const value = localStorage.getItem(key)
  return value === null ? null : JSON.parse(value)
}

describe('persisted-store', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  describe('selectedModels', () => {
    it('starts with no model chosen for either provider', () => {
      const store = usePersistedStore()
      expect(store.selectedModels).toEqual({ openai: '', anthropic: '' })
    })

    it('keeps the model chosen for one provider when switching to the other', () => {
      const store = usePersistedStore()
      store.selectedModels.openai = 'gpt-4o'
      store.selectedProvider = 'anthropic'
      expect(store.selectedModels.anthropic).toBe('')

      store.selectedModels.anthropic = 'claude-opus-4-6'
      store.selectedProvider = 'openai'
      expect(store.selectedModels).toEqual({ openai: 'gpt-4o', anthropic: 'claude-opus-4-6' })
    })

    it('saves the model for each provider and loads it on the next start', async () => {
      const store = usePersistedStore()
      store.selectedModels.openai = 'gpt-4o-mini'
      store.selectedModels.anthropic = 'haiku'
      await nextTick()

      setActivePinia(createPinia())
      expect(usePersistedStore().selectedModels).toEqual({ openai: 'gpt-4o-mini', anthropic: 'haiku' })
    })
  })

  describe('claudeEffort', () => {
    it('starts with no level chosen, and saves none', () => {
      expect(usePersistedStore().claudeEffort).toBe('')
      expect(saved('claudeEffort')).toBeNull()
    })

    it('saves the level chosen and loads it on the next start', async () => {
      for (const level of ['low', 'medium', 'high']) {
        usePersistedStore().claudeEffort = level
        await nextTick()

        setActivePinia(createPinia())
        expect(usePersistedStore().claudeEffort, level).toBe(level)
      }
      expect(saved('claudeEffort')).toBe('high')
    })

    it('has no level chosen with a store an earlier version saved, which has none', () => {
      localStorage.setItem('selectedProvider', JSON.stringify('anthropic'))
      localStorage.setItem('selectedModels', JSON.stringify({ openai: '', anthropic: 'opus' }))

      expect(usePersistedStore().claudeEffort).toBe('')
    })

    it('has no level chosen when the level saved is not one the app offers', () => {
      for (const level of ['xhigh', 'max', 'turbo', 'LOW', 3, { level: 'high' }]) {
        localStorage.setItem('claudeEffort', JSON.stringify(level))
        setActivePinia(createPinia())

        expect(usePersistedStore().claudeEffort, JSON.stringify(level)).toBe('')
      }
    })
  })

  describe('migration from the single selectedModel', () => {
    it('gives an OpenAI model to the OpenAI provider', () => {
      localStorage.setItem('selectedModel', JSON.stringify('gpt-4o'))
      const store = usePersistedStore()
      expect(store.selectedModels).toEqual({ openai: 'gpt-4o', anthropic: '' })
    })

    it('gives a Claude model to the Claude provider, as the alias of its kind', () => {
      localStorage.setItem('selectedModel', JSON.stringify('claude-opus-4-6'))
      const store = usePersistedStore()
      expect(store.selectedModels).toEqual({ openai: '', anthropic: 'opus' })
    })

    it('does not give an OpenAI model to Claude when Claude is the selected provider', () => {
      localStorage.setItem('selectedProvider', JSON.stringify('anthropic'))
      localStorage.setItem('selectedModel', JSON.stringify('gpt-4o'))
      const store = usePersistedStore()
      expect(store.selectedModels).toEqual({ openai: 'gpt-4o', anthropic: '' })
    })

    it('replaces the old key with the new one', () => {
      localStorage.setItem('selectedModel', JSON.stringify('gpt-4o'))
      usePersistedStore()
      expect(localStorage.getItem('selectedModel')).toBeNull()
      expect(saved('selectedModels')).toEqual({ openai: 'gpt-4o', anthropic: '' })
    })

    it('ignores the old key once the models are saved per provider', () => {
      localStorage.setItem('selectedModels', JSON.stringify({ openai: 'gpt-4o-mini', anthropic: '' }))
      localStorage.setItem('selectedModel', JSON.stringify('gpt-4o'))
      const store = usePersistedStore()
      expect(store.selectedModels).toEqual({ openai: 'gpt-4o-mini', anthropic: '' })
    })
  })

  describe('Claude models saved by their full names', () => {
    // The Claude models earlier versions offered, and the aliases the
    // Claude CLI has for the latest model of each kind
    const aliases = { 'claude-sonnet-4-6': 'sonnet', 'claude-opus-4-6': 'opus', 'claude-haiku-4-5': 'haiku' }

    it('become the alias of their kind, which Settings offers', async () => {
      const offered = await createAnthropicProvider().listModels()
      for (const [model, alias] of Object.entries(aliases)) {
        localStorage.setItem('selectedModels', JSON.stringify({ openai: 'gpt-4o', anthropic: model }))
        setActivePinia(createPinia())

        expect(usePersistedStore().selectedModels, model).toEqual({ openai: 'gpt-4o', anthropic: alias })
        expect(saved('selectedModels'), model).toEqual({ openai: 'gpt-4o', anthropic: alias })
        expect(offered).toContain(alias)
      }
    })

    it('are the only models changed', () => {
      localStorage.setItem('selectedModels', JSON.stringify({ openai: 'gpt-4o-2024-11-20', anthropic: 'opus' }))
      expect(usePersistedStore().selectedModels).toEqual({ openai: 'gpt-4o-2024-11-20', anthropic: 'opus' })
    })
  })
})
