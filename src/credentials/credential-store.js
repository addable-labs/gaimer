/**
 * Creates a credential store for securely managing provider API keys.
 *
 * When running inside Tauri, uses tauri-plugin-stronghold for encrypted
 * on-device storage. Falls back to an in-memory Map outside of Tauri
 * (browser dev, tests).
 *
 * @returns {Object} Credential store with get, set, remove, removeAll, has, listProviders
 */

const STRONGHOLD_VAULT = 'credentials'
const STRONGHOLD_PASSWORD = 'gaimer-credentials-vault'
const STRONGHOLD_FILE = 'credentials.stronghold'

function isTauri() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

let strongholdInstance = null

async function getStronghold() {
  if (strongholdInstance) return strongholdInstance
  const { Stronghold } = await import('@tauri-apps/plugin-stronghold')
  const { appDataDir, join } = await import('@tauri-apps/api/path')
  const dataDir = await appDataDir()
  const path = await join(dataDir, STRONGHOLD_FILE)
  strongholdInstance = await Stronghold.load(path, STRONGHOLD_PASSWORD)
  return strongholdInstance
}

function makeKey(providerId, key) {
  return `${providerId}:${key}`
}

function createStrongholdStore() {
  async function getClient() {
    const stronghold = await getStronghold()
    try {
      return stronghold.loadClient(STRONGHOLD_VAULT)
    } catch {
      return stronghold.createClient(STRONGHOLD_VAULT)
    }
  }

  return {
    async set(providerId, key, value) {
      const client = await getClient()
      const store = client.getStore()
      await store.insert(makeKey(providerId, key), Array.from(new TextEncoder().encode(value)))
      const stronghold = await getStronghold()
      await stronghold.save()
    },

    async get(providerId, key) {
      const client = await getClient()
      const store = client.getStore()
      try {
        const data = await store.get(makeKey(providerId, key))
        if (!data || data.length === 0) return null
        return new TextDecoder().decode(new Uint8Array(data))
      } catch {
        return null
      }
    },

    async remove(providerId, key) {
      const client = await getClient()
      const store = client.getStore()
      try {
        await store.remove(makeKey(providerId, key))
        const stronghold = await getStronghold()
        await stronghold.save()
      } catch {
        // key didn't exist
      }
    },

    async removeAll(providerId) {
      // Stronghold doesn't support key enumeration, so we track providers
      // via a metadata key that lists all stored keys per provider
      const client = await getClient()
      const store = client.getStore()
      const indexKey = `__index:${providerId}`
      try {
        const data = await store.get(indexKey)
        if (data && data.length > 0) {
          const keys = JSON.parse(new TextDecoder().decode(new Uint8Array(data)))
          for (const k of keys) {
            try { await store.remove(makeKey(providerId, k)) } catch { /* ignore */ }
          }
          await store.remove(indexKey)
        }
      } catch {
        // no index
      }
      const stronghold = await getStronghold()
      await stronghold.save()
    },

    async has(providerId, key) {
      const value = await this.get(providerId, key)
      return value !== null
    },

    async listProviders() {
      const client = await getClient()
      const store = client.getStore()
      try {
        const data = await store.get('__providers')
        if (!data || data.length === 0) return []
        return JSON.parse(new TextDecoder().decode(new Uint8Array(data)))
      } catch {
        return []
      }
    },
  }
}

function createInMemoryStore() {
  const store = new Map()

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

export function createCredentialStore() {
  if (isTauri()) {
    return createStrongholdStore()
  }
  return createInMemoryStore()
}
