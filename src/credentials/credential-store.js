/**
 * Creates a credential store for securely managing provider API keys.
 *
 * Uses an in-memory Map as the storage backend. In production with Tauri,
 * this should be replaced with tauri-plugin-stronghold for encrypted
 * on-device storage. The interface remains the same regardless of backend.
 *
 * @returns {Object} Credential store with get, set, remove, removeAll, has, listProviders
 */
export function createCredentialStore() {
  // In-memory storage — keys are "providerId:key"
  const store = new Map()

  function makeKey(providerId, key) {
    return `${providerId}:${key}`
  }

  return {
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
