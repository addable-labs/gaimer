import { describe, it, expect } from 'vitest'
import { getSystemMessage } from '../../../src/helpers/prompts.js'

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

  it('references the game-container template', () => {
    const message = getSystemMessage()
    expect(message).toContain('game-container')
  })
})
