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
    // A line holding only ";", an empty statement, ends the code. Code cut
    // off in the middle of an expression then fails with a syntax error that
    // the parser finds after the code. Without the line, the ready call
    // would complete the expression: after "player." it would be a call of
    // player.__gaimer_sendMessage, and after "var f = () =>" the body of a
    // function that nothing calls. After code that is complete, the line
    // does nothing. The catch reports an error thrown while the game starts.
    const gameScriptStart = `(function() {
  try {
    `
    const gameScript = `${gameScriptStart}${gameCode}
    ;
    __gaimer_sendMessage('ready', {});
  } catch (e) {
    __gaimer_reportError(e, String(e));
  }
})();
`

    // Where the game's code is in its script, for the harness to give the
    // line and column of an error in the code's own numbering, or to say
    // that the error is after the code: the lines before it, the columns
    // before its first line, and its number of lines, as JavaScript counts
    // them
    const linesBefore = gameScriptStart.split('\n')
    const codeInScript = {
      linesBefore: linesBefore.length - 1,
      columnsBefore: linesBefore[linesBefore.length - 1].length,
      lines: gameCode.split(/\r\n|[\n\r\u2028\u2029]/).length,
    }

    // The harness, the page's first script, runs before the game's script
    const harness = `// Prevent default touch behaviors (scrolling, zooming) on the canvas
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

// Send a message to the parent. postMessage throws on data it cannot copy,
// such as a function or an Image in the state a game saves. Report that
// error, and if the message was the game's answer to saveState, tell the
// parent that the save failed and why, rather than let it wait for an
// answer. An error report that cannot be sent is not reported in turn,
// which could loop.
function __gaimer_sendMessage(type, data) {
  try {
    parent.postMessage({ type: type, data: data }, '*');
  } catch (error) {
    if (type === 'error') return;
    __gaimer_reportError(error, String(error));
    if (type === 'stateData') {
      __gaimer_sendMessage('saveFailed', { message: error.message });
    }
  }
}

// Report errors to the parent: a syntax error in the game's script, which
// runs after this one, and errors the game throws later (game loop, input
// handlers, promises). Stack traces quote a script's whole data: URL in each
// of its frames: call this script harness.js and the game's game.js instead.
// The game's script wraps the game's code, so a place in game.js is given
// as its line and column in the code, and a place in the wrapper with
// neither. A place in harness.js stays as it is.
var __gaimer_harnessUrl = document.currentScript.src;
var __gaimer_code = ${JSON.stringify(codeInScript)};

// The line and column in the game's code of a place in the game's script,
// or null for a place in the wrapper. A column of 0 is not known.
function __gaimer_placeInCode(line, column) {
  line -= __gaimer_code.linesBefore;
  if (!(line >= 1 && line <= __gaimer_code.lines)) return null;
  if (line === 1 && column) column -= __gaimer_code.columnsBefore;
  return { line: line, column: column };
}

// The report gives the place of the error in the game's code: the one the
// caller knows, or else that of the innermost frame of its stack in the code.
// Or it says that the error is after the end of the code.
function __gaimer_reportError(error, fallbackMessage, place) {
  var stack = error && error.stack;
  if (typeof stack === 'string') {
    stack = stack.replace(/(data:text\\/javascript[^:]*)(?::(\\d+):(\\d+))?/g, function(match, url, line, column) {
      if (url === __gaimer_harnessUrl) return 'harness.js' + match.slice(url.length);
      var frame = line && __gaimer_placeInCode(+line, +column);
      place = place || frame;
      return frame ? 'game.js:' + frame.line + ':' + frame.column : 'game.js';
    });
  }
  var report = { message: (error && error.message) || fallbackMessage, stack: stack };
  if (place && place.afterCode) {
    report.afterCode = true;
  } else if (place) {
    report.line = place.line;
    report.column = place.column || null;
  }
  __gaimer_sendMessage('error', report);
}
// The event gives the place of the error, which is the only place a syntax
// error has: its stack names none in WebKit or Chromium. WebKit gives its
// line, but no column. When the code leaves a brace open, say, the parser
// finds the error only after the end of the code, at the wrapper's "catch":
// the report says that the error is after the code.
window.addEventListener('error', function(event) {
  var inGame = event.filename !== __gaimer_harnessUrl && /^data:text\\/javascript/.test(event.filename);
  var place = inGame ? __gaimer_placeInCode(event.lineno, event.colno) : null;
  if (inGame && event.lineno > __gaimer_code.linesBefore + __gaimer_code.lines) place = { afterCode: true };
  __gaimer_reportError(event.error, event.message, place);
});
window.addEventListener('unhandledrejection', function(event) {
  __gaimer_reportError(event.reason, String(event.reason));
});
`

    // The page loads both its scripts from data: URLs, and has no inline
    // script, for three reasons. In the built app, Tauri adds the hash of
    // each of the app's script files to the script-src of the window's
    // policy, which the page takes a copy of. A hash voids 'unsafe-inline',
    // so the page could run no inline script there. The page's origin is
    // opaque, and WebKit reports an error thrown in one of its inline scripts
    // only as "Script error.", while it reports one from a data: URL script
    // in full. And the game code stays away from the HTML parser: "<!--" and
    // then "<script" in it, even in a string, would make the parser read past
    // an inline script's end tag, and the script would never run.
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
<script src="data:text/javascript;charset=utf-8;base64,${toBase64(harness)}"></script>
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
     * Request the game to serialize its state. Resolves with state data.
     * Rejects with the reason at once if the page cannot send the game's
     * state (it holds a function, say), or after the timeout if the game
     * does not answer, as when it doesn't support save.
     */
    requestSave(timeoutMs = 2000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup()
          reject(new Error('The game did not answer'))
        }, timeoutMs)

        function onState(msg) {
          if (msg.type === 'stateData') {
            cleanup()
            resolve(msg.data)
          } else if (msg.type === 'saveFailed') {
            cleanup()
            reject(new Error(msg.data?.message))
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
