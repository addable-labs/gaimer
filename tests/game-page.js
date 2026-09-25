// Reads the page that src/engine/sandbox.js writes into a game's iframe

const dataUrlStart = 'data:text/javascript;charset=utf-8;base64,'

// The game page, parsed
export function parsePage(srcdoc) {
  return new DOMParser().parseFromString(srcdoc, 'text/html')
}

// The game's script: the source of the page's second script, which the page
// loads from a base64 data: URL
export function gameScript(srcdoc) {
  const src = parsePage(srcdoc).querySelectorAll('script')[1]?.getAttribute('src') ?? ''
  if (!src.startsWith(dataUrlStart)) {
    throw new Error(`The game page loads no script from a data: URL: ${src.slice(0, 60)}`)
  }
  const bytes = Uint8Array.from(atob(src.slice(dataUrlStart.length)), (char) => char.charCodeAt(0))
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}
