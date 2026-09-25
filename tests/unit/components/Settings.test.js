import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { Quasar, QBtnToggle, QSelect } from 'quasar'
import Settings from '../../../src/components/Settings.vue'
import { usePersistedStore } from '../../../src/stores/persisted-store.js'
import { createOpenAIProvider } from '../../../src/providers/openai-provider.js'
import { createAnthropicProvider } from '../../../src/providers/anthropic-provider.js'

const registry = { get: () => ({ listModels: async () => [] }) }

async function connectClaude() {
  return { success: true }
}

// Opens Settings the way App does: it is mounted closed, then shown
async function openSettings(providers = registry) {
  const wrapper = mount(Settings, {
    props: { registry: providers, connectClaude, modelValue: false },
    global: { plugins: [Quasar], stubs: { ConnectClaude: true } },
  })
  await wrapper.setProps({ modelValue: true })
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

// The value the Model select shows
function shownModel(wrapper) {
  return modelSelect(wrapper).find('.q-select__selected-value').text()
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

  it('shows the model each provider uses while none is chosen', async () => {
    const providers = { get: (id) => (id === 'openai' ? createOpenAIProvider() : createAnthropicProvider()) }
    const wrapper = await openSettings(providers)
    expect(shownModel(wrapper)).toBe('gpt-4o (default)')

    await pickProvider(wrapper, 'anthropic')
    expect(shownModel(wrapper)).toBe('sonnet (default)')

    // A model the user picks shows as it is
    modelSelect(wrapper).vm.$emit('update:modelValue', 'opus')
    await flushPromises()
    expect(shownModel(wrapper)).toBe('opus')
  })

  it('saves no model while it shows the default, so a later default applies', async () => {
    const providersWithDefault = (defaultModel) => ({ get: () => ({ defaultModel, listModels: async () => [] }) })
    await openSettings(providersWithDefault('gpt-4o'))

    // The app starts again, in a version with another default
    setActivePinia(createPinia())
    expect(usePersistedStore().selectedModels).toEqual({ openai: '', anthropic: '' })
    const wrapper = await openSettings(providersWithDefault('gpt-5.5'))
    expect(shownModel(wrapper)).toBe('gpt-5.5 (default)')
  })

  it('offers each provider only its own models when a list arrives after the user switched', async () => {
    // OpenAI's list is still on its way when the user picks Claude
    let sendOpenAIModels
    const providers = {
      get: (id) => ({
        listModels: id === 'openai'
          ? () => new Promise((resolve) => { sendOpenAIModels = () => resolve(['gpt-4o']) })
          : async () => ['sonnet', 'opus'],
      }),
    }
    const wrapper = await openSettings(providers)
    await pickProvider(wrapper, 'anthropic')
    sendOpenAIModels()
    await flushPromises()

    expect(modelSelect(wrapper).props('options')).toEqual(['sonnet', 'opus'])

    await pickProvider(wrapper, 'openai')
    expect(modelSelect(wrapper).props('options')).toEqual(['gpt-4o'])
  })

  it('offers the GPT-5 models and keeps the one picked after a restart', async () => {
    const providers = { get: (id) => (id === 'openai' ? createOpenAIProvider() : registry.get(id)) }
    const wrapper = await openSettings(providers)
    expect(modelSelect(wrapper).props('options')).toEqual(expect.arrayContaining([
      'gpt-4o', 'gpt-5.1', 'gpt-5.2', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano',
      'gpt-5.5', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
    ]))

    modelSelect(wrapper).vm.$emit('update:modelValue', 'gpt-5.6-sol')
    await flushPromises()

    // The app starts again with what it saved
    setActivePinia(createPinia())
    expect(usePersistedStore().selectedModels.openai).toBe('gpt-5.6-sol')
    expect(modelSelect(await openSettings(providers)).props('modelValue')).toBe('gpt-5.6-sol')
  })
})
