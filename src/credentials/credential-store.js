import { invoke } from '@tauri-apps/api/core'

/**
 * Creates a credential store for provider API keys.
 *
 * Inside Tauri, keys live in the system keychain, through the commands in
 * src-tauri/src/credentials.rs, and a failure is passed on to the caller.
 * Outside of Tauri (browser dev, tests), they live in an in-memory Map.
 *
 * @returns {Object} Credential store with importOldVault, get, set and remove
 */

function isTauri() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function makeKey(providerId, key) {
  return `${providerId}:${key}`
}

function createKeychainStore() {
  return {
    // Versions before the keychain kept the OpenAI API key in a Stronghold
    // vault. This moves it into the keychain and deletes the vault.
    async importOldVault() {
      await invoke('import_old_vault')
    },

    async get(providerId, key) {
      return invoke('get_credential', { name: makeKey(providerId, key) })
    },

    async set(providerId, key, value) {
      await invoke('set_credential', { name: makeKey(providerId, key), value })
    },

    async remove(providerId, key) {
      await invoke('delete_credential', { name: makeKey(providerId, key) })
    },
  }
}

function createInMemoryStore() {
  const store = new Map()

  return {
    // There is no old vault outside of Tauri
    async importOldVault() {},

    async set(providerId, key, value) {
      store.set(makeKey(providerId, key), value)
    },

    async get(providerId, key) {
      return store.get(makeKey(providerId, key)) ?? null
    },

    async remove(providerId, key) {
      store.delete(makeKey(providerId, key))
    },

    async removeAll(providerId) {
      const prefix = `${providerId}:`
      for (const k of store.keys()) {
        if (k.startsWith(prefix)) {
          store.delete(k)
        }
      }
    },

    async has(providerId, key) {
      return store.has(makeKey(providerId, key))
    },

    async listProviders() {
      const providers = new Set()
      for (const k of store.keys()) {
        providers.add(k.split(':')[0])
      }
      return Array.from(providers)
    },
  }
}

export function createCredentialStore() {
  return isTauri() ? createKeychainStore() : createInMemoryStore()
}
