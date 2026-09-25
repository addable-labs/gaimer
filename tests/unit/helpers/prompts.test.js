import { describe, it, expect } from 'vitest'
import { getFixPrompt, getSystemMessage } from '../../../src/helpers/prompts.js'

describe('getSystemMessage', () => {
  it('returns a non-empty string', () => {
    const message = getSystemMessage()
    expect(typeof message).toBe('string')
    expect(message.length).toBeGreaterThan(0)
  })

  it('includes instructions about the canvas element', () => {
    const message = getSystemMessage()
    expect(message).toContain('game-canvas')
  })

  it('includes JSON schema instructions', () => {
    const message = getSystemMessage()
    expect(message).toContain('"title"')
    expect(message).toContain('"code"')
    expect(message).toContain('"description"')
  })

  it('instructs not to use script tags', () => {
    const message = getSystemMessage()
    expect(message.toLowerCase()).toContain('no <script> tags')
  })

  it('instructs to return valid JSON', () => {
    const message = getSystemMessage()
    expect(message.toLowerCase()).toContain('valid json')
  })

  it('describes the sandboxed iframe execution environment', () => {
    const message = getSystemMessage()
    expect(message).toContain('sandboxed iframe')
  })

  it('includes touch/mobile support instructions', () => {
    const message = getSystemMessage()
    expect(message.toLowerCase()).toContain('touch')
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
