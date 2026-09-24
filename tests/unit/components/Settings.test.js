import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { Quasar, QBtnToggle, QSelect } from 'quasar'
import Settings from '../../../src/components/Settings.vue'
import { usePersistedStore } from '../../../src/stores/persisted-store.js'

const registry = { get: () => ({ listModels: async () => [] }) }

async function openSettings() {
  const wrapper = mount(Settings, {
    props: { registry, modelValue: true },
    global: { plugins: [Quasar], stubs: { ConnectClaude: true } },
  })
  await flushPromises()
  return wrapper
}

async function pickProvider(wrapper, id) {
  wrapper.findComponent(QBtnToggle).vm.$emit('update:modelValue', id)
  await flushPromises()
}

function modelSelect(wrapper) {
  return wrapper.findComponent(QSelect)
}

enableAutoUnmount(afterEach)

describe('Settings', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('sets the model only for the provider that is picked', async () => {
    const store = usePersistedStore()
    const wrapper = await openSettings()
    modelSelect(wrapper).vm.$emit('update:modelValue', 'gpt-4o')

    await pickProvider(wrapper, 'anthropic')
    expect(modelSelect(wrapper).props('modelValue')).toBe('')
    modelSelect(wrapper).vm.$emit('update:modelValue', 'claude-opus-4-6')

    expect(store.selectedModels).toEqual({ openai: 'gpt-4o', anthropic: 'claude-opus-4-6' })
  })

  it('shows the model chosen for each provider', async () => {
    const { selectedModels } = usePersistedStore()
    selectedModels.openai = 'gpt-4o'
    selectedModels.anthropic = 'claude-opus-4-6'
    const wrapper = await openSettings()
    expect(modelSelect(wrapper).props('modelValue')).toBe('gpt-4o')

    await pickProvider(wrapper, 'anthropic')
    expect(modelSelect(wrapper).props('modelValue')).toBe('claude-opus-4-6')

    await pickProvider(wrapper, 'openai')
    expect(modelSelect(wrapper).props('modelValue')).toBe('gpt-4o')
  })
})
