export const getSystemMessage = () => {
    return `You are an expert HTML5 JavaScript game developer. Given a game description, generate a complete, playable game.

# Response format

Return ONLY a valid JSON object (no markdown, no code fences, no extra text):

{
    "title": "Game Title",
    "description": "Brief game description",
    "rules": "How the game works",
    "goals": "Win conditions",
    "controls": "Keyboard AND touch controls",
    "enemies": "Enemy descriptions",
    "levels": "Level progression",
    "obstacles": "Obstacle descriptions",
    "player": "Player description",
    "power-ups": "Power-up descriptions",
    "rewards": "Reward descriptions",
    "other": "Other mechanics",
    "code": "Plain JavaScript code, with NO <script> tags"
}

# Execution environment

Your code runs inside a sandboxed iframe with a pre-existing <canvas id="game-canvas">. No access to the parent page, localStorage, or network.

# Code requirements

- Use ${JSON.stringify("document.getElementById('game-canvas')")} to get the canvas
- Read dimensions from canvas.width and canvas.height — do NOT set them
- Do NOT create new canvas elements or modify the DOM
- Support BOTH keyboard AND touch input:
  - Touch: add touchstart/touchmove/touchend listeners on canvas with preventDefault()
  - Map touch regions to controls (e.g. left half = move left)
  - Tap for actions (jump, shoot, etc.)

# Save/Restore state support (REQUIRED)

You MUST implement window.__gaimer_onMessage to handle save and restore:

window.__gaimer_onMessage = function(msg) {
  switch (msg.type) {
    case 'saveState':
      // Collect ALL mutable game state into a plain object
      var state = { score: score, level: level, playerX: playerX /* ...every game variable */ };
      __gaimer_sendMessage('stateData', state);
      break;
    case 'restoreState':
      // Restore ALL game state from msg.data
      score = msg.data.score; level = msg.data.level; playerX = msg.data.playerX;
      break;
    case 'pause':
      // Stop the game loop
      if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
      break;
    case 'resume':
      // Restart the game loop
      if (!animFrameId) { animFrameId = requestAnimationFrame(gameLoop); }
      break;
  }
};

CRITICAL rules for save/restore:
- Every let/var game variable (score, positions, velocities, timers, game phase, arrays of entities) MUST be in the saved state
- The state object MUST be JSON-serializable: no functions, no DOM refs, no circular refs
- Track your requestAnimationFrame ID in a variable (e.g. animFrameId) so pause/resume works
- After restoreState, the game loop should continue seamlessly with the restored values

Example game loop pattern:
var animFrameId = null;
function gameLoop() { update(); draw(); animFrameId = requestAnimationFrame(gameLoop); }
animFrameId = requestAnimationFrame(gameLoop);`;
};

// Asks the model to fix a game that fails as it starts. It is sent with the
// system message above, which keeps the fixed game to the same JSON keys,
// canvas and save/restore support.
export const getFixPrompt = (game, error) => {
    // A stack from Chromium starts with the error's message, one from WebKit
    // holds only the calls
    const report = error.stack.includes(error.message) ? error.stack : `${error.message}\n${error.stack}`.trim();
    // Where the error is in the game's code, when the game page could tell.
    // A syntax error has no stack to say it, and WebKit gives no column.
    let place = "";
    let why = "";
    if (error.line) {
        place = ` at line ${error.line}${error.column ? `, column ${error.column}` : ""} of its code`;
    } else if (error.afterCode) {
        // The page found the error only after the end of the code, in code
        // of its own, which the message names ("Unexpected token 'catch'").
        // Unless the prompt says why, the model looks for it in the game's
        // code.
        place = " after the end of its code";
        why = "\n\nThe game page puts code of its own after the game's code, and the error is found there: the game's code ends before a brace, bracket or parenthesis is closed, or before a string, comment or statement is ended, or it closes more braces than it opens.";
    }
    return `Here is a game, as JSON:

${JSON.stringify(game)}

It fails as it starts, with this error${place}:

${report}${why}

Fix the error, keep the rest of the game as it is, and reply with the whole game in the same JSON format.`;
};
