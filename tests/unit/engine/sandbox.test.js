import { describe, it, expect, vi, beforeEach, afterEach, onTestFinished } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createContext, runInContext } from 'vm'
import { Window } from 'happy-dom'
import { createSandbox } from '../../../src/engine/sandbox.js'
import { gameScript, harnessScript, parsePage } from '../../game-page.js'
import tauriConfig from '../../../src-tauri/tauri.conf.json'

// The URLs of the game page's scripts: the harness's, then the game script's
function scriptUrls(srcdoc) {
  return [...parsePage(srcdoc).querySelectorAll('script')].map((script) => script.getAttribute('src'))
}

// Runs the game page's harness, its first script, with a stand-in window and
// parent window, and returns them with the messages the parent received. As
// in a browser, the parent receives a copy of each message, and postMessage
// throws on a message it cannot copy. With game: true, the game's script
// runs after the harness, in the same global scope, as in the page. Each
// script runs under its data: URL, so that a stack trace names it and gives
// places in it as V8 counts them. A syntax error in the game's script goes
// to the window's error listeners, as in the page. With inWindow: true, the
// page runs in a window of its own, whose document holds the page's canvas:
// an event on the canvas goes through the window, whose capture listeners
// run first, and an error that a listener throws goes to the window's error
// listeners, as in a browser. The window is closed when the test ends.
function runHarness(srcdoc, { game = false, inWindow = false } = {}) {
  const parsed = parsePage(srcdoc)
  const win = inWindow ? new Window() : new EventTarget()
  const page = inWindow ? win.document : parsed
  if (inWindow) {
    onTestFinished(() => win.happyDOM.close())
    page.body.append(page.importNode(parsed.querySelector('canvas')))
  }
  Object.defineProperty(page, 'currentScript', { value: parsed.querySelector('script') })
  const received = []
  const parent = { postMessage: vi.fn((message) => received.push(structuredClone(message))) }
  const scope = createContext({ window: win, document: page, parent })
  const [harnessUrl, gameUrl] = scriptUrls(srcdoc)
  runInContext(harnessScript(srcdoc), scope, { filename: harnessUrl })
  if (game) {
    try {
      runInContext(gameScript(srcdoc), scope, { filename: gameUrl })
    } catch (error) {
      if (error.name !== 'SyntaxError') throw error
      win.dispatchEvent(syntaxErrorEvent(error, gameUrl))
    }
  }
  return { win, parent, received }
}

// An event of the player's input, which a browser marks as trusted. happy-dom
// gives events no isTrusted.
function playerInput(event) {
  Object.defineProperty(event, 'isTrusted', { value: true })
  return event
}

// The player taps or clicks the canvas of a page run in a window of its own
function tap(win) {
  win.document.getElementById('game-canvas').dispatchEvent(playerInput(new win.PointerEvent('pointerdown', { bubbles: true })))
}

// The player presses a key in a page run in a window of its own. The key
// goes to the page's body, which has the focus.
function press(win, key) {
  win.document.body.dispatchEvent(playerInput(new win.KeyboardEvent('keydown', { key, bubbles: true })))
}

// The error event Chromium fires for a syntax error V8 found in a script,
// with the error's place in the script. Node writes the place at the top of
// the error's stack: the script's URL and the line, then that line, with ^
// under the error. After the error's name and message, the stack goes on
// with Node's frames, where Chromium's ends.
function syntaxErrorEvent(error, url) {
  const [where, , marks] = error.stack.split('\n')
  if (!where.startsWith(`${url}:`)) throw new Error(`The syntax error's stack gives no place: ${error.stack}`)
  error.stack = `${error.name}: ${error.message}`
  return new ErrorEvent('error', {
    error,
    message: `Uncaught ${error.stack}`,
    filename: url,
    lineno: Number(where.slice(url.length + 1)),
    colno: marks.indexOf('^') + 1
  })
}

// The line and column, counted from 1, at which a text first appears in a
// script
function placeOf(script, text) {
  const index = script.indexOf(text)
  if (index === -1) throw new Error(`"${text}" is not in the script`)
  const lines = script.slice(0, index).split('\n')
  return { line: lines.length, column: lines.at(-1).length + 1 }
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
    vi.restoreAllMocks()
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

  it('focus() gives the game the keyboard focus without scrolling the page, and does nothing after destroy()', () => {
    sandbox = createSandbox(container)
    sandbox.loadGame('// game')
    const iframe = container.querySelector('iframe')
    const focus = vi.spyOn(iframe, 'focus')

    sandbox.focus()
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true })
    expect(document.activeElement).toBe(iframe)

    sandbox.destroy()
    expect(() => sandbox.focus()).not.toThrow()
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

  it('destroy() stops listening: a message from the game reaches no handler, and the window keeps no listener', () => {
    const addListener = vi.spyOn(window, 'addEventListener')
    const removeListener = vi.spyOn(window, 'removeEventListener')
    sandbox = createSandbox(container)
    const handler = vi.fn()
    sandbox.onMessage(handler)
    const game = container.querySelector('iframe').contentWindow
    const sendFromGame = () => window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'ready' },
      source: game,
    }))
    // Before destroy(), the message reaches the handler
    sendFromGame()
    expect(handler).toHaveBeenCalledOnce()

    sandbox.destroy()
    sendFromGame()

    expect(handler).toHaveBeenCalledOnce()
    const messageListeners = (spy) => spy.mock.calls.filter(([type]) => type === 'message')
    expect(messageListeners(removeListener)).toEqual(messageListeners(addListener))
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

  it('the game page calls the harness harness.js and the game script game.js in the stack traces it reports, with places in the game code', () => {
    // The game throws on a message the harness passes it
    const srcdoc = loadSrcdoc(`function tick() {
  score += bonus;
}
window.__gaimer_onMessage = function () {
  tick();
};`)
    const { win, parent } = runHarness(srcdoc)
    const [harness, game] = scriptUrls(srcdoc)
    // A browser gives a frame's place in the game's script, which wraps the
    // code
    const inGameScript = (text) => {
      const { line, column } = placeOf(gameScript(srcdoc), text)
      return `${game}:${line}:${column}`
    }
    // As Chromium writes the stack trace:
    const error = {
      message: 'boom',
      stack: `Error: boom\n    at tick (${inGameScript('bonus')})\n    at window.__gaimer_onMessage (${inGameScript('tick();')})\n    at ${harness}:11:14`
    }
    win.dispatchEvent(new ErrorEvent('error', { error, message: 'Uncaught Error: boom' }))
    // The report gives the place of the innermost frame in the code, as the
    // error's
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      {
        type: 'error',
        data: {
          message: 'boom',
          stack: 'Error: boom\n    at tick (game.js:2:12)\n    at window.__gaimer_onMessage (game.js:5:3)\n    at harness.js:11:14',
          line: 2,
          column: 12
        }
      },
      '*'
    )
    // As WebKit writes it
    error.stack = `tick@${inGameScript('bonus')}\n@${inGameScript('tick();')}\n@${harness}:11:14`
    win.dispatchEvent(new ErrorEvent('error', { error, message: 'Error: boom' }))
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      {
        type: 'error',
        data: { message: 'boom', stack: 'tick@game.js:2:12\n@game.js:5:3\n@harness.js:11:14', line: 2, column: 12 }
      },
      '*'
    )
  })

  it('the stack trace of an error the game throws as it starts gives the lines and columns of the game code', () => {
    // The code's first line calls a function that throws. V8 gives the stack
    // trace, with each frame's place in its script.
    const srcdoc = loadSrcdoc(`drawBall();
function drawBall() {
  ball.draw(document.getElementById('game-canvas'));
}`)
    const { received } = runHarness(srcdoc, { game: true })
    expect(received).toEqual([
      {
        type: 'error',
        data: { message: 'ball is not defined', stack: expect.any(String), line: 3, column: 3 }
      }
    ])
    // The frames in the code, and the frame of the wrapper that calls the
    // code, which has no place in it. The test runner's frames follow.
    expect(received[0].data.stack.split('\n').slice(0, 4)).toEqual([
      'ReferenceError: ball is not defined',
      '    at drawBall (game.js:3:3)',
      '    at game.js:1:1',
      '    at game.js'
    ])
  })

  it("the game page gives a syntax error's line and column in the game code, from the error event", () => {
    // A syntax error's stack gives no place, in WebKit or Chromium. The error
    // event gives its place in the game's script: here, of the ";" on the
    // code's second line.
    const srcdoc = loadSrcdoc('var speed = 5;\nvar x = speed +;\ndraw(x);')
    const { win, parent } = runHarness(srcdoc)
    const [, game] = scriptUrls(srcdoc)
    const { line, column } = placeOf(gameScript(srcdoc), ';\ndraw')
    const message = "Unexpected token ';'"

    // As Chromium reports it
    win.dispatchEvent(new ErrorEvent('error', {
      error: { message, stack: `SyntaxError: ${message}` },
      message: `Uncaught SyntaxError: ${message}`,
      filename: game,
      lineno: line,
      colno: column
    }))
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      { type: 'error', data: { message, stack: `SyntaxError: ${message}`, line: 2, column: 16 } },
      '*'
    )

    // As WebKit reports it, with no stack and no column
    win.dispatchEvent(new ErrorEvent('error', {
      error: { message },
      message: `SyntaxError: ${message}`,
      filename: game,
      lineno: line,
      colno: 0
    }))
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      { type: 'error', data: { message, line: 2, column: null } },
      '*'
    )
  })

  it("the game page gives the column of a syntax error on the game code's first line, which the wrapper indents", () => {
    const srcdoc = loadSrcdoc('var x = speed +;\ndraw(x);')
    const { win, parent } = runHarness(srcdoc)
    const [, game] = scriptUrls(srcdoc)
    const { line, column } = placeOf(gameScript(srcdoc), ';\ndraw')
    const message = "Unexpected token ';'"
    win.dispatchEvent(new ErrorEvent('error', {
      error: { message, stack: `SyntaxError: ${message}` },
      message: `Uncaught SyntaxError: ${message}`,
      filename: game,
      lineno: line,
      colno: column
    }))
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      { type: 'error', data: { message, stack: `SyntaxError: ${message}`, line: 1, column: 16 } },
      '*'
    )
  })

  it('the game page keeps the places in the harness of an error the harness throws', () => {
    // The game answers saveState with a function in its state, on line 2 of
    // its code, and postMessage throws in the harness
    const srcdoc = loadSrcdoc(`window.__gaimer_onMessage = function (msg) {
  __gaimer_sendMessage('stateData', { update: function () {} });
};`)
    const { win, received } = runHarness(srcdoc, { game: true })
    win.dispatchEvent(new MessageEvent('message', { data: { type: 'saveState', data: {} } }))

    const { stack, line, column } = received[1].data
    const inHarness = (text) => {
      const place = placeOf(harnessScript(srcdoc), text)
      return `harness.js:${place.line}:${place.column}`
    }
    // Its frames in the harness keep their places there, and the game's
    // frame between them has its place in the code. The report gives that
    // place, where the game called the harness.
    expect(stack).toContain(`at __gaimer_sendMessage (${inHarness('postMessage({')})\n`)
    expect(stack).toContain('__gaimer_onMessage (game.js:2:3)\n')
    expect(stack).toContain(`<anonymous> (${inHarness('__gaimer_onMessage(event.data)')})\n`)
    expect({ line, column }).toEqual({ line: 2, column: 3 })
  })

  it('the game page gives no place in the game code for an error placed in the harness, or in the wrapper after the code', () => {
    // The code leaves a function open, and the parser finds the error only
    // after it, at the wrapper's "catch"
    const srcdoc = loadSrcdoc('function draw() {\n  fill();\n')
    const { win, parent } = runHarness(srcdoc)
    const [harness, game] = scriptUrls(srcdoc)
    const { line, column } = placeOf(gameScript(srcdoc), 'catch')
    const message = "Unexpected token 'catch'"
    win.dispatchEvent(new ErrorEvent('error', {
      error: { message, stack: `SyntaxError: ${message}` },
      message: `Uncaught SyntaxError: ${message}`,
      filename: game,
      lineno: line,
      colno: column
    }))
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      { type: 'error', data: { message, stack: `SyntaxError: ${message}`, afterCode: true } },
      '*'
    )

    // An error the harness throws on its line 4, which would be the code's
    // line 2 if it were in the game's script
    win.dispatchEvent(new ErrorEvent('error', {
      error: { message: 'boom', stack: `Error: boom\n    at ${harness}:4:5` },
      message: 'Uncaught Error: boom',
      filename: harness,
      lineno: 4,
      colno: 5
    }))
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      { type: 'error', data: { message: 'boom', stack: 'Error: boom\n    at harness.js:4:5' } },
      '*'
    )
  })

  it('the game page says that a syntax error is after the end of the game code when the code leaves a brace open', () => {
    // The brace takes the wrapper's "}" as its own, and the parser finds the
    // error at the wrapper's "catch", as V8 does here
    const srcdoc = loadSrcdoc('function draw() {\n  fill();\n')
    const { received } = runHarness(srcdoc, { game: true })
    expect(received).toEqual([
      {
        type: 'error',
        data: { message: "Unexpected token 'catch'", stack: "SyntaxError: Unexpected token 'catch'", afterCode: true }
      }
    ])

    // As WebKit reports it, in its words, with no stack and no column
    const { win, parent } = runHarness(srcdoc)
    const [, game] = scriptUrls(srcdoc)
    const message = "Unexpected keyword 'catch'"
    win.dispatchEvent(new ErrorEvent('error', {
      error: { message },
      message: `SyntaxError: ${message}`,
      filename: game,
      lineno: placeOf(gameScript(srcdoc), 'catch').line,
      colno: 0
    }))
    expect(parent.postMessage).toHaveBeenLastCalledWith({ type: 'error', data: { message, afterCode: true } }, '*')
  })

  it('the game page says the same of other code the parser reads past the end of: a bracket or parenthesis left open, a statement or template literal not ended', () => {
    // V8 finds each error in the wrapper's line after the code, which holds
    // only ";", or, for the template literal, at the end of the script
    const cases = [
      ['var level = [\n  [1, 2],', "Unexpected token ';'"],
      ['draw(1,', "Unexpected token ';'"],
      ['if (x > 5', "Unexpected token ';'"],
      ['var speed = 5;\nvar', "Unexpected token ';'"],
      ['var title = `Score:\n', 'Unexpected end of input']
    ]
    sandbox = createSandbox(container)
    for (const [code, message] of cases) {
      sandbox.loadGame(code)
      const { received } = runHarness(container.querySelector('iframe').srcdoc, { game: true })
      expect(received, code).toEqual([
        { type: 'error', data: { message, stack: `SyntaxError: ${message}`, afterCode: true } }
      ])
    }
  })

  it('the game page ends the game code with a line holding only ";", so that code cut off in the middle of an expression fails with a syntax error after the code', () => {
    // Without that line, the ready call after the code would complete each
    // expression. "player." would call player.__gaimer_sendMessage, which is
    // not a function. The arrow function would take the call as its body,
    // and the game would never send ready. The sum would send ready, and the
    // broken game would run.
    const cases = ['var player = { x: 0, y: 0 };\nplayer.', 'var f = () =>', 'var x = 5 +']
    sandbox = createSandbox(container)
    const received = Object.fromEntries(
      cases.map((code) => {
        sandbox.loadGame(code)
        return [code, runHarness(container.querySelector('iframe').srcdoc, { game: true }).received]
      })
    )
    // For each, V8 finds the error at the ";", and the game does not send
    // ready
    const error = { message: "Unexpected token ';'", stack: "SyntaxError: Unexpected token ';'", afterCode: true }
    expect(received).toEqual(Object.fromEntries(cases.map((code) => [code, [{ type: 'error', data: error }]])))
  })

  it('the line holding only ";" after the game code changes nothing for code that is complete', () => {
    // Code that ends with no ";", with a comment, or with a statement that
    // takes the ";" as its own
    const cases = [
      'window.score = 1',
      'window.score = 1; // the end',
      'window.score = 0;\ndo window.score++; while (window.score < 1)'
    ]
    sandbox = createSandbox(container)
    for (const code of cases) {
      sandbox.loadGame(code)
      const { win, received } = runHarness(container.querySelector('iframe').srcdoc, { game: true })
      expect(win.score, code).toBe(1)
      expect(received, code).toEqual([{ type: 'ready', data: {} }])
    }
  })

  it('the game page gives the place of an error the game throws on the last line of its code, just before the line holding only ";"', () => {
    const { received } = runHarness(loadSrcdoc('var player = null;\nplayer.x = 1'), { game: true })
    expect(received).toEqual([
      {
        type: 'error',
        data: { message: "Cannot set properties of null (setting 'x')", stack: expect.any(String), line: 2, column: 10 }
      }
    ])
    // The stack's frame in the code, and the frame of the wrapper that calls
    // the code, which has no place in it
    expect(received[0].data.stack.split('\n').slice(0, 3)).toEqual([
      "TypeError: Cannot set properties of null (setting 'x')",
      '    at game.js:2:10',
      '    at game.js'
    ])
  })

  it('the game page gives the place of a syntax error on the last line of the game code, which is not after the code', () => {
    const { received } = runHarness(loadSrcdoc('var speed = 5;\nvar x = speed +;'), { game: true })
    expect(received).toEqual([
      {
        type: 'error',
        data: { message: "Unexpected token ';'", stack: "SyntaxError: Unexpected token ';'", line: 2, column: 16 }
      }
    ])
  })

  it('the game page does not say that an error placed in the wrapper before the game code, or in the harness, is after the code', () => {
    // The code is on the game script's line 3
    const srcdoc = loadSrcdoc('draw();')
    const { win, parent } = runHarness(srcdoc)
    const [harness, game] = scriptUrls(srcdoc)
    for (const [filename, lineno] of [[game, 1], [game, 2], [harness, 40]]) {
      win.dispatchEvent(new ErrorEvent('error', {
        error: { message: 'boom' },
        message: 'Error: boom',
        filename,
        lineno,
        colno: 1
      }))
      expect(parent.postMessage).toHaveBeenLastCalledWith({ type: 'error', data: { message: 'boom' } }, '*')
    }
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
    // error, at the line of the code that sent the state, and as the answer
    // to saveState.
    expect(win.answered).toBe(true)
    const message = 'function () {} could not be cloned.'
    expect(received.slice(1)).toEqual([
      { type: 'error', data: { message, stack: expect.stringContaining(message), line: 3, column: 5 } },
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

  it("the game page tells the parent of the player's first touch, click or key press, and of no later input", () => {
    const srcdoc = loadSrcdoc('// game')
    // The mouse moves over the game, which is not input yet. Then a tap or a
    // click, which gives a pointerdown on the canvas.
    const tapped = runHarness(srcdoc, { inWindow: true })
    const canvas = tapped.win.document.getElementById('game-canvas')
    canvas.dispatchEvent(new tapped.win.PointerEvent('pointermove', { bubbles: true }))
    expect(tapped.received).toEqual([])
    tap(tapped.win)
    expect(tapped.received).toEqual([{ type: 'firstInput', data: {} }])
    tap(tapped.win)
    press(tapped.win, ' ')
    expect(tapped.received).toEqual([{ type: 'firstInput', data: {} }])

    // A key press first
    const pressed = runHarness(srcdoc, { inWindow: true })
    press(pressed.win, 'ArrowUp')
    expect(pressed.received).toEqual([{ type: 'firstInput', data: {} }])
    press(pressed.win, 'ArrowUp')
    tap(pressed.win)
    expect(pressed.received).toEqual([{ type: 'firstInput', data: {} }])
  })

  it("the game page tells the parent of the player's first input before an error that the game's own handler throws for it", () => {
    // The game plays from the first tap, click or key press, with the
    // listeners the system message asks for, and play throws at once
    const srcdoc = loadSrcdoc(`function play() {
  spawnEnemy();
}
document.getElementById('game-canvas').addEventListener('pointerdown', play);
window.addEventListener('keydown', play);`)
    const error = {
      type: 'error',
      data: { message: 'spawnEnemy is not defined', stack: expect.any(String), line: 2, column: 3 }
    }

    // The canvas's listener runs after the page's, which the window has for
    // the capture phase
    const tapped = runHarness(srcdoc, { game: true, inWindow: true })
    tap(tapped.win)
    expect(tapped.received).toEqual([{ type: 'ready', data: {} }, { type: 'firstInput', data: {} }, error])

    // The window's own listener runs after the page's, which it got first
    const pressed = runHarness(srcdoc, { game: true, inWindow: true })
    press(pressed.win, ' ')
    expect(pressed.received).toEqual([{ type: 'ready', data: {} }, { type: 'firstInput', data: {} }, error])
  })

  it("the game page takes the keyboard focus when the player clicks the game, before the game's own handler cancels the event", () => {
    // The game's handler calls preventDefault(), which stops a click from
    // giving the page the focus, and stops the event from going further
    const srcdoc = loadSrcdoc(`document.getElementById('game-canvas').addEventListener('pointerdown', function (e) {
  e.preventDefault();
  e.stopPropagation();
  window.calls.push('game');
});`)
    const { win } = runHarness(srcdoc, { game: true, inWindow: true })
    win.calls = []
    vi.spyOn(win, 'focus').mockImplementation(() => win.calls.push('focus'))

    tap(win)
    expect(win.calls).toEqual(['focus', 'game'])

    // And again on the next click, after the player has moved the focus to
    // a button in the app, say
    tap(win)
    expect(win.calls).toEqual(['focus', 'game', 'focus', 'game'])
  })

  it('the game page does not take the focus when the mouse only moves over the game, or for a pointerdown the game makes itself', () => {
    const { win } = runHarness(loadSrcdoc('// game'), { inWindow: true })
    const focus = vi.spyOn(win, 'focus')
    const canvas = win.document.getElementById('game-canvas')

    // The mouse moves over the game while the user types in the description
    // box
    for (const type of ['pointerover', 'pointerenter', 'pointermove']) {
      canvas.dispatchEvent(playerInput(new win.PointerEvent(type, { bubbles: true })))
    }
    // The game's code makes a pointerdown, which is not trusted
    const madeUp = new win.PointerEvent('pointerdown', { bubbles: true })
    Object.defineProperty(madeUp, 'isTrusted', { value: false })
    canvas.dispatchEvent(madeUp)
    expect(focus).not.toHaveBeenCalled()

    // The player's own click
    tap(win)
    expect(focus).toHaveBeenCalledOnce()
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
