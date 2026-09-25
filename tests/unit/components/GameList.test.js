import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { Quasar, QBtn, QCard, QDialog, QItem } from 'quasar'
import GameList from '../../../src/components/GameList.vue'
import { deleteGame } from '../../../src/helpers/game-storage.js'
import { useAppStore } from '../../../src/stores/app-store.js'

vi.mock('../../../src/helpers/game-storage.js', () => ({
  deleteGame: vi.fn(async () => {}),
}))

async function showList() {
  useAppStore().gameList = [
    { id: '200', title: 'Snake' },
    { id: '100', title: 'Pong' },
  ]
  const wrapper = mount(GameList, { global: { plugins: [Quasar] } })
  await flushPromises()
  return wrapper
}

async function pressDelete(wrapper, title) {
  const item = wrapper.findAllComponents(QItem).find((item) => item.text().includes(title))
  await item.findAllComponents(QBtn).find((btn) => btn.props('icon') === 'mdi-delete').trigger('click')
  await flushPromises()
}

// The dialog is teleported out of the list, so it is found as a component
function dialog(wrapper) {
  return wrapper.findComponent(QDialog)
}

async function pressDialogButton(wrapper, label) {
  await dialog(wrapper).findAllComponents(QBtn).find((btn) => btn.props('label') === label).trigger('click')
  await flushPromises()
}

function titles() {
  return useAppStore().gameList.map((game) => game.title)
}

enableAutoUnmount(afterEach)

describe('GameList', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('asks before deleting a game', async () => {
    const wrapper = await showList()

    await pressDelete(wrapper, 'Pong')

    expect(deleteGame).not.toHaveBeenCalled()
    expect(dialog(wrapper).props('modelValue')).toBe(true)
    expect(dialog(wrapper).findComponent(QCard).text()).toContain('"Pong" and any saved progress will be deleted.')
  })

  it('deletes the game when the user confirms', async () => {
    const wrapper = await showList()

    await pressDelete(wrapper, 'Pong')
    await pressDialogButton(wrapper, 'Delete')

    expect(deleteGame).toHaveBeenCalledExactlyOnceWith('100')
    expect(titles()).toEqual(['Snake'])
    expect(wrapper.emitted('gameDeleted')).toEqual([['100']])
    expect(dialog(wrapper).props('modelValue')).toBe(false)
  })

  it('keeps the game when the user cancels', async () => {
    const wrapper = await showList()

    await pressDelete(wrapper, 'Pong')
    await pressDialogButton(wrapper, 'Cancel')

    expect(deleteGame).not.toHaveBeenCalled()
    expect(titles()).toEqual(['Snake', 'Pong'])
    expect(wrapper.emitted('gameDeleted')).toBeUndefined()
    expect(dialog(wrapper).props('modelValue')).toBe(false)
  })
})
