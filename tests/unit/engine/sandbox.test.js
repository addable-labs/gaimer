import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSandbox } from '../../../src/engine/sandbox.js'

// Runs the game page's harness, its first script, with a stand-in window and
// parent window, and returns them
function runHarness(page) {
  const win = new EventTarget()
  const parent = { postMessage: vi.fn() }
  const harness = page.querySelector('script').textContent
  new Function('window', 'document', 'parent', harness)(win, page, parent)
  return { win, parent }
}

describe('createSandbox', () => {
  let container
  let sandbox

  // Loads the game and returns the page it writes into the iframe, parsed
  function loadPage(gameCode) {
    sandbox = createSandbox(container)
    sandbox.loadGame(gameCode)
    const iframe = container.querySelector('iframe')
    return new DOMParser().parseFromString(iframe.srcdoc, 'text/html')
  }

  beforeEach(() => {
    container = document.createElement('div')
    container.id = 'game-container'
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (sandbox) sandbox.destroy()
    container.remove()
  })

  it('creates an iframe inside the container', () => {
    sandbox = createSandbox(container)
    const iframe = container.querySelector('iframe')
    expect(iframe).toBeTruthy()
  })

  it('sets sandbox attribute to allow-scripts only', () => {
    sandbox = createSandbox(container)
    const iframe = container.querySelector('iframe')
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts')
  })

  it('creates iframe with correct dimensions', () => {
    sandbox = createSandbox(container, { width: 800, height: 600 })
    const iframe = container.querySelector('iframe')
    expect(iframe.width).toBe('800')
    expect(iframe.height).toBe('600')
  })

  it('makes the iframe the size of the default canvas when given no size', () => {
    sandbox = createSandbox(container)
    const iframe = container.querySelector('iframe')
    expect(iframe.width).toBe('800')
    expect(iframe.height).toBe('600')
  })

  it('scaleToFit() scales the game to fit a box, centred, without reloading it', () => {
    sandbox = createSandbox(container, { width: 800, height: 600 })
    sandbox.loadGame('// game')
    const iframe = container.querySelector('iframe')
    const page = iframe.srcdoc

    // Narrower: half size, centred vertically
    sandbox.scaleToFit(400, 600)
    expect(iframe.style.transform).toBe('translate(0px, 150px) scale(0.5)')
    // Shorter: half size, centred horizontally
    sandbox.scaleToFit(1000, 300)
    expect(iframe.style.transform).toBe('translate(300px, 0px) scale(0.5)')
    // Larger: scaled up
    sandbox.scaleToFit(1600, 1500)
    expect(iframe.style.transform).toBe('translate(0px, 150px) scale(2)')
    // Wider by an odd number of pixels: its own size, at a whole pixel
    sandbox.scaleToFit(801, 600)
    expect(iframe.style.transform).toBe('translate(1px, 0px) scale(1)')

    // The iframe, the page and its canvas keep their size
    expect(iframe.width).toBe('800')
    expect(iframe.height).toBe('600')
    expect(iframe.srcdoc).toBe(page)
  })

  it('scaleToFit() does nothing after destroy()', () => {
    sandbox = createSandbox(container, { width: 800, height: 600 })
    sandbox.destroy()
    expect(() => sandbox.scaleToFit(400, 300)).not.toThrow()
    sandbox = null
  })

  it('destroy() removes the iframe', () => {
    sandbox = createSandbox(container)
    expect(container.querySelector('iframe')).toBeTruthy()
    sandbox.destroy()
    expect(container.querySelector('iframe')).toBeNull()
    sandbox = null // prevent afterEach double-destroy
  })

  it('loadGame() injects code into the iframe via srcdoc', () => {
    sandbox = createSandbox(container)
    const gameCode = 'console.log("hello")'
    sandbox.loadGame(gameCode)
    const iframe = container.querySelector('iframe')
    expect(iframe.srcdoc).toContain(gameCode)
  })

  it('loadGame() includes a canvas element in srcdoc', () => {
    sandbox = createSandbox(container)
    sandbox.loadGame('// game code')
    const iframe = container.querySelector('iframe')
    expect(iframe.srcdoc).toContain('id="game-canvas"')
  })

  it('loadGame() wraps game code in IIFE', () => {
    sandbox = createSandbox(container)
    sandbox.loadGame('let x = 1;')
    const iframe = container.querySelector('iframe')
    expect(iframe.srcdoc).toContain('(function()')
  })

  it('postMessage() sends messages to iframe', () => {
    sandbox = createSandbox(container)
    sandbox.loadGame('// game')
    const iframe = container.querySelector('iframe')
    const spy = vi.spyOn(iframe.contentWindow, 'postMessage')
    sandbox.postMessage('pause', {})
    expect(spy).toHaveBeenCalledWith({ type: 'pause', data: {} }, '*')
  })

  it('onMessage() registers a handler for messages from iframe', () => {
    sandbox = createSandbox(container)
    sandbox.loadGame('// game')
    const handler = vi.fn()
    sandbox.onMessage(handler)
    const iframe = container.querySelector('iframe')
    // Simulate a message from the iframe's contentWindow
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'ready' },
      source: iframe.contentWindow,
    }))
    expect(handler).toHaveBeenCalledWith({ type: 'ready' })
  })

  it('destroy() cleans up message listeners', () => {
    sandbox = createSandbox(container)
    const handler = vi.fn()
    sandbox.onMessage(handler)
    sandbox.destroy()
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'ready' },
      origin: 'null'
    }))
    expect(handler).not.toHaveBeenCalled()
    sandbox = null
  })

  it('multiple loadGame() calls replace previous game', () => {
    sandbox = createSandbox(container)
    sandbox.loadGame('// game 1')
    sandbox.loadGame('// game 2')
    const iframe = container.querySelector('iframe')
    expect(iframe.srcdoc).toContain('// game 2')
    expect(iframe.srcdoc).not.toContain('// game 1')
  })

  it('loadGame() puts the game code in a script of its own, after the harness', () => {
    const page = loadPage('let x = ;')
    const scripts = page.querySelectorAll('script')
    expect(scripts).toHaveLength(2)
    // The game's syntax error leaves the harness able to run and report it
    expect(scripts[0].textContent).not.toContain('let x = ;')
    expect(() => new Function(scripts[0].textContent)).not.toThrow()
    expect(scripts[1].textContent).toContain('let x = ;')
  })

  it('the game page reports errors to the parent', () => {
    const { win, parent } = runHarness(loadPage('// game'))
    const error = new Error('boom')
    win.dispatchEvent(new ErrorEvent('error', { error, message: 'Uncaught Error: boom' }))
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      { type: 'error', data: { message: 'boom', stack: error.stack } },
      '*'
    )
    // WebKit gives the sandboxed page no error object, only a message
    win.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' }))
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      { type: 'error', data: { message: 'Script error.', stack: null } },
      '*'
    )
  })

  it('the game page reports unhandled promise rejections to the parent', () => {
    const { win, parent } = runHarness(loadPage('// game'))
    const error = new Error('no level data')
    win.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: error }))
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      { type: 'error', data: { message: 'no level data', stack: error.stack } },
      '*'
    )
    win.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: 'timeout' }))
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      { type: 'error', data: { message: 'timeout', stack: undefined } },
      '*'
    )
  })

  it('loadGame() escapes </script in the game code, so it cannot end the script early', () => {
    const page = loadPage('window.tags = ["</script><p>", "</SCRIPT >"]')
    const scripts = page.querySelectorAll('script')
    expect(scripts).toHaveLength(2)
    expect(page.querySelector('p')).toBeNull()
    // The escaped code means the same as the game's
    const win = {}
    const sendMessage = vi.fn()
    new Function('window', '__gaimer_sendMessage', scripts[1].textContent)(win, sendMessage)
    expect(win.tags).toEqual(['</script><p>', '</SCRIPT >'])
    expect(sendMessage).toHaveBeenCalledWith('ready', {})
  })
})
