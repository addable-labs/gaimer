// Reads the page that src/engine/sandbox.js writes into a game's iframe

const dataUrlStart = 'data:text/javascript;charset=utf-8;base64,'

// The game page, parsed
export function parsePage(srcdoc) {
  return new DOMParser().parseFromString(srcdoc, 'text/html')
}

// The source of one of the page's scripts, which the page loads from a base64
// data: URL
function scriptSource(srcdoc, index) {
  const src = parsePage(srcdoc).querySelectorAll('script')[index]?.getAttribute('src') ?? ''
  if (!src.startsWith(dataUrlStart)) {
    throw new Error(`The game page's script ${index + 1} has no data: URL: "${src.slice(0, 60)}"`)
  }
  const bytes = Uint8Array.from(atob(src.slice(dataUrlStart.length)), (char) => char.charCodeAt(0))
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

// The harness: the source of the page's first script
export function harnessScript(srcdoc) {
  return scriptSource(srcdoc, 0)
}

// The game's script: the source of the page's second script
export function gameScript(srcdoc) {
  return scriptSource(srcdoc, 1)
}
