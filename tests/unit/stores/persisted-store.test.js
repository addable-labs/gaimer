import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { usePersistedStore } from '../../../src/stores/persisted-store.js'

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
      store.selectedModels.anthropic = 'claude-haiku-4-5'
      await nextTick()

      setActivePinia(createPinia())
      expect(usePersistedStore().selectedModels).toEqual({ openai: 'gpt-4o-mini', anthropic: 'claude-haiku-4-5' })
    })
  })

  describe('migration from the single selectedModel', () => {
    it('gives an OpenAI model to the OpenAI provider', () => {
      localStorage.setItem('selectedModel', JSON.stringify('gpt-4o'))
      const store = usePersistedStore()
      expect(store.selectedModels).toEqual({ openai: 'gpt-4o', anthropic: '' })
    })

    it('gives a Claude model to the Claude provider', () => {
      localStorage.setItem('selectedModel', JSON.stringify('claude-opus-4-6'))
      const store = usePersistedStore()
      expect(store.selectedModels).toEqual({ openai: '', anthropic: 'claude-opus-4-6' })
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
})
