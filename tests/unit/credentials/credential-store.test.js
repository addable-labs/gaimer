import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createCredentialStore } from '../../../src/credentials/credential-store.js'

describe('CredentialStore', () => {
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
      await store.set('firebase', 'apiKey', 'key-123')
      await store.set('firebase', 'projectId', 'my-project')
      expect(await store.get('firebase', 'apiKey')).toBe('key-123')
      expect(await store.get('firebase', 'projectId')).toBe('my-project')
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
