import { describe, it, expect, beforeEach, afterEach, vi, onTestFinished } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { Quasar } from 'quasar'
import GameContainer from '../../../src/components/GameContainer.vue'
import UserInput from '../../../src/components/UserInput.vue'
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

  it("saves the game's state for the open game when the player presses Save, and says so", async () => {
    vi.mocked(saveGameState).mockClear()
    useAppStore().loadedGame = '1790000000000'
    const wrapper = await showGame({ width: 800, height: 600 })
    const { game } = playGame(wrapper, { level: 2, score: 300 })
    sendFromGame(game, { type: 'ready', data: {} })
    await vi.advanceTimersByTimeAsync(100)

    await saveButton(wrapper).trigger('click')
    await vi.advanceTimersByTimeAsync(100)

    expect(saveGameState).toHaveBeenCalledExactlyOnceWith('1790000000000', { level: 2, score: 300 })
    expect(notifications()).toContain('Game saved')
    expect(saveButton(wrapper).find('.q-spinner').exists()).toBe(false)
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

  describe('a game that fails as it starts', () => {
    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    // The errors the container reported as the game failing as it started
    function startErrors(wrapper) {
      return (wrapper.emitted('startError') ?? []).map(([error]) => error)
    }

    it('reports the first error the game sends before it is ready', async () => {
      const wrapper = await showGame({ width: 800, height: 600 })
      const game = wrapper.find('iframe').element.contentWindow

      // A syntax error: the game's script does not run, and the page reports
      // the error with no stack
      sendFromGame(game, { type: 'error', data: { message: "Unexpected token ')'", stack: null } })
      sendFromGame(game, { type: 'error', data: { message: 'Another error' } })

      expect(startErrors(wrapper)).toEqual([{ message: "Unexpected token ')'", stack: '' }])
      // The player sees the error, as for any game
      await vi.advanceTimersByTimeAsync(100)
      expect(notifications()).toContain("Game error: Unexpected token ')'")
    })

    it("reports where the error is in the game's code, when the page can tell", async () => {
      const message = "Unexpected token ';'"
      // A syntax error on the code's line 2, as the page reports it from
      // Chromium
      const chromium = await showGame({ width: 800, height: 600 })
      sendFromGame(chromium.find('iframe').element.contentWindow, {
        type: 'error',
        data: { message, stack: `SyntaxError: ${message}`, line: 2, column: 16 },
      })
      expect(startErrors(chromium)).toEqual([{ message, stack: `SyntaxError: ${message}`, line: 2, column: 16 }])

      // And from WebKit, which gives no column
      const webkit = await showGame({ width: 800, height: 600 })
      sendFromGame(webkit.find('iframe').element.contentWindow, {
        type: 'error',
        data: { message, line: 2, column: null },
      })
      expect(startErrors(webkit)).toEqual([{ message, stack: '', line: 2 }])
    })

    it('reports that the error is after the end of the code, when the page says so', async () => {
      // A syntax error found after the code, which leaves a brace open, as the
      // page reports it from WebKit
      const wrapper = await showGame({ width: 800, height: 600 })
      const message = "Unexpected keyword 'catch'"
      sendFromGame(wrapper.find('iframe').element.contentWindow, { type: 'error', data: { message, afterCode: true } })

      expect(startErrors(wrapper)).toEqual([{ message, stack: '', afterCode: true }])
      // The player sees the error as before
      await vi.advanceTimersByTimeAsync(100)
      expect(notifications()).toContain(`Game error: ${message}`)
    })

    it('reports an error in the first 5 seconds after the game is ready', async () => {
      const wrapper = await showGame({ width: 800, height: 600 })
      const game = wrapper.find('iframe').element.contentWindow
      sendFromGame(game, { type: 'ready', data: {} })

      // The first enemy appears, and the game throws
      await vi.advanceTimersByTimeAsync(4999)
      const error = { message: "Can't find variable: enemies", stack: 'spawn@game.js:40:9' }
      sendFromGame(game, { type: 'error', data: error })

      expect(startErrors(wrapper)).toEqual([error])
    })

    it('does not report an error after the first 5 seconds, which the player sees as before', async () => {
      const wrapper = await showGame({ width: 800, height: 600 })
      const game = wrapper.find('iframe').element.contentWindow
      sendFromGame(game, { type: 'ready', data: {} })

      await vi.advanceTimersByTimeAsync(5000)
      sendFromGame(game, { type: 'error', data: { message: 'An error after 5 s' } })

      expect(startErrors(wrapper)).toEqual([])
      await vi.advanceTimersByTimeAsync(100)
      expect(notifications()).toContain('Game error: An error after 5 s')
    })

    it('counts only the seconds the page is visible', async () => {
      const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
      const wrapper = await showGame({ width: 800, height: 600 })
      const game = wrapper.find('iframe').element.contentWindow
      sendFromGame(game, { type: 'ready', data: {} })

      // The user is in another app for a minute, then comes back, and the
      // game runs its first frames
      hidden.mockReturnValue(true)
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(60000)
      hidden.mockReturnValue(false)
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(4000)
      sendFromGame(game, { type: 'error', data: { message: 'player is undefined', stack: '' } })

      expect(startErrors(wrapper)).toEqual([{ message: 'player is undefined', stack: '' }])
    })

    it('counts the 5 seconds from the first ready only', async () => {
      const wrapper = await showGame({ width: 800, height: 600 })
      const game = wrapper.find('iframe').element.contentWindow
      sendFromGame(game, { type: 'ready', data: {} })
      await vi.advanceTimersByTimeAsync(4000)
      // The game's code says it is ready too
      sendFromGame(game, { type: 'ready', data: {} })

      await vi.advanceTimersByTimeAsync(1000)
      sendFromGame(game, { type: 'error', data: { message: 'An error after 5 s' } })

      expect(startErrors(wrapper)).toEqual([])
    })

    // The page reports the player's first input
    describe("with a start screen, which plays from the player's first input", () => {
      it('reports an error in the first 5 seconds after the first input, however long the start screen was shown', async () => {
        const wrapper = await showGame({ width: 800, height: 600 })
        const game = wrapper.find('iframe').element.contentWindow
        sendFromGame(game, { type: 'ready', data: {} })
        await vi.advanceTimersByTimeAsync(20000)

        // The player taps, play starts, and the first enemy appears
        sendFromGame(game, { type: 'firstInput', data: {} })
        await vi.advanceTimersByTimeAsync(4999)
        const error = { message: "Can't find variable: enemies", stack: 'spawn@game.js:40:9' }
        sendFromGame(game, { type: 'error', data: error })

        expect(startErrors(wrapper)).toEqual([error])
      })

      it('does not report an error 5 seconds after the first input', async () => {
        const wrapper = await showGame({ width: 800, height: 600 })
        const game = wrapper.find('iframe').element.contentWindow
        sendFromGame(game, { type: 'ready', data: {} })
        await vi.advanceTimersByTimeAsync(20000)
        sendFromGame(game, { type: 'firstInput', data: {} })

        await vi.advanceTimersByTimeAsync(5000)
        sendFromGame(game, { type: 'error', data: { message: 'An error 5 s into play' } })

        expect(startErrors(wrapper)).toEqual([])
        await vi.advanceTimersByTimeAsync(100)
        expect(notifications()).toContain('Game error: An error 5 s into play')
      })

      it('counts the 5 seconds from the first input when it comes in the first 5 seconds after ready', async () => {
        const wrapper = await showGame({ width: 800, height: 600 })
        const game = wrapper.find('iframe').element.contentWindow
        sendFromGame(game, { type: 'ready', data: {} })
        await vi.advanceTimersByTimeAsync(2000)
        sendFromGame(game, { type: 'firstInput', data: {} })

        // 6 seconds after ready, 4 after the first input
        await vi.advanceTimersByTimeAsync(4000)
        sendFromGame(game, { type: 'error', data: { message: 'player is undefined', stack: '' } })

        expect(startErrors(wrapper)).toEqual([{ message: 'player is undefined', stack: '' }])
      })

      it('counts from the first input only', async () => {
        const wrapper = await showGame({ width: 800, height: 600 })
        const game = wrapper.find('iframe').element.contentWindow
        sendFromGame(game, { type: 'ready', data: {} })
        await vi.advanceTimersByTimeAsync(20000)
        sendFromGame(game, { type: 'firstInput', data: {} })
        await vi.advanceTimersByTimeAsync(4000)
        sendFromGame(game, { type: 'firstInput', data: {} })

        // 6 seconds after the first input
        await vi.advanceTimersByTimeAsync(2000)
        sendFromGame(game, { type: 'error', data: { message: 'An error 6 s into play' } })

        expect(startErrors(wrapper)).toEqual([])
      })

      it('reports no second error after one it reported before the first input', async () => {
        const wrapper = await showGame({ width: 800, height: 600 })
        const game = wrapper.find('iframe').element.contentWindow
        sendFromGame(game, { type: 'ready', data: {} })
        await vi.advanceTimersByTimeAsync(1000)
        sendFromGame(game, { type: 'error', data: { message: 'The start screen fails', stack: '' } })

        sendFromGame(game, { type: 'firstInput', data: {} })
        await vi.advanceTimersByTimeAsync(1000)
        sendFromGame(game, { type: 'error', data: { message: 'Play fails', stack: '' } })

        expect(startErrors(wrapper)).toEqual([{ message: 'The start screen fails', stack: '' }])
      })
    })
  })

  // The buttons below the game show its controls and its rules in a dialog,
  // which stays until the player closes it
  describe('the controls and the rules', () => {
    // The dialog shown, or null
    function dialog() {
      return document.querySelector('.q-dialog')
    }

    // A tap or a click outside the dialog, on its backdrop. The press closes
    // it (a tap sends a mousedown too).
    function tapOutside() {
      const backdrop = dialog().querySelector('.q-dialog__backdrop')
      for (const type of ['mousedown', 'mouseup', 'click']) {
        backdrop.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }))
      }
    }

    it('shows the rules until the player closes them', async () => {
      const wrapper = await showGame({ width: 800, height: 600 })

      await wrapper.find('[aria-label="Rules"]').trigger('click')
      await vi.advanceTimersByTimeAsync(100)
      expect(dialog()).not.toBeNull()
      expect(dialog().textContent).toContain('Rules')
      expect(dialog().textContent).toContain('Catch the stars')
      // A minute on, as long as it takes to read them
      await vi.advanceTimersByTimeAsync(60000)
      expect(dialog().textContent).toContain('Catch the stars')
      expect(notifications()).not.toContain('Catch the stars')

      const buttons = [...dialog().querySelectorAll('button')]
      buttons.find((button) => button.textContent.trim() === 'Close').click()
      await vi.advanceTimersByTimeAsync(1000)
      expect(dialog()).toBeNull()
    })

    it('shows the controls, and closes them at a tap outside', async () => {
      const wrapper = await showGame({ width: 800, height: 600 })

      await wrapper.find('[aria-label="Controls"]').trigger('click')
      await vi.advanceTimersByTimeAsync(100)
      expect(dialog()).not.toBeNull()
      expect(dialog().textContent).toContain('Controls')
      expect(dialog().textContent).toContain('Arrow keys')

      tapOutside()
      await vi.advanceTimersByTimeAsync(1000)
      expect(dialog()).toBeNull()
    })

    it('pauses the game while they are shown, also when the app comes back from the background', async () => {
      const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
      const wrapper = await showGame({ width: 800, height: 600 })
      const { game, received } = playGame(wrapper, { score: 0 })
      sendFromGame(game, { type: 'ready', data: {} })
      await vi.advanceTimersByTimeAsync(100)
      const pauses = () => received.map((message) => message.type).filter((type) => type === 'pause' || type === 'resume')
      expect(pauses()).toEqual([])

      await wrapper.find('[aria-label="Rules"]').trigger('click')
      await vi.advanceTimersByTimeAsync(100)
      expect(pauses()).toEqual(['pause'])

      // The user is in another app for a while, and comes back to the rules
      hidden.mockReturnValue(true)
      document.dispatchEvent(new Event('visibilitychange'))
      hidden.mockReturnValue(false)
      document.dispatchEvent(new Event('visibilitychange'))
      expect(pauses()).toEqual(['pause', 'pause'])

      tapOutside()
      await vi.advanceTimersByTimeAsync(1000)
      expect(pauses()).toEqual(['pause', 'pause', 'resume'])
    })
  })

  // Key presses reach the game only while it has the keyboard focus. A click
  // on the game gives it the focus, but not when the game's own pointerdown
  // handler calls preventDefault(), as some games do.
  describe('keyboard focus', () => {
    // The description box, in the page with the game, as in the app
    function showDescriptionBox() {
      const wrapper = mount(UserInput, {
        attachTo: document.body,
        global: { plugins: [[Quasar, { plugins: quasarPlugins }]] },
      })
      return wrapper.find('textarea').element
    }

    // The app's window gets a focus event, then the focus settles. The window
    // gets one when it gets the focus back, and when the focus moves from the
    // game to the page.
    async function windowFocusEvent() {
      window.dispatchEvent(new FocusEvent('focus'))
      await vi.advanceTimersByTimeAsync(0)
    }

    it('goes to the game when it is ready', async () => {
      const wrapper = await showGame({ width: 800, height: 600 })
      const iframe = wrapper.find('iframe').element
      expect(document.activeElement).toBe(document.body)

      sendFromGame(iframe.contentWindow, { type: 'ready', data: {} })

      expect(document.activeElement).toBe(iframe)
    })

    it('stays in the description box while the user types there', async () => {
      const box = showDescriptionBox()
      box.focus()
      const wrapper = await showGame({ width: 800, height: 600 })

      sendFromGame(wrapper.find('iframe').element.contentWindow, { type: 'ready', data: {} })
      expect(document.activeElement).toBe(box)

      await windowFocusEvent()
      expect(document.activeElement).toBe(box)
    })

    it('stays in a dialog', async () => {
      const wrapper = await showGame({ width: 800, height: 600 })
      // A dialog with no button to focus first, like Settings: the dialog
      // itself has the focus
      const dialog = wrapper.vm.$q.dialog({ title: 'Delete this game?', cancel: true, focus: 'none' })
      await vi.advanceTimersByTimeAsync(1000)
      const focused = document.activeElement
      expect(document.querySelector('.q-dialog').contains(focused)).toBe(true)
      expect(focused.tagName).toBe('DIV')

      sendFromGame(wrapper.find('iframe').element.contentWindow, { type: 'ready', data: {} })
      expect(document.activeElement).toBe(focused)

      await windowFocusEvent()
      expect(document.activeElement).toBe(focused)

      dialog.hide()
      await vi.advanceTimersByTimeAsync(1000)
    })

    it("goes to the game again when the app's window gets it back, unless a control has it", async () => {
      const wrapper = await showGame({ width: 800, height: 600 })
      const iframe = wrapper.find('iframe').element
      sendFromGame(iframe.contentWindow, { type: 'ready', data: {} })

      // No element has the focus
      iframe.blur()
      expect(document.activeElement).toBe(document.body)
      await windowFocusEvent()
      expect(document.activeElement).toBe(iframe)

      // The page's layout has it, as after a click beside the game: Quasar's
      // layout can take the focus, but not with Tab
      const layout = document.body.appendChild(document.createElement('div'))
      onTestFinished(() => layout.remove())
      layout.tabIndex = -1
      layout.focus()
      await windowFocusEvent()
      expect(document.activeElement).toBe(iframe)
    })

    it('stays where the user moves it from the game: the description box, or a button reached with Tab', async () => {
      const box = showDescriptionBox()
      const wrapper = await showGame({ width: 800, height: 600 })
      const iframe = wrapper.find('iframe').element
      sendFromGame(iframe.contentWindow, { type: 'ready', data: {} })
      const focusGame = vi.spyOn(iframe, 'focus')

      // As the focus leaves the game, the window gets a focus event, and the
      // box gets the focus after it, as in WebKit and Chromium. The game
      // makes no move to take the focus back, even during the event.
      window.dispatchEvent(new FocusEvent('focus'))
      box.focus()
      await vi.advanceTimersByTimeAsync(0)
      expect(document.activeElement).toBe(box)
      expect(focusGame).not.toHaveBeenCalled()

      iframe.focus()
      focusGame.mockClear()
      window.dispatchEvent(new FocusEvent('focus'))
      const controlsButton = wrapper.find('button').element
      controlsButton.focus()
      await vi.advanceTimersByTimeAsync(0)
      expect(document.activeElement).toBe(controlsButton)
      expect(focusGame).not.toHaveBeenCalled()
    })

    it('does not go to a game that is not ready', async () => {
      await showGame({ width: 800, height: 600 })

      await windowFocusEvent()

      expect(document.activeElement).toBe(document.body)
    })

    it('goes to the game once only, when it is first ready', async () => {
      const wrapper = await showGame({ width: 800, height: 600 })
      const game = wrapper.find('iframe').element.contentWindow
      sendFromGame(game, { type: 'ready', data: {} })
      const controlsButton = wrapper.find('button').element
      controlsButton.focus()

      // The game's code says it is ready too
      sendFromGame(game, { type: 'ready', data: {} })

      expect(document.activeElement).toBe(controlsButton)
    })

    it('goes back to the game when the player answers the restore dialog', async () => {
      useAppStore().loadedGame = '1790000000000'
      vi.mocked(loadGameState).mockResolvedValueOnce({ level: 3, score: 1200 })
      const wrapper = await showGame({ width: 800, height: 600 })
      const iframe = wrapper.find('iframe').element
      const { game } = playGame(wrapper, { level: 1, score: 0 })
      sendFromGame(game, { type: 'ready', data: {} })
      await vi.advanceTimersByTimeAsync(1000)

      // The dialog takes the focus, and keeps it when the app's window gets
      // it back
      const dialog = document.querySelector('.q-dialog')
      expect(dialog.contains(document.activeElement)).toBe(true)
      await windowFocusEvent()
      expect(dialog.contains(document.activeElement)).toBe(true)

      const buttons = [...dialog.querySelectorAll('button')]
      buttons.find((button) => button.textContent.trim() === 'Restore').click()
      await vi.advanceTimersByTimeAsync(1000)

      expect(document.activeElement).toBe(iframe)
    })

    it("stops listening for the window's focus when the game is closed", async () => {
      const removeListener = vi.spyOn(window, 'removeEventListener')
      const addListener = vi.spyOn(window, 'addEventListener')
      const wrapper = await showGame({ width: 800, height: 600 })
      const listeners = addListener.mock.calls.filter(([type]) => type === 'focus').map(([, listener]) => listener)
      expect(listeners).toHaveLength(1)

      wrapper.unmount()

      expect(removeListener).toHaveBeenCalledWith('focus', listeners[0])
    })
  })
})
