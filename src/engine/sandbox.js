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
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob: data:;">
<style>
  body { margin: 0; overflow: hidden; background: #1a1a1a; }
  canvas { display: block; }
</style>
</head>
<body>
<canvas id="game-canvas" width="${canvasWidth}" height="${canvasHeight}"></canvas>
<script>
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
