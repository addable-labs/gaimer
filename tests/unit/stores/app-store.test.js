import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAppStore } from '../../../src/stores/app-store.js'

// The store only holds state. The code that changes it is tested where it
// is: UserInput sends the description, App opens and adds games, and
// GameList deletes them.
describe('app-store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('has empty initial state', () => {
    const store = useAppStore()
    expect(store.gameDescription).toBe('')
    expect(store.loadedGame).toBeNull()
    expect(store.gameList).toEqual([])
    expect(store.generating).toBe(false)
  })
})
