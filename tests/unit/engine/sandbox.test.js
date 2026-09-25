import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createSandbox } from '../../../src/engine/sandbox.js'
import { gameScript, harnessScript, parsePage } from '../../game-page.js'
import tauriConfig from '../../../src-tauri/tauri.conf.json'

// Runs the game page's harness, its first script, with a stand-in window and
// parent window, and returns them with the messages the parent received. As
// in a browser, the parent receives a copy of each message, and postMessage
// throws on a message it cannot copy. With game: true, the game's script
// runs after the harness, in the same scope, as in the page.
function runHarness(srcdoc, { game = false } = {}) {
  const page = parsePage(srcdoc)
  Object.defineProperty(page, 'currentScript', { value: page.querySelector('script') })
  const win = new EventTarget()
  const received = []
  const parent = { postMessage: vi.fn((message) => received.push(structuredClone(message))) }
  const scripts = game ? [harnessScript(srcdoc), gameScript(srcdoc)] : [harnessScript(srcdoc)]
  new Function('window', 'document', 'parent', scripts.join('\n'))(win, page, parent)
  return { win, parent, received }
}

// Runs the game's script with a stand-in window and harness, and returns the
// window and what the script sent. An error thrown while the game starts
// fails the test.
function runGame(srcdoc) {
  const win = {}
  const sendMessage = vi.fn()
  const reportError = (error) => {
    throw error
  }
  new Function('window', '__gaimer_sendMessage', '__gaimer_reportError', gameScript(srcdoc))(
    win,
    sendMessage,
    reportError
  )
  return { win, sendMessage }
}

// The sources a Content Security Policy gives one of its directives
function sources(policy, directive) {
  const found = policy
    .split(';')
    .map((part) => part.trim().split(/\s+/))
    .find(([name]) => name === directive)
  return found ? found.slice(1) : []
}

describe('createSandbox', () => {
  let container
  let sandbox

  // Loads the game and returns the page it writes into the iframe
  function loadSrcdoc(gameCode) {
    sandbox = createSandbox(container)
    sandbox.loadGame(gameCode)
    return container.querySelector('iframe').srcdoc
  }

  // Loads the game and returns the page it writes into the iframe, parsed
  function loadPage(gameCode) {
    return parsePage(loadSrcdoc(gameCode))
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
    expect(gameScript(iframe.srcdoc)).toContain(gameCode)
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
    expect(gameScript(iframe.srcdoc)).toContain('(function()')
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
    expect(gameScript(iframe.srcdoc)).toContain('// game 2')
    expect(gameScript(iframe.srcdoc)).not.toContain('// game 1')
  })

  it('loadGame() puts the game code in a script of its own, after the harness', () => {
    const srcdoc = loadSrcdoc('let x = ;')
    const scripts = parsePage(srcdoc).querySelectorAll('script')
    expect(scripts).toHaveLength(2)
    // The game's syntax error leaves the harness able to run and report it
    expect(harnessScript(srcdoc)).not.toContain('let x = ;')
    expect(() => new Function(harnessScript(srcdoc))).not.toThrow()
    expect(gameScript(srcdoc)).toContain('let x = ;')
  })

  it('the game page has no inline script: it loads the harness and then the game script from data: URLs', () => {
    // In the built app, Tauri adds the hash of each of the app's script files
    // to the script-src it sends. A hash voids 'unsafe-inline', and the game
    // page, which takes a copy of that policy, could run no inline script.
    const srcdoc = loadSrcdoc('// game')
    const scripts = [...parsePage(srcdoc).querySelectorAll('script')]
    // Each has a src and no text. With no async or defer, the harness runs
    // before the game script.
    expect(scripts.map((script) => script.getAttributeNames())).toEqual([['src'], ['src']])
    expect(scripts.map((script) => script.textContent)).toEqual(['', ''])
    // Each src is a data: URL, of the harness and then of the game script
    expect(harnessScript(srcdoc)).toContain('function __gaimer_reportError(')
    expect(gameScript(srcdoc)).toContain('// game')
  })

  it('loadGame() loads the game script from a data: URL, which holds the game code as written', () => {
    const gameCode = 'window.title = "Café 🎮"; window.tag = "<b>"'
    const srcdoc = loadSrcdoc(gameCode)
    const script = parsePage(srcdoc).querySelectorAll('script')[1]
    expect(script.getAttribute('src')).toEqual(
      expect.stringMatching(/^data:text\/javascript;charset=utf-8;base64,[A-Za-z0-9+/]+=*$/)
    )
    expect(script.textContent).toBe('')
    // The page's HTML does not hold the game code
    expect(srcdoc).not.toContain('Café')
    expect(gameScript(srcdoc)).toContain(gameCode)
    const { win, sendMessage } = runGame(srcdoc)
    expect(win).toEqual({ title: 'Café 🎮', tag: '<b>' })
    expect(sendMessage).toHaveBeenCalledWith('ready', {})
  })

  it("the game page's policy lets it load scripts from data: URLs, and allows nothing else new", () => {
    const policy = loadPage('// game')
      .querySelector('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content')
    expect(policy).toBe(
      "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline'; img-src blob: data:;"
    )
  })

  it("the window's policy, which the game page inherits, lets the page run its scripts", () => {
    // A page set through srcdoc takes a copy of its parent's policy, and each
    // of its scripts must pass both policies. Tauri sends the window's policy
    // with the built app's pages, with hashes added to script-src: there
    // 'unsafe-inline' does not count for scripts, but data: does.
    const windowPolicy = tauriConfig.app.security.csp
    expect(sources(windowPolicy, 'script-src')).toContain('data:')
  })

  it("the window page has no style element, so the game page's style applies in the built app", () => {
    // Tauri gives each style element of the window page a nonce, and adds the
    // nonce to the style-src it sends. A nonce voids 'unsafe-inline', and the
    // game page, which takes a copy of that policy, has no nonce: its style
    // element would not apply.
    const windowPage = new DOMParser().parseFromString(
      readFileSync(resolve(__dirname, '../../../index.html'), 'utf-8'),
      'text/html'
    )
    expect(windowPage.querySelectorAll('style')).toHaveLength(0)
    expect(sources(tauriConfig.app.security.csp, 'style-src')).toContain("'unsafe-inline'")
  })

  it('"<!--" and "<script" in the game code stay out of the page\'s HTML, so they cannot hide the end of its script', () => {
    // In an inline script, "<!--" and then "<script" make the HTML parser read
    // past the script's end tag, and the script never runs. happy-dom's parser
    // does not do this, so the test reads the page's HTML.
    const srcdoc = loadSrcdoc('window.tag = "<!--<script>"')
    expect(srcdoc).not.toContain('<!--')
    expect(srcdoc.match(/<script/gi)).toHaveLength(2)
    const { win, sendMessage } = runGame(srcdoc)
    expect(win.tag).toBe('<!--<script>')
    expect(sendMessage).toHaveBeenCalledWith('ready', {})
  })

  it('the game page reports errors to the parent', () => {
    const { win, parent } = runHarness(loadSrcdoc('// game'))
    const error = new Error('boom')
    win.dispatchEvent(new ErrorEvent('error', { error, message: 'Uncaught Error: boom' }))
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      { type: 'error', data: { message: 'boom', stack: error.stack } },
      '*'
    )
    // An error event can carry only a message, as WebKit's "Script error."
    // for an error in an inline script does
    win.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' }))
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      { type: 'error', data: { message: 'Script error.', stack: null } },
      '*'
    )
  })

  it('the game page calls the harness harness.js and the game script game.js in the stack traces it reports', () => {
    const srcdoc = loadSrcdoc('// game')
    const { win, parent } = runHarness(srcdoc)
    const [harness, game] = [...parsePage(srcdoc).querySelectorAll('script')].map((script) => script.getAttribute('src'))
    // The game throws on a message the harness passes it. As Chromium writes
    // the stack trace:
    const error = {
      message: 'boom',
      stack: `Error: boom\n    at tick (${game}:3:19)\n    at window.__gaimer_onMessage (${game}:9:3)\n    at ${harness}:11:14`
    }
    win.dispatchEvent(new ErrorEvent('error', { error, message: 'Uncaught Error: boom' }))
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      {
        type: 'error',
        data: {
          message: 'boom',
          stack: 'Error: boom\n    at tick (game.js:3:19)\n    at window.__gaimer_onMessage (game.js:9:3)\n    at harness.js:11:14'
        }
      },
      '*'
    )
    // As WebKit writes it
    error.stack = `tick@${game}:3:19\n@${game}:9:3\n@${harness}:11:14`
    win.dispatchEvent(new ErrorEvent('error', { error, message: 'Error: boom' }))
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      { type: 'error', data: { message: 'boom', stack: 'tick@game.js:3:19\n@game.js:9:3\n@harness.js:11:14' } },
      '*'
    )
  })

  it('the game page reports unhandled promise rejections to the parent', () => {
    const { win, parent } = runHarness(loadSrcdoc('// game'))
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

  it("the game page tells the parent at once that a save failed, and why, when postMessage cannot copy the game's state", () => {
    // The game answers saveState with state that holds a function
    const { win, received } = runHarness(
      loadSrcdoc(`window.__gaimer_onMessage = function (msg) {
  if (msg.type === 'saveState') {
    __gaimer_sendMessage('stateData', { score: 42, update: function () {} });
    window.answered = true;
  }
};`),
      { game: true }
    )
    expect(received).toEqual([{ type: 'ready', data: {} }])

    win.dispatchEvent(new MessageEvent('message', { data: { type: 'saveState', data: {} } }))

    // The error does not stop the game's code. The parent gets it as a game
    // error, and as the answer to saveState.
    expect(win.answered).toBe(true)
    const message = 'function () {} could not be cloned.'
    expect(received.slice(1)).toEqual([
      { type: 'error', data: { message, stack: expect.stringContaining(message) } },
      { type: 'saveFailed', data: { message } }
    ])
  })

  it('the game page does not report an error report it cannot send, which could loop', () => {
    const { win, parent } = runHarness(loadSrcdoc('// game'))
    // No message can reach the parent
    parent.postMessage.mockImplementation(() => {
      throw new DOMException('The object can not be cloned.', 'DataCloneError')
    })
    win.dispatchEvent(new ErrorEvent('error', { error: new Error('boom'), message: 'Uncaught Error: boom' }))
    // The report was tried once
    expect(parent.postMessage).toHaveBeenCalledOnce()
  })

  it('loadGame() keeps "</script" in the game code as written, and it cannot end the script early', () => {
    const gameCode = 'window.tags = ["</script><p>", "</SCRIPT >"]; window.raw = String.raw`</script>`'
    const srcdoc = loadSrcdoc(gameCode)
    const page = parsePage(srcdoc)
    expect(page.querySelectorAll('script')).toHaveLength(2)
    expect(page.querySelector('p')).toBeNull()
    expect(gameScript(srcdoc)).toContain(gameCode)
    const { win, sendMessage } = runGame(srcdoc)
    expect(win).toEqual({ tags: ['</script><p>', '</SCRIPT >'], raw: '</script>' })
    expect(sendMessage).toHaveBeenCalledWith('ready', {})
  })
})
