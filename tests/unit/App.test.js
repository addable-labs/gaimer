import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { Quasar } from 'quasar'
import App from '../../src/App.vue'
import Settings from '../../src/components/Settings.vue'
import { useAppStore } from '../../src/stores/app-store.js'
import { usePersistedStore } from '../../src/stores/persisted-store.js'

// Stand-ins for the two providers, so that no test runs the Claude CLI or calls OpenAI
const providers = vi.hoisted(() => ({}))
vi.mock('../../src/providers/openai-provider.js', () => ({
  createOpenAIProvider: () => providers.openai,
}))
vi.mock('../../src/providers/anthropic-provider.js', () => ({
  createAnthropicProvider: () => providers.anthropic,
}))

// A fresh credential store for each test, so that no API key carries over
const credentials = vi.hoisted(() => new Map())
vi.mock('../../src/credentials/credential-store.js', () => ({
  createCredentialStore: () => ({
    get: async (providerId, key) => credentials.get(`${providerId}:${key}`) ?? null,
    set: async (providerId, key, value) => { credentials.set(`${providerId}:${key}`, value) },
    remove: async (providerId, key) => { credentials.delete(`${providerId}:${key}`) },
  }),
}))

vi.mock('../../src/helpers/game-storage.js', () => ({
  initStorage: vi.fn(async () => {}),
  listGames: vi.fn(async () => []),
  saveGame: vi.fn(async () => {}),
  loadGame: vi.fn(),
}))

// Like the real providers: a failed connect() leaves the provider as it
// was, and generateGame() throws unless the provider is connected
function fakeProvider(id) {
  let connected = false
  const provider = {
    id,
    canConnect: true,
    connect: vi.fn(async () => {
      if (!provider.canConnect) return { success: false, error: 'Not logged in' }
      connected = true
      return { success: true }
    }),
    disconnect: vi.fn(async () => { connected = false }),
    isConnected: () => connected,
    generateGame: vi.fn(async function* () {
      if (!connected) throw new Error('Provider not connected')
      yield { type: 'complete', data: { title: 'Pong', code: 'draw()' } }
    }),
  }
  return provider
}

async function startApp() {
  const wrapper = mount(App, {
    global: {
      plugins: [Quasar],
      stubs: { Settings: true, GameList: true, GameContainer: true, UserInput: true },
    },
  })
  await flushPromises()
  return wrapper
}

// What Settings does when the user picks a provider
async function switchProvider(wrapper, id) {
  usePersistedStore().selectedProvider = id
  wrapper.findComponent(Settings).vm.$emit('providerChanged', id)
  await flushPromises()
}

async function generate() {
  useAppStore().gameDescription = 'A game of pong'
  await flushPromises()
}

function modelSentTo(provider) {
  return provider.generateGame.mock.lastCall[1].model
}

enableAutoUnmount(afterEach)

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    credentials.clear()
    providers.openai = fakeProvider('openai')
    providers.anthropic = fakeProvider('anthropic')
    setActivePinia(createPinia())
    // App logs every state change
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('model choice', () => {
    it('generates with the model chosen for the active provider', async () => {
      credentials.set('openai:apiKey', 'sk-test')
      localStorage.setItem('selectedProvider', JSON.stringify('anthropic'))
      const wrapper = await startApp()
      const { selectedModels } = usePersistedStore()
      selectedModels.openai = 'gpt-4o'
      selectedModels.anthropic = 'claude-opus-4-6'

      await generate()
      expect(modelSentTo(providers.anthropic)).toBe('claude-opus-4-6')

      await switchProvider(wrapper, 'openai')
      await generate()
      expect(modelSentTo(providers.openai)).toBe('gpt-4o')
    })

    it('does not send Claude a model picked for OpenAI before the update', async () => {
      // What the app saved when a user picked gpt-4o for OpenAI, then switched to Claude
      credentials.set('openai:apiKey', 'sk-test')
      localStorage.setItem('selectedProvider', JSON.stringify('anthropic'))
      localStorage.setItem('selectedModel', JSON.stringify('gpt-4o'))
      const wrapper = await startApp()

      await generate()
      expect(providers.anthropic.generateGame).toHaveBeenCalledOnce()
      expect(modelSentTo(providers.anthropic)).not.toBe('gpt-4o')

      await switchProvider(wrapper, 'openai')
      await generate()
      expect(modelSentTo(providers.openai)).toBe('gpt-4o')
    })
  })

  describe('active provider', () => {
    it('has none after switching to OpenAI with no API key', async () => {
      localStorage.setItem('selectedProvider', JSON.stringify('anthropic'))
      const wrapper = await startApp()

      await switchProvider(wrapper, 'openai')
      await generate()

      expect(wrapper.text()).toContain('No AI provider connected. Open Settings to connect.')
    })

    it('has none when the selected provider fails to connect again', async () => {
      localStorage.setItem('selectedProvider', JSON.stringify('anthropic'))
      const wrapper = await startApp()

      // Settings asks for Claude to be connected again, as it does after the
      // sign-in check in its Claude panel, but Claude is now signed out
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      providers.anthropic.canConnect = false
      wrapper.findComponent(Settings).vm.$emit('providerChanged', 'anthropic')
      await flushPromises()
      await generate()

      expect(wrapper.text()).toContain('No AI provider connected. Open Settings to connect.')
      expect(providers.anthropic.generateGame).not.toHaveBeenCalled()
    })

    it('stays OpenAI when Claude fails to connect after the user switched back', async () => {
      credentials.set('openai:apiKey', 'sk-test')
      const wrapper = await startApp()

      // Claude's sign-in check is still running when the user switches back
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      let finishClaudeConnect
      providers.anthropic.connect.mockImplementationOnce(
        () => new Promise((resolve) => { finishClaudeConnect = resolve })
      )
      await switchProvider(wrapper, 'anthropic')
      await switchProvider(wrapper, 'openai')
      finishClaudeConnect({ success: false, error: 'Not logged in' })
      await flushPromises()
      await generate()

      expect(providers.openai.generateGame).toHaveBeenCalledOnce()
    })
  })
})
