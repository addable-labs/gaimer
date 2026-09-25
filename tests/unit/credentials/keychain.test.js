import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { Quasar, QBtn, QInput } from 'quasar'
import { invoke } from '@tauri-apps/api/core'
import { createCredentialStore } from '../../../src/credentials/credential-store.js'
import { usePersistedStore } from '../../../src/stores/persisted-store.js'
import Settings from '../../../src/components/Settings.vue'

// The app runs in Tauri. The Rust side of the credential store,
// src-tauri/src/credentials.rs, is faked: a Map stands in for the system
// keychain, and oldVault for the key an earlier version saved in its
// Stronghold vault. A command named in failures rejects with that error.
const rust = vi.hoisted(() => {
  window.__TAURI_INTERNALS__ = {}
  return { keychain: new Map(), oldVault: null, failures: {} }
})

const commands = {
  import_old_vault() {
    if (rust.oldVault !== null && !rust.keychain.has('openai:apiKey')) {
      rust.keychain.set('openai:apiKey', rust.oldVault)
    }
    rust.oldVault = null
  },
  get_credential: ({ name }) => rust.keychain.get(name) ?? null,
  set_credential: ({ name, value }) => { rust.keychain.set(name, value) },
  delete_credential: ({ name }) => { rust.keychain.delete(name) },
}

const registry = { get: () => ({ listModels: async () => [] }) }

// Starts the persisted store as App does when the app starts
async function start() {
  setActivePinia(createPinia())
  const store = usePersistedStore()
  await store.init()
  return store
}

async function openSettings() {
  const wrapper = mount(Settings, {
    props: { registry, modelValue: true },
    global: { plugins: [Quasar], stubs: { ConnectClaude: true } },
  })
  await flushPromises()
  return wrapper
}

// The API key field in Settings, with any message shown under it
function keyField(wrapper) {
  return wrapper.findComponent(QInput)
}

// Types a key into Settings and presses its save button
async function saveKey(wrapper, key) {
  keyField(wrapper).vm.$emit('update:modelValue', key)
  await flushPromises()
  const save = wrapper.findAllComponents(QBtn).find((btn) => btn.props('icon') === 'mdi-content-save')
  await save.trigger('click')
  await flushPromises()
}

enableAutoUnmount(afterEach)

describe('the API key in the system keychain', () => {
  beforeEach(() => {
    localStorage.clear()
    rust.keychain.clear()
    rust.oldVault = null
    rust.failures = {}
    invoke.mockClear()
    invoke.mockImplementation(async (command, args) => {
      if (rust.failures[command]) throw rust.failures[command]
      return commands[command](args)
    })
  })

  it('is loaded from the keychain when the app starts', async () => {
    rust.keychain.set('openai:apiKey', 'sk-saved')
    const store = await start()
    expect(store.apiKey).toBe('sk-saved')
    expect(store.apiKeyError).toBe('')
  })

  it('is saved in the keychain and loaded on the next start', async () => {
    await start()
    await saveKey(await openSettings(), 'sk-new')
    expect(rust.keychain.get('openai:apiKey')).toBe('sk-new')

    const store = await start()
    expect(store.apiKey).toBe('sk-new')
  })

  it('is not written back to the keychain when it is loaded', async () => {
    rust.keychain.set('openai:apiKey', 'sk-new')
    await start()
    await flushPromises()
    expect(invoke).not.toHaveBeenCalledWith('set_credential', expect.anything())
  })

  it('is moved from the vault of an earlier version into the keychain before it is loaded', async () => {
    rust.oldVault = 'sk-old'
    const store = await start()
    expect(store.apiKey).toBe('sk-old')
    expect(rust.keychain.get('openai:apiKey')).toBe('sk-old')
  })

  it('is not kept in memory when the keychain fails', async () => {
    rust.failures.set_credential = 'Platform failure: no Secret Service'
    const credentials = createCredentialStore()
    await expect(credentials.set('openai', 'apiKey', 'sk-new')).rejects.toBe('Platform failure: no Secret Service')
    expect(await credentials.get('openai', 'apiKey')).toBeNull()
  })

  describe('Settings shows why', () => {
    it('the key could not be saved, until it is saved', async () => {
      rust.failures.set_credential = 'Platform failure: no Secret Service'
      const store = await start()
      const wrapper = await openSettings()
      await saveKey(wrapper, 'sk-new')

      expect(keyField(wrapper).text()).toContain(
        'Could not save the API key in the system keychain, so it works only until gaimer quits: Platform failure: no Secret Service'
      )
      expect(store.apiKey).toBe('sk-new')

      delete rust.failures.set_credential
      await saveKey(wrapper, 'sk-newer')
      expect(keyField(wrapper).text()).not.toContain('Could not save the API key')
      expect(rust.keychain.get('openai:apiKey')).toBe('sk-newer')
    })

    it('the key could not be loaded', async () => {
      rust.failures.get_credential = "Couldn't access platform storage: locked"
      await start()
      const wrapper = await openSettings()

      expect(keyField(wrapper).text()).toContain(
        "Could not load the API key from the system keychain: Couldn't access platform storage: locked"
      )
    })

    it('the key of an earlier version could not be moved, and still loads the key', async () => {
      rust.keychain.set('openai:apiKey', 'sk-new')
      rust.failures.import_old_vault =
        'Could not delete /old/credentials.stronghold, where an earlier version saved the API key: permission denied'
      const store = await start()
      const wrapper = await openSettings()

      expect(keyField(wrapper).text()).toContain(
        'Could not delete /old/credentials.stronghold, where an earlier version saved the API key: permission denied'
      )
      expect(store.apiKey).toBe('sk-new')
    })
  })
})
