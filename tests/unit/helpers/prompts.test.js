import { describe, it, expect, vi } from 'vitest'
import { getChangePrompt, getFixPrompt, getSystemMessage } from '../../../src/helpers/prompts.js'
import { GAME_TEXT_KEYS } from '../../../src/helpers/change-blocks.js'

// The system message states the contract the app relies on: the game's JSON,
// the canvas, the input, and the save/restore messages. These tests keep a
// later edit of the text from dropping any of it.
describe('getSystemMessage', () => {
  const message = getSystemMessage()

  it('asks for a valid JSON object with every key, the code as plain JavaScript with no script tags', () => {
    expect(message).toContain('Return ONLY a valid JSON object')
    for (const key of ['title', 'description', 'rules', 'goals', 'controls', 'enemies', 'levels', 'obstacles', 'player', 'power-ups', 'rewards', 'other', 'code']) {
      expect(message).toContain(`"${key}": "`)
    }
    expect(message).toContain('"code": "Plain JavaScript code, with NO <script> tags"')
  })

  it('serves a new game, a fix and a change, and asks for the whole game unless the request asks for only the changes', () => {
    expect(message).toContain(
      'The user describes a game to make, sends a game with an error to fix, or sends a game with a change to make. Reply with the whole game, unless the request asks for only the changes.'
    )
    expect(message).not.toContain('either way')
  })

  it('gives the format of the whole game, whose keys but code a change answer can change', () => {
    const format = message.slice(message.indexOf('The whole game is this object:'), message.indexOf('\n}\n'))
    const keys = [...format.matchAll(/^ {4}"([\w-]+)": "/gm)].map(([, key]) => key)
    expect(keys).toEqual([...GAME_TEXT_KEYS, 'code'])
  })

  it('names the canvas in the sandboxed iframe, whose size the game reads and never sets', () => {
    expect(message).toContain('sandboxed iframe')
    expect(message).toContain('<canvas id="game-canvas">')
    expect(message).toContain("document.getElementById('game-canvas')")
    expect(message).toMatch(/canvas\.width and canvas\.height\W+do not set them/i)
  })

  it('rules out new DOM, localStorage and the network', () => {
    expect(message).toMatch(/do not create new .*elements or modify the DOM/i)
    expect(message).toMatch(/no access to the parent page, localStorage\b.*\bnetwork/i)
  })

  it('asks for keyboard and touch input', () => {
    expect(message).toMatch(/support both keyboard and touch/i)
    expect(message).toContain('"controls": "Keyboard AND touch controls"')
  })

  it('asks for window.__gaimer_onMessage, answering the four messages the app sends', () => {
    expect(message).toContain('window.__gaimer_onMessage')
    for (const type of ['saveState', 'restoreState', 'pause', 'resume']) {
      expect(message).toContain(`'${type}'`)
    }
  })

  it('asks for the state as stateData, a JSON-serializable object, and for the requestAnimationFrame id to be kept', () => {
    expect(message).toContain("__gaimer_sendMessage('stateData', ")
    expect(message).toContain('JSON-serializable')
    expect(message).toMatch(/requestAnimationFrame id in a variable/i)
  })

  // Runs the example as a game, with stand-ins for the page, the frames, and
  // the game's own update() and draw(). Frame ids are 1, 2, 3...
  function runExample() {
    const example = message.slice(message.indexOf("var canvas = document.getElementById('game-canvas');"))
    const listeners = {}
    const canvas = { width: 800, height: 600, getContext: () => ({}), addEventListener: (type, listener) => (listeners[type] = listener) }
    const win = {}
    const sendMessage = vi.fn()
    const frames = []
    const requestAnimationFrame = vi.fn((callback) => frames.push(callback))
    const cancelAnimationFrame = vi.fn()
    const update = vi.fn()
    new Function('window', 'document', '__gaimer_sendMessage', 'requestAnimationFrame', 'cancelAnimationFrame', 'update', 'draw', example)(
      win,
      { getElementById: (id) => (id === 'game-canvas' ? canvas : null) },
      sendMessage,
      requestAnimationFrame,
      cancelAnimationFrame,
      update,
      () => {}
    )
    return {
      frames,
      update,
      requestAnimationFrame,
      cancelAnimationFrame,
      send: (type, data = {}) => win.__gaimer_onMessage({ type, data }),
      tap: () => listeners.pointerdown({ clientX: 10, clientY: 20 }),
      // The state the game sends when asked for a save
      save() {
        win.__gaimer_onMessage({ type: 'saveState', data: {} })
        const [type, state] = sendMessage.mock.lastCall
        expect(type).toBe('stateData')
        return state
      },
    }
  }

  it('gives an example whose loop moves by frame time, stops on pause and starts once on resume', () => {
    const game = runExample()

    // dt is in seconds, and a long gap (here the first frame) counts as 0.05 s
    game.frames[0](1000)
    game.frames[1](1016)
    expect(game.update.mock.calls).toEqual([[0.05], [0.016]])

    // Pause cancels the frame asked for last; resume asks for one frame, once
    game.send('pause')
    expect(game.cancelAnimationFrame).toHaveBeenCalledWith(3)
    game.send('resume')
    game.send('resume')
    expect(game.requestAnimationFrame).toHaveBeenCalledTimes(4)
  })

  it('gives an example that saves and restores its state, and goes on after a restore only on a tap or click', () => {
    const game = runExample()
    const state = game.save()
    expect(state.phase).toBe('start')
    expect(JSON.parse(JSON.stringify(state))).toEqual(state)

    game.tap()
    expect(game.save().phase).toBe('play')

    // A game restored in play waits for the player, then goes on from there
    game.send('restoreState', { ...state, phase: 'play', score: 7, best: 9 })
    expect(game.save()).toEqual({ ...state, phase: 'paused', score: 7, best: 9 })
    game.tap()
    expect(game.save()).toEqual({ ...state, phase: 'play', score: 7, best: 9 })

    // After game over, a tap plays again and keeps the best score
    game.send('restoreState', { ...state, phase: 'over', score: 7, best: 9 })
    game.tap()
    expect(game.save()).toEqual({ ...state, phase: 'play', score: 0, best: 9 })
  })
})

describe('getFixPrompt', () => {
  const game = { title: 'Pong', controls: 'Arrow keys', code: 'drawBall()' }

  it('holds the game as JSON and the error with its stack, and asks for the whole game, fixed, in the same format', () => {
    // As WebKit reports it: the stack holds only the calls
    const prompt = getFixPrompt(game, { message: "Can't find variable: drawBall", stack: 'global code@game.js:3:5' })
    expect(prompt).toContain(JSON.stringify(game))
    expect(prompt).toContain("Can't find variable: drawBall\nglobal code@game.js:3:5")
    expect(prompt).toContain('Fix the error')
    expect(prompt).toContain('whole game in the same JSON format')
  })

  it('gives the message once when the stack starts with it, as a stack from Chromium does', () => {
    const message = 'drawBall is not defined'
    const stack = 'ReferenceError: drawBall is not defined\n    at game.js:3:5'
    const prompt = getFixPrompt(game, { message, stack })
    expect(prompt).toContain(stack)
    expect(prompt.split(message)).toHaveLength(2)
  })

  it('gives the message alone when the error has no stack', () => {
    const prompt = getFixPrompt(game, { message: "Unexpected token ')'", stack: '' })
    expect(prompt).toContain("with this error:\n\nUnexpected token ')'\n\nFix the error")
  })

  it("names the line and column of the error in the game's code, when the game page gives them", () => {
    // A syntax error, as the game page reports it from Chromium
    const prompt = getFixPrompt(game, {
      message: "Unexpected token ';'",
      stack: "SyntaxError: Unexpected token ';'",
      line: 2,
      column: 16,
    })
    expect(prompt).toContain("with this error at line 2, column 16 of its code:\n\nSyntaxError: Unexpected token ';'\n\nFix the error")
  })

  it('names the line alone when the game page gives no column, as for a syntax error from WebKit', () => {
    const prompt = getFixPrompt(game, { message: "Unexpected token ';'", stack: '', line: 2 })
    expect(prompt).toContain("with this error at line 2 of its code:\n\nUnexpected token ';'\n\nFix the error")
  })

  describe('an error the game page found after the end of the code', () => {
    // The code leaves a brace open
    const unclosed = { title: 'Pong', controls: 'Arrow keys', code: 'function draw() {\n  fill();\n' }
    const why =
      "The game page puts code of its own after the game's code, and the error is found there: the game's code ends before a brace, bracket or parenthesis is closed, or before a string, comment or statement is ended, or it closes more braces than it opens."

    it("says that it is after the code, and why it names code that is not the game's", () => {
      // As the game page reports it from Chromium
      const chromium = getFixPrompt(unclosed, {
        message: "Unexpected token 'catch'",
        stack: "SyntaxError: Unexpected token 'catch'",
        afterCode: true,
      })
      expect(chromium).toContain(
        `with this error after the end of its code:\n\nSyntaxError: Unexpected token 'catch'\n\n${why}\n\nFix the error`
      )

      // And from WebKit, with no stack
      const webkit = getFixPrompt(unclosed, { message: "Unexpected keyword 'catch'", stack: '', afterCode: true })
      expect(webkit).toContain(`with this error after the end of its code:\n\nUnexpected keyword 'catch'\n\n${why}\n\nFix the error`)
    })

    it('is the only error for which the prompt says so', () => {
      const inCode = [
        { message: "Unexpected token ';'", stack: "SyntaxError: Unexpected token ';'", line: 2, column: 16 },
        { message: "Can't find variable: drawBall", stack: 'global code@game.js:3:5' },
      ]
      for (const error of inCode) {
        const prompt = getFixPrompt(game, error)
        expect(prompt).not.toContain('after the end of its code')
        expect(prompt).not.toContain('The game page puts code of its own')
      }
    })
  })
})

describe('getChangePrompt', () => {
  const game = { title: 'Pong', controls: 'Arrow keys', code: 'var speed = 5;\nball(speed);' }
  const requests = ['A game of pong', 'Make the paddles bigger']

  it('holds the game as JSON, the requests it was made from, oldest first, and the new request', () => {
    const prompt = getChangePrompt(game, 'Make the ball faster', requests)

    // The game as the fix prompt sends it: its JSON with the code
    expect(prompt).toContain(`Here is a game, as JSON:\n\n${JSON.stringify(game)}\n\n`)
    expect(prompt).toContain(
      'It was made from these requests, oldest first:\n\n- A game of pong\n- Make the paddles bigger\n\n'
    )
    expect(prompt).toContain(
      'Change the game as this new request asks, and keep the rest of it as it is:\n\nMake the ball faster\n\n'
    )
  })

  it('asks for change blocks as a JSON object, and states their rules', () => {
    const prompt = getChangePrompt(game, 'Make the ball faster', requests)

    expect(prompt).toContain('Reply with only the changes, as a JSON object:')
    expect(prompt).toContain('{ "find": "text copied exactly from the game\'s code", "replace": "the new text" }')
    expect(prompt).toContain('It must occur in the code exactly once')
    expect(prompt).toContain('The finds must not overlap. Every find is looked for in the code as it is now, before any change is made, and then all the changes are made together.')
    expect(prompt).toContain('give only those other keys of the game (title, description, rules, controls, ...) whose text changes')
    expect(prompt).toContain('Leave out "code"')
    expect(prompt).not.toContain('whole game')
  })

  it('asks for the whole game when the change blocks cannot be used, with the same game and requests', () => {
    const blocks = getChangePrompt(game, 'Make the ball faster', requests)
    const whole = getChangePrompt(game, 'Make the ball faster', requests, { wholeGame: true })

    expect(whole).toMatch(/\n\nReply with the whole game, changed, in the same JSON format\.$/)
    expect(whole).not.toContain('"changes"')
    // Up to what they ask for, the two requests are the same
    const asked = 'Make the ball faster\n\n'
    expect(whole.slice(0, whole.indexOf(asked))).toBe(blocks.slice(0, blocks.indexOf(asked)))
  })

  it('puts each line of a request of several lines in its item', () => {
    const prompt = getChangePrompt(game, 'Add a boss', ['A game of pong\nwith two players', 'Make the ball faster'])

    expect(prompt).toContain('- A game of pong\n  with two players\n- Make the ball faster\n\n')
  })

  it('leaves out the list when the game has no requests known', () => {
    const prompt = getChangePrompt(game, 'Make the ball faster', [])

    expect(prompt).not.toContain('It was made from')
    expect(prompt).toContain(`${JSON.stringify(game)}\n\nChange the game as this new request asks`)
  })
})
