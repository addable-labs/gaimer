import { describe, it, expect } from 'vitest'
import { applyChanges, parseChangeAnswer } from '../../../src/helpers/change-blocks.js'
import { safeParseGameJSON } from '../../../src/helpers/json-utils.js'

// A game as the model writes it
const game = {
  title: 'Pong',
  description: 'Two paddles and a ball',
  controls: 'Arrow keys',
  rules: 'First to 5 wins',
  code: 'var speed = 5;\nvar size = 40;\nfunction draw() {\n  ball(speed);\n}\n',
}

// Reads an answer to a change request and makes its changes to the game
function change(answer, to = game) {
  const read = parseChangeAnswer(JSON.stringify(answer))
  expect(read.error).toBeUndefined()
  return applyChanges(to, read.data)
}

describe('parseChangeAnswer', () => {
  it('reads the change blocks and only the keys the answer gives', () => {
    const answer = {
      changes: [{ find: 'var speed = 5;', replace: 'var speed = 8;' }],
      controls: 'Arrow keys, or drag',
    }

    expect(parseChangeAnswer(JSON.stringify(answer))).toEqual({
      ok: true,
      data: { changes: [{ find: 'var speed = 5;', replace: 'var speed = 8;' }], keys: { controls: 'Arrow keys, or drag' } },
    })
  })

  it('reads an answer in markdown fences, as a game is read', () => {
    const answer = JSON.stringify({ changes: [{ find: 'a', replace: 'b' }] })

    expect(parseChangeAnswer('```json\n' + answer + '\n```').ok).toBe(true)
  })

  it('takes an answer with no change blocks when it changes other keys', () => {
    expect(parseChangeAnswer(JSON.stringify({ changes: [], rules: 'First to 7 wins' })).data).toEqual({
      changes: [],
      keys: { rules: 'First to 7 wins' },
    })
  })

  it('leaves out keys that are not a game\'s', () => {
    const answer = { changes: [{ find: 'a', replace: 'b' }], explanation: 'The ball is faster', id: '42', versions: [] }

    expect(parseChangeAnswer(JSON.stringify(answer)).data.keys).toEqual({})
  })

  it('says why when the answer is not JSON', () => {
    const result = parseChangeAnswer('Here are the changes: make the ball faster')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Invalid JSON')
  })

  it('says why when the answer is empty or not an object', () => {
    expect(parseChangeAnswer('')).toEqual({ ok: false, error: 'Empty response' })
    expect(parseChangeAnswer('"faster"')).toEqual({ ok: false, error: 'Response is not a JSON object' })
  })

  it('gives a whole game, the shape the request for the whole game asks for, as the changed game, read as a new game is', () => {
    const wholeGame = { ...game, code: 'var speed = 8;', explanation: 'The ball is faster' }

    for (const answer of [JSON.stringify(wholeGame), '```json\n' + JSON.stringify(wholeGame) + '\n```']) {
      expect(safeParseGameJSON(answer).data).toEqual(wholeGame)
      expect(parseChangeAnswer(answer)).toEqual({ ok: true, data: { game: wholeGame } })
    }
  })

  it('does not take an answer with no change blocks that is not a game', () => {
    for (const answer of [{ title: 'Pong' }, { code: 'var speed = 8;' }, { title: 'Pong', code: '' }, {}]) {
      expect(parseChangeAnswer(JSON.stringify(answer)), JSON.stringify(answer)).toEqual({
        ok: false,
        error: 'Missing required field: changes (a list of change blocks)',
      })
    }
  })

  it('does not take a game that also gives "changes", even when they are no list', () => {
    const answer = { ...game, code: 'var speed = 8;', changes: null }

    expect(parseChangeAnswer(JSON.stringify(answer))).toEqual({
      ok: false,
      error: 'Missing required field: changes (a list of change blocks)',
    })
  })

  it('does not take the whole code next to change blocks, alone or in a whole game', () => {
    const changes = [{ find: 'var speed = 5;', replace: 'var speed = 8;' }]

    for (const answer of [{ changes, code: 'var speed = 8;' }, { ...game, code: 'var speed = 8;', changes }]) {
      expect(parseChangeAnswer(JSON.stringify(answer)), JSON.stringify(answer)).toEqual({
        ok: false,
        error: 'The answer gives the whole code, not only change blocks',
      })
    }
  })

  it('does not take a change block with an empty find, or none', () => {
    for (const block of [{ find: '', replace: 'var x = 1;' }, { replace: 'var x = 1;' }, { find: 3, replace: '' }, 'var x = 1;', null]) {
      const answer = { changes: [{ find: 'var speed = 5;', replace: 'var speed = 8;' }, block] }
      expect(parseChangeAnswer(JSON.stringify(answer)), JSON.stringify(block)).toEqual({
        ok: false,
        error: 'Change block 2 has no text to find',
      })
    }
  })

  it('does not take a change block with nothing to replace its text with', () => {
    const answer = { changes: [{ find: 'var speed = 5;' }] }

    expect(parseChangeAnswer(JSON.stringify(answer))).toEqual({
      ok: false,
      error: 'Change block 1 has no text to replace it with',
    })
  })

  it('takes an empty replacement, which deletes the text', () => {
    const answer = { changes: [{ find: 'var size = 40;\n', replace: '' }] }

    expect(change(answer).game.code).toBe('var speed = 5;\nfunction draw() {\n  ball(speed);\n}\n')
  })

  it('does not take a key of the game that is not text, or an empty title', () => {
    expect(parseChangeAnswer(JSON.stringify({ changes: [], rules: ['First to 7 wins'] }))).toEqual({
      ok: false,
      error: "The game's rules is not text",
    })
    expect(parseChangeAnswer(JSON.stringify({ changes: [], title: '' }))).toEqual({
      ok: false,
      error: "The game's title is empty",
    })
  })
})

describe('applyChanges', () => {
  it('replaces the text a block finds exactly once, and keeps the rest of the code', () => {
    const result = change({ changes: [{ find: 'var speed = 5;', replace: 'var speed = 8;' }] })

    expect(result).toEqual({
      ok: true,
      game: { ...game, code: 'var speed = 8;\nvar size = 40;\nfunction draw() {\n  ball(speed);\n}\n' },
    })
  })

  it('takes the keys the answer gives, and keeps the game\'s other keys', () => {
    const result = change({
      changes: [{ find: 'var size = 40;', replace: 'var size = 60;' }],
      title: 'Big Pong',
      controls: 'Arrow keys, or drag',
    })

    expect(result.game).toEqual({
      title: 'Big Pong',
      description: 'Two paddles and a ball',
      controls: 'Arrow keys, or drag',
      rules: 'First to 5 wins',
      code: 'var speed = 5;\nvar size = 60;\nfunction draw() {\n  ball(speed);\n}\n',
    })
  })

  it('finds every block in the code as it was, and makes them together', () => {
    // After the first block the second one's text would be in the code
    // twice, and after the second the first's would be gone. The blocks are
    // not in the code's order either.
    const result = change({
      changes: [
        { find: 'var size = 40;', replace: 'var speed = 5;' },
        { find: 'var speed = 5;', replace: 'var speed = 8;' },
      ],
    })

    expect(result.game.code).toBe('var speed = 8;\nvar speed = 5;\nfunction draw() {\n  ball(speed);\n}\n')
  })

  it('makes blocks that touch without overlapping', () => {
    const result = change({
      changes: [
        { find: 'var size = 40;\n', replace: 'var size = 60;\n' },
        { find: 'function draw()', replace: 'function paint()' },
      ],
    })

    expect(result.game.code).toBe('var speed = 5;\nvar size = 60;\nfunction paint() {\n  ball(speed);\n}\n')
  })

  it('says which block finds text that is not in the code', () => {
    const result = change({
      changes: [
        { find: 'var speed = 5;', replace: 'var speed = 8;' },
        // The model changed the spaces
        { find: 'var size  = 40;', replace: 'var size = 60;' },
      ],
    })

    expect(result).toEqual({ ok: false, error: 'The text of change block 2 is not in the code' })
  })

  it('says which block finds text that is in the code more than once', () => {
    expect(change({ changes: [{ find: 'var ', replace: 'let ' }] })).toEqual({
      ok: false,
      error: 'The text of change block 1 is in the code more than once',
    })
  })

  it('counts two places of the text that overlap as two', () => {
    const result = change({ changes: [{ find: 'aa', replace: 'b' }] }, { ...game, code: 'var s = "aaa";' })

    expect(result).toEqual({ ok: false, error: 'The text of change block 1 is in the code more than once' })
  })

  it('says which blocks overlap', () => {
    const result = change({
      changes: [
        { find: 'function draw() {\n  ball(speed);', replace: 'function draw() {\n  ball(speed * 2);' },
        { find: 'var size = 40;', replace: 'var size = 60;' },
        { find: 'ball(speed);\n}', replace: 'ball(speed);\n  paddles();\n}' },
      ],
    })

    expect(result).toEqual({ ok: false, error: 'Change blocks 1 and 3 overlap' })
  })

  it('takes two blocks with the same text as overlapping', () => {
    const block = { find: 'var size = 40;', replace: 'var size = 60;' }

    expect(change({ changes: [block, block] })).toEqual({ ok: false, error: 'Change blocks 1 and 2 overlap' })
  })

  it('says so when the answer leaves the game as it was', () => {
    expect(change({ changes: [] })).toEqual({ ok: false, error: 'The changes leave the game as it was' })
    expect(change({ changes: [{ find: 'var speed = 5;', replace: 'var speed = 5;' }], title: 'Pong' })).toEqual({
      ok: false,
      error: 'The changes leave the game as it was',
    })
  })

  it('takes a change of a key alone', () => {
    expect(change({ changes: [], rules: 'First to 7 wins' }).game).toEqual({ ...game, rules: 'First to 7 wins' })
  })
})
