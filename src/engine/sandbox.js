/**
 * Creates a sandboxed iframe for executing AI-generated game code.
 * Game code runs in an isolated context with no access to the parent DOM,
 * localStorage, or network. Communication happens via postMessage only.
 *
 * @param {HTMLElement} container - DOM element to mount the iframe into. The
 *   iframe is positioned absolutely at its top left, so the container must
 *   be positioned (e.g. position: relative).
 * @param {Object} [options] - Configuration options
 * @param {number} [options.width] - Canvas/iframe width
 * @param {number} [options.height] - Canvas/iframe height
 * @returns {Object} Sandbox controller with loadGame, postMessage, onMessage, scaleToFit, destroy
 */
export function createSandbox(container, options = {}) {
  const { width, height } = options
  const canvasWidth = width || 800
  const canvasHeight = height || 600
  const messageHandlers = []
  let iframe = document.createElement('iframe')

  // Security: only allow script execution, nothing else
  iframe.setAttribute('sandbox', 'allow-scripts')
  iframe.style.border = 'none'
  iframe.style.display = 'block'
  // scaleToFit() moves and scales the iframe from here
  iframe.style.position = 'absolute'
  iframe.style.left = '0'
  iframe.style.top = '0'
  iframe.style.transformOrigin = '0 0'

  iframe.width = String(canvasWidth)
  iframe.height = String(canvasHeight)

  container.appendChild(iframe)

  // Listen for messages from the sandbox
  function handleMessage(event) {
    // Only accept messages from sandboxed iframes (origin is 'null')
    if (event.source !== iframe.contentWindow) return
    for (const handler of messageHandlers) {
      handler(event.data)
    }
  }
  window.addEventListener('message', handleMessage)

  function buildSrcdoc(gameCode) {
    // The game's code runs in an IIFE, in a script of its own: a syntax error
    // stops only that script, and the harness reports it. In the try block
    // the code stays in sloppy mode, even if it starts with "use strict".
    // The catch reports an error thrown while the game starts.
    const gameScript = `(function() {
  try {
    ${gameCode}
    __gaimer_sendMessage('ready', {});
  } catch (e) {
    __gaimer_reportError(e, String(e));
  }
})();
`

    // The page loads the game's script from a data: URL, for two reasons.
    // The page's origin is opaque, and WebKit reports an error thrown in one
    // of its inline scripts only as "Script error.", while it reports one
    // from a data: URL script in full. And the game code stays away from the
    // HTML parser: "<!--" and then "<script" in it, even in a string, would
    // make the parser read past an inline script's end tag, and the script
    // would never run.
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline'; img-src blob: data:;">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #1a1a1a; touch-action: none; }
  canvas { display: block; touch-action: none; -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
</style>
</head>
<body>
<canvas id="game-canvas" width="${canvasWidth}" height="${canvasHeight}"></canvas>
<script>
// Prevent default touch behaviors (scrolling, zooming) on the canvas
var __canvas = document.getElementById('game-canvas');
__canvas.addEventListener('touchstart', function(e) { e.preventDefault(); }, { passive: false });
__canvas.addEventListener('touchmove', function(e) { e.preventDefault(); }, { passive: false });
__canvas.addEventListener('touchend', function(e) { e.preventDefault(); }, { passive: false });

// Message handler for parent communication
window.addEventListener('message', function(event) {
  if (event.data && event.data.type) {
    if (typeof window.__gaimer_onMessage === 'function') {
      window.__gaimer_onMessage(event.data);
    }
  }
});

// Notify parent when ready
function __gaimer_sendMessage(type, data) {
  parent.postMessage({ type: type, data: data }, '*');
}

// Report errors to the parent: a syntax error in the game script below,
// and errors the game throws later (game loop, input handlers, promises).
// Stack traces quote the game script's whole data: URL in each frame: call
// it game.js instead.
function __gaimer_reportError(error, fallbackMessage) {
  var stack = error && error.stack;
  __gaimer_sendMessage('error', {
    message: (error && error.message) || fallbackMessage,
    stack: typeof stack === 'string' ? stack.replace(/data:text\\/javascript[^:]*/g, 'game.js') : stack
  });
}
window.addEventListener('error', function(event) {
  __gaimer_reportError(event.error, event.message);
});
window.addEventListener('unhandledrejection', function(event) {
  __gaimer_reportError(event.reason, String(event.reason));
});
</script>
<script src="data:text/javascript;charset=utf-8;base64,${toBase64(gameScript)}"></script>
</body>
</html>`
  }

  return {
    loadGame(gameCode) {
      iframe.srcdoc = buildSrcdoc(gameCode)
    },

    postMessage(type, data) {
      if (iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type, data }, '*')
      }
    },

    onMessage(handler) {
      messageHandlers.push(handler)
    },

    /**
     * Request the game to serialize its state. Resolves with state data
     * or rejects after timeout if the game doesn't support save.
     */
    requestSave(timeoutMs = 2000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup()
          reject(new Error('Save not supported'))
        }, timeoutMs)

        function onState(msg) {
          if (msg.type === 'stateData') {
            cleanup()
            resolve(msg.data)
          }
        }

        function cleanup() {
          clearTimeout(timer)
          const idx = messageHandlers.indexOf(onState)
          if (idx !== -1) messageHandlers.splice(idx, 1)
        }

        messageHandlers.push(onState)
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage({ type: 'saveState', data: {} }, '*')
        } else {
          cleanup()
          reject(new Error('No iframe'))
        }
      })
    },

    /**
     * Send saved state to the game for restoration.
     */
    requestRestore(stateData) {
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'restoreState', data: stateData }, '*')
      }
    },

    /**
     * Scale the game to fit a box of the given size at the container's top
     * left, centred in it and keeping its aspect ratio. Only the iframe's
     * CSS transform changes: the game keeps running, its canvas keeps its
     * size, and input still reaches it at canvas coordinates.
     */
    scaleToFit(boxWidth, boxHeight) {
      if (!iframe) return
      const scale = Math.min(boxWidth / canvasWidth, boxHeight / canvasHeight)
      // Whole pixels, so that a game at its own size is not blurred
      const x = Math.round((boxWidth - canvasWidth * scale) / 2)
      const y = Math.round((boxHeight - canvasHeight * scale) / 2)
      iframe.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
    },

    destroy() {
      window.removeEventListener('message', handleMessage)
      messageHandlers.length = 0
      if (iframe && iframe.parentNode) {
        iframe.parentNode.removeChild(iframe)
      }
      iframe = null
    }
  }
}

// Base64 of the UTF-8 bytes of a string. btoa() takes only characters of a
// single byte.
function toBase64(text) {
  let bytes = ''
  for (const byte of new TextEncoder().encode(text)) {
    bytes += String.fromCharCode(byte)
  }
  return btoa(bytes)
}
