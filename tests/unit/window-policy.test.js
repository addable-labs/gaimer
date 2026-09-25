import { describe, it, expect } from 'vitest'
import tauriConfig from '../../src-tauri/tauri.conf.json'

// The sources the window's Content Security Policy gives one of its directives
function sources(directive) {
  const found = tauriConfig.app.security.csp
    .split(';')
    .map((part) => part.trim().split(/\s+/))
    .find(([name]) => name === directive)
  return found ? found.slice(1) : []
}

describe("the window's Content Security Policy", () => {
  it("lets Tauri's IPC reach the app through its custom protocol", () => {
    // In the built app, Tauri sends each call from the window with fetch, to
    // ipc://localhost/<command> (http://ipc.localhost/<command> on Windows).
    // When connect-src blocks that, the first call logs a CSP error and a
    // warning, and Tauri sends every call through postMessage instead.
    expect(sources('connect-src')).toEqual(expect.arrayContaining(['ipc:', 'http://ipc.localhost']))
  })
})
