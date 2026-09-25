import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { createCredentialStore } from '../../../src/credentials/credential-store.js'

// The system keychain behind the commands in src-tauri/src/credentials.rs,
// faked with a Map
const keychain = new Map()
const commands = {
  get_credential: ({ name }) => keychain.get(name) ?? null,
  set_credential: ({ name, value }) => { keychain.set(name, value) },
  delete_credential: ({ name }) => { keychain.delete(name) },
}

describe('CredentialStore in Tauri, which keeps credentials in the system keychain', () => {
  let store

  beforeEach(() => {
    window.__TAURI_INTERNALS__ = {}
    keychain.clear()
    invoke.mockImplementation(async (command, args) => commands[command](args))
    store = createCredentialStore()
  })

  afterEach(() => {
    delete window.__TAURI_INTERNALS__
    invoke.mockReset()
  })

  it('saves a credential in the keychain, named by provider and key, and reads it back', async () => {
    await store.set('openai', 'apiKey', 'sk-test-123')
    expect(keychain.get('openai:apiKey')).toBe('sk-test-123')
    expect(await store.get('openai', 'apiKey')).toBe('sk-test-123')
  })

  it('returns null for a credential the keychain does not hold', async () => {
    expect(await store.get('openai', 'apiKey')).toBeNull()
  })

  it('deletes a credential from the keychain', async () => {
    keychain.set('openai:apiKey', 'sk-test')
    await store.remove('openai', 'apiKey')
    expect(keychain.has('openai:apiKey')).toBe(false)
    expect(await store.get('openai', 'apiKey')).toBeNull()
  })
})

describe('CredentialStore outside of Tauri, which keeps credentials in memory', () => {
  let store

  beforeEach(() => {
    store = createCredentialStore()
  })

  describe('set / get', () => {
    it('stores and retrieves a credential', async () => {
      await store.set('openai', 'apiKey', 'sk-test-123')
      const value = await store.get('openai', 'apiKey')
      expect(value).toBe('sk-test-123')
    })

    it('returns null for non-existent credential', async () => {
      const value = await store.get('openai', 'apiKey')
      expect(value).toBeNull()
    })

    it('stores credentials under different providers separately', async () => {
      await store.set('openai', 'apiKey', 'sk-openai')
      await store.set('anthropic', 'apiKey', 'sk-anthropic')
      expect(await store.get('openai', 'apiKey')).toBe('sk-openai')
      expect(await store.get('anthropic', 'apiKey')).toBe('sk-anthropic')
    })

    it('stores multiple keys per provider', async () => {
      await store.set('openai', 'apiKey', 'sk-openai')
      await store.set('openai', 'organization', 'org-123')
      expect(await store.get('openai', 'apiKey')).toBe('sk-openai')
      expect(await store.get('openai', 'organization')).toBe('org-123')
    })
  })

  describe('remove', () => {
    it('removes a specific credential', async () => {
      await store.set('openai', 'apiKey', 'sk-test')
      await store.remove('openai', 'apiKey')
      expect(await store.get('openai', 'apiKey')).toBeNull()
    })

    it('does not error when removing non-existent credential', async () => {
      await expect(store.remove('openai', 'apiKey')).resolves.not.toThrow()
    })
  })
})
