import { describe, it, expect, beforeEach, afterEach, vi, onTestFinished } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { Quasar, QBtn, QCard, QDialog, QItem } from 'quasar'
import GameList from '../../../src/components/GameList.vue'
import GameInfoDialog from '../../../src/components/GameInfoDialog.vue'
import { deleteGame } from '../../../src/helpers/game-storage.js'
import { useAppStore } from '../../../src/stores/app-store.js'

vi.mock('../../../src/helpers/game-storage.js', () => ({
  deleteGame: vi.fn(async () => {}),
}))

async function showList() {
  useAppStore().gameList = [
    { id: '200', title: 'Snake', rules: 'Eat the apples', controls: 'Arrow keys' },
    { id: '100', title: 'Pong', rules: 'Hit the ball back', controls: 'W and S' },
  ]
  const wrapper = mount(GameList, { global: { plugins: [Quasar] } })
  await flushPromises()
  return wrapper
}

// The button with the given icon next to a game in the list
function gameButton(wrapper, title, icon) {
  const item = wrapper.findAllComponents(QItem).find((item) => item.text().includes(title))
  return item.findAllComponents(QBtn).find((btn) => btn.props('icon') === icon)
}

async function pressDelete(wrapper, title) {
  await gameButton(wrapper, title, 'mdi-delete').trigger('click')
  await flushPromises()
}

// The dialog that asks before deleting a game, not the one that shows a
// game's rules or controls. Dialogs are teleported out of the list, so it is
// found as a component.
function dialog(wrapper) {
  const infoDialogs = wrapper.findAllComponents(GameInfoDialog).map((info) => info.findComponent(QDialog).vm)
  return wrapper.findAllComponents(QDialog).find((dialog) => !infoDialogs.includes(dialog.vm))
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

  it('opens the game the user clicks', async () => {
    const wrapper = await showList()

    await wrapper.findAllComponents(QItem).find((item) => item.text().includes('Pong')).trigger('click')

    expect(wrapper.emitted('loadGame')).toEqual([['100']])
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

  // The info and gamepad buttons next to a game show its rules and its
  // controls in the dialog the buttons below a game show them in. The list
  // is in the drawer, which a click in it closes: their click goes no
  // further than the button.
  describe("a game's rules and controls", () => {
    // The title and the text of the dialog shown, or null
    function shownInfo() {
      const dialog = document.querySelector('.q-dialog')
      return dialog && {
        title: dialog.querySelector('.text-h6').textContent,
        text: dialog.querySelector('.game-info-text').textContent,
      }
    }

    // Presses a button next to a game, and returns the clicks that went on
    // to the list's element or beyond it
    async function pressInfoButton(wrapper, title, icon) {
      const clicksBeyond = vi.fn()
      wrapper.element.parentElement.addEventListener('click', clicksBeyond)
      await gameButton(wrapper, title, icon).trigger('click')
      await flushPromises()
      return clicksBeyond
    }

    it('shows the rules of a game without opening it', async () => {
      const wrapper = await showList()

      const clicksBeyond = await pressInfoButton(wrapper, 'Pong', 'mdi-information')

      expect({
        shown: shownInfo(),
        opened: wrapper.emitted('loadGame'),
        clicksBeyond: clicksBeyond.mock.calls.length,
      }).toEqual({
        shown: { title: 'Rules', text: 'Hit the ball back' },
        opened: undefined,
        clicksBeyond: 0,
      })

      const close = [...document.querySelectorAll('.q-dialog button')].find((button) => button.textContent.trim() === 'Close')
      close.click()
      await flushPromises()
      expect(wrapper.findComponent(GameInfoDialog).props('modelValue')).toBe(false)
      expect(wrapper.emitted('loadGame')).toBeUndefined()
    })

    it('shows the controls of a game without opening it', async () => {
      const wrapper = await showList()

      const clicksBeyond = await pressInfoButton(wrapper, 'Snake', 'mdi-gamepad-outline')

      expect({
        shown: shownInfo(),
        opened: wrapper.emitted('loadGame'),
        clicksBeyond: clicksBeyond.mock.calls.length,
      }).toEqual({
        shown: { title: 'Controls', text: 'Arrow keys' },
        opened: undefined,
        clicksBeyond: 0,
      })
    })

    it('still shows them in a tooltip while the mouse is over the button', async () => {
      vi.useFakeTimers()
      onTestFinished(() => vi.useRealTimers())
      const wrapper = await showList()

      const tooltips = {}
      for (const icon of ['mdi-information', 'mdi-gamepad-outline']) {
        const button = gameButton(wrapper, 'Pong', icon).element
        button.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }))
        await vi.advanceTimersByTimeAsync(1000)
        tooltips[icon] = document.querySelector('.q-tooltip')?.textContent.trim()
        button.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }))
        await vi.advanceTimersByTimeAsync(1000)
      }

      expect(tooltips).toEqual({ 'mdi-information': 'Hit the ball back', 'mdi-gamepad-outline': 'W and S' })
      expect(shownInfo()).toBeNull()
    })
  })
})
