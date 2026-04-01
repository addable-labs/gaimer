/**
 * Creates a sandboxed iframe for executing AI-generated game code.
 * Game code runs in an isolated context with no access to the parent DOM,
 * localStorage, or network. Communication happens via postMessage only.
 *
 * @param {HTMLElement} container - DOM element to mount the iframe into
 * @param {Object} [options] - Configuration options
 * @param {number} [options.width] - Canvas/iframe width
 * @param {number} [options.height] - Canvas/iframe height
 * @returns {Object} Sandbox controller with loadGame, postMessage, onMessage, destroy
 */
export function createSandbox(container, options = {}) {
  const { width, height } = options
  const messageHandlers = []
  let iframe = document.createElement('iframe')

  // Security: only allow script execution, nothing else
  iframe.setAttribute('sandbox', 'allow-scripts')
  iframe.style.border = 'none'
  iframe.style.display = 'block'

  if (width) iframe.width = String(width)
  if (height) iframe.height = String(height)

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
    const canvasWidth = width || 800
    const canvasHeight = height || 600

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob: data:;">
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

// Execute game code in IIFE
(function() {
  try {
    ${gameCode}
    __gaimer_sendMessage('ready', {});
  } catch (e) {
    __gaimer_sendMessage('error', { message: e.message, stack: e.stack });
  }
})();
</script>
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
