import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { Quasar } from 'quasar'
import GameContainer from '../../../src/components/GameContainer.vue'
import { quasarPlugins } from '../../../src/quasar-plugins.js'
import { loadGameState, saveGameState } from '../../../src/helpers/game-storage.js'
import { useAppStore } from '../../../src/stores/app-store.js'

vi.mock('../../../src/helpers/game-storage.js', () => ({
  saveGameState: vi.fn(async () => {}),
  loadGameState: vi.fn(async () => null),
}))

// happy-dom's ResizeObserver never reports, so the tests report sizes
// through this stand-in, as the browser would
const resizeObservers = new Set()
class FakeResizeObserver {
  constructor(callback) {
    this.callback = callback
  }
  observe(element) {
    this.element = element
    resizeObservers.add(this)
  }
  unobserve() {}
  disconnect() {
    resizeObservers.delete(this)
  }
}
vi.stubGlobal('ResizeObserver', FakeResizeObserver)

// The size the game's container measures. happy-dom lays nothing out, so the
// tests set it. As on the page, the container has its size before the game is
// shown: the component loads the game when it is mounted.
let containerSize

// Shows a game in a container of the given size, with the Quasar plugins the
// app installs
async function showGame(size) {
  containerSize = size
  const wrapper = mount(GameContainer, {
    props: { game: { code: '// game', controls: 'Arrow keys', rules: 'Catch the stars' } },
    attachTo: document.body,
    global: { plugins: [[Quasar, { plugins: quasarPlugins }]] },
  })
  await flushPromises()
  return wrapper
}

// Resizes the container as resizing the window does: the window reports a
// resize, and the container's resize observers report its new size
async function resizeContainer(size) {
  containerSize = size
  window.dispatchEvent(new Event('resize'))
  for (const observer of resizeObservers) {
    observer.callback([{ target: observer.element }], observer)
  }
  // Longer than any debounce of the resize
  await vi.advanceTimersByTimeAsync(1000)
}

// Plays the game in the iframe, a game that can save: asked to save, it
// answers with the given state. Returns the messages the app sends it.
function playGame(wrapper, state) {
  const game = wrapper.find('iframe').element.contentWindow
  const received = []
  vi.spyOn(game, 'postMessage').mockImplementation((message) => {
    received.push(message)
    if (message.type === 'saveState') {
      setTimeout(() => sendFromGame(game, { type: 'stateData', data: state }))
    }
  })
  return { game, received }
}

// Sends a message from the game in the iframe to the app
function sendFromGame(game, message) {
  window.dispatchEvent(new MessageEvent('message', { data: message, source: game }))
}

// The game's Save button
function saveButton(wrapper) {
  return wrapper.findAll('button').find((button) => button.find('.mdi-content-save').exists())
}

// The text of the notifications shown
function notifications() {
  return [...document.querySelectorAll('.q-notification')].map((n) => n.textContent).join()
}

enableAutoUnmount(afterEach)

describe('GameContainer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    const measure = Element.prototype.getBoundingClientRect
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (!this.classList.contains('game-canvas-wrapper')) return measure.call(this)
      return new DOMRect(0, 0, containerSize.width, containerSize.height)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('keeps the game running when the window is resized, scaled to fit', async () => {
    const wrapper = await showGame({ width: 800, height: 600 })
    const iframe = wrapper.find('iframe').element
    const page = iframe.srcdoc
    expect(page).toContain('<canvas id="game-canvas" width="800" height="600">')

    await resizeContainer({ width: 400, height: 600 })

    // The same iframe with the same page: the game was not loaded again
    expect(wrapper.findAll('iframe')).toHaveLength(1)
    expect(wrapper.find('iframe').element).toBe(iframe)
    expect(iframe.srcdoc).toBe(page)
    // Half its size, centred in the narrower container
    expect(iframe.style.transform).toBe('translate(0px, 150px) scale(0.5)')

    await resizeContainer({ width: 800, height: 600 })
    expect(wrapper.find('iframe').element).toBe(iframe)
    expect(iframe.style.transform).toBe('translate(0px, 0px) scale(1)')
  })

  it('offers to restore saved progress, and restores it when the player accepts', async () => {
    const savedState = { level: 3, score: 1200 }
    useAppStore().loadedGame = '1790000000000'
    vi.mocked(loadGameState).mockResolvedValueOnce(savedState)
    const wrapper = await showGame({ width: 800, height: 600 })
    const { game, received } = playGame(wrapper, { level: 1, score: 0 })

    // The game starts
    sendFromGame(game, { type: 'ready', data: {} })
    await vi.advanceTimersByTimeAsync(100)

    expect(loadGameState).toHaveBeenCalledWith('1790000000000')
    const dialog = document.querySelector('.q-dialog')
    expect(dialog).not.toBeNull()
    expect(dialog.textContent).toContain('Restore progress?')
    // Nothing is restored before the player answers
    expect(received.map((message) => message.type)).not.toContain('restoreState')

    // The player accepts: the game gets the saved state, and the dialog closes
    const buttons = [...dialog.querySelectorAll('button')]
    buttons.find((button) => button.textContent.trim() === 'Restore').click()
    await vi.advanceTimersByTimeAsync(1000)

    expect(received).toContainEqual({ type: 'restoreState', data: savedState })
    expect(document.querySelector('.q-dialog')).toBeNull()
  })

  it('logs a game error that repeats on every frame once, and shows it', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = await showGame({ width: 800, height: 600 })
    const game = wrapper.find('iframe').element.contentWindow

    // The game throws on each of three frames, then fails in another way
    for (let frame = 0; frame < 3; frame++) {
      sendFromGame(game, { type: 'error', data: { message: "Can't find variable: player" } })
    }
    sendFromGame(game, { type: 'error', data: { message: 'level is undefined' } })
    await vi.advanceTimersByTimeAsync(100)

    expect(logged.mock.calls).toEqual([
      ['Game error:', "Can't find variable: player"],
      ['Game error:', 'level is undefined'],
    ])
    expect(notifications()).toContain("Game error: Can't find variable: player")
    expect(notifications()).toContain('Game error: level is undefined')
  })

  it("says at once why a save failed when the game's state cannot be sent", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    useAppStore().loadedGame = '1790000000000'
    const wrapper = await showGame({ width: 800, height: 600 })
    const { game } = playGame(wrapper, { score: 0 })
    sendFromGame(game, { type: 'ready', data: {} })
    await vi.advanceTimersByTimeAsync(100)

    // The game's state now holds a function, which postMessage cannot copy:
    // the game page reports the error, and tells the app the save failed
    const reason = 'The object can not be cloned.'
    game.postMessage.mockImplementation((message) => {
      if (message.type !== 'saveState') return
      setTimeout(() => {
        sendFromGame(game, { type: 'error', data: { message: reason } })
        sendFromGame(game, { type: 'saveFailed', data: { message: reason } })
      })
    })
    await saveButton(wrapper).trigger('click')
    expect(saveButton(wrapper).find('.q-spinner').exists()).toBe(true)
    await vi.advanceTimersByTimeAsync(100)

    // Long before the 2 s the app waits for an answer
    expect(notifications()).toContain(`Save failed: ${reason}`)
    expect(saveButton(wrapper).find('.q-spinner').exists()).toBe(false)
  })

  it('says why a save failed when the state file cannot be written, or the game does not answer', async () => {
    useAppStore().loadedGame = '1790000000000'
    const wrapper = await showGame({ width: 800, height: 600 })
    const { game } = playGame(wrapper, { score: 0 })
    sendFromGame(game, { type: 'ready', data: {} })
    await vi.advanceTimersByTimeAsync(100)

    // Tauri's file system fails with a string
    vi.mocked(saveGameState).mockRejectedValueOnce('failed to open file (os error 13)')
    await saveButton(wrapper).trigger('click')
    await vi.advanceTimersByTimeAsync(100)
    expect(notifications()).toContain('Save failed: failed to open file (os error 13)')

    // The game stops answering
    game.postMessage.mockImplementation(() => {})
    await saveButton(wrapper).trigger('click')
    await vi.advanceTimersByTimeAsync(2000)
    expect(notifications()).toContain('Save failed: The game did not answer')
  })
})
