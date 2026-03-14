import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAppStore } from '../../../src/stores/app-store.js'

describe('app-store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('has empty initial state', () => {
    const store = useAppStore()
    expect(store.gameDescription).toBe('')
    expect(store.loadedGame).toBeNull()
    expect(store.gameList).toEqual([])
  })

  it('updates gameDescription reactively', () => {
    const store = useAppStore()
    store.gameDescription = 'A space shooter game'
    expect(store.gameDescription).toBe('A space shooter game')
  })

  it('updates loadedGame', () => {
    const store = useAppStore()
    store.loadedGame = '1234567890'
    expect(store.loadedGame).toBe('1234567890')
  })

  it('manages gameList', () => {
    const store = useAppStore()
    const game = { id: '1', title: 'Pong', description: 'Classic pong', controls: 'arrows', rules: 'hit ball' }
    store.gameList.push(game)
    expect(store.gameList).toHaveLength(1)
    expect(store.gameList[0].title).toBe('Pong')
  })

  it('filters gameList on delete', () => {
    const store = useAppStore()
    store.gameList.push({ id: '1', title: 'Game A' })
    store.gameList.push({ id: '2', title: 'Game B' })
    store.gameList = store.gameList.filter(g => g.id !== '1')
    expect(store.gameList).toHaveLength(1)
    expect(store.gameList[0].id).toBe('2')
  })
})
