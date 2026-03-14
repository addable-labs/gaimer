import { describe, it, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import IndexedDBClient from '../../../src/helpers/indexeddb.js'

describe('IndexedDBClient', () => {
  let client

  beforeEach(async () => {
    // Reset fake-indexeddb to get a clean database for each test
    globalThis.indexedDB = new IDBFactory()
    client = IndexedDBClient()
    await client.initDB()
  })

  describe('initDB', () => {
    it('initializes the database without error', async () => {
      globalThis.indexedDB = new IDBFactory()
      const freshClient = IndexedDBClient()
      await expect(freshClient.initDB()).resolves.toBeUndefined()
    })
  })

  describe('addItem', () => {
    it('stores an item with an inline key', async () => {
      const item = { id: '1', content: JSON.stringify({ title: 'Test Game' }) }
      await expect(client.addItem(item)).resolves.toBeUndefined()
    })

    it('rejects duplicate keys', async () => {
      const item = { id: 'dup', content: 'data' }
      await client.addItem(item)
      await expect(client.addItem(item)).rejects.toThrow()
    })
  })

  describe('getItem', () => {
    it('retrieves a stored item by key', async () => {
      const item = { id: 'get-1', content: JSON.stringify({ title: 'Pong' }) }
      await client.addItem(item)
      const result = await client.getItem('get-1')
      expect(result).toEqual(item)
    })

    it('returns undefined for non-existent key', async () => {
      const result = await client.getItem('nonexistent')
      expect(result).toBeUndefined()
    })
  })

  describe('putItem', () => {
    it('updates an existing item', async () => {
      const item = { id: 'put-1', content: 'original' }
      await client.addItem(item)
      const updated = { id: 'put-1', content: 'updated' }
      await client.putItem(updated)
      const result = await client.getItem('put-1')
      expect(result.content).toBe('updated')
    })

    it('inserts if item does not exist', async () => {
      const item = { id: 'put-new', content: 'new item' }
      await client.putItem(item)
      const result = await client.getItem('put-new')
      expect(result).toEqual(item)
    })
  })

  describe('listItems', () => {
    it('returns all stored items', async () => {
      await client.addItem({ id: 'list-1', content: 'a' })
      await client.addItem({ id: 'list-2', content: 'b' })
      await client.addItem({ id: 'list-3', content: 'c' })
      const items = await client.listItems()
      expect(items).toHaveLength(3)
    })

    it('returns empty array when no items', async () => {
      const items = await client.listItems()
      expect(items).toEqual([])
    })
  })

  describe('deleteItem', () => {
    it('removes an item by key', async () => {
      await client.addItem({ id: 'del-1', content: 'data' })
      await client.deleteItem('del-1')
      const result = await client.getItem('del-1')
      expect(result).toBeUndefined()
    })

    it('does not error when deleting non-existent key', async () => {
      await expect(client.deleteItem('nonexistent')).resolves.toBeUndefined()
    })
  })

  describe('error handling', () => {
    it('rejects operations when db is not initialized', async () => {
      const uninitClient = IndexedDBClient()
      await expect(uninitClient.addItem({ id: '1' })).rejects.toThrow('Database is not initialized')
      await expect(uninitClient.getItem('1')).rejects.toThrow('Database is not initialized')
      await expect(uninitClient.putItem({ id: '1' })).rejects.toThrow('Database is not initialized')
      await expect(uninitClient.listItems()).rejects.toThrow('Database is not initialized')
      await expect(uninitClient.deleteItem('1')).rejects.toThrow('Database is not initialized')
    })
  })
})
