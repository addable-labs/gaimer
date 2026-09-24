import { vi } from 'vitest'
import 'fake-indexeddb/auto'

// Node 25 and later define their own localStorage global, which is
// undefined unless Node runs with --localstorage-file. Vitest then keeps it
// instead of happy-dom's, so give tests happy-dom's, as on older Node.
if (typeof localStorage === 'undefined') {
  vi.stubGlobal('localStorage', new Storage())
}

// Mock @tauri-apps/api invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

// Mock @tauri-apps/api event
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(),
}))

// Mock @tauri-apps/plugin-shell
vi.mock('@tauri-apps/plugin-shell', () => ({
  Command: vi.fn(),
}))

// Mock @tauri-apps/plugin-fs
vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  exists: vi.fn(),
}))
