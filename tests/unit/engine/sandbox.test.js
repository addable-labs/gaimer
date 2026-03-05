import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSandbox } from '../../../src/engine/sandbox.js'

describe('createSandbox', () => {
  let container
  let sandbox

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
})
