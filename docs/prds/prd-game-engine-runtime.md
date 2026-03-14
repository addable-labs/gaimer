# PRD: Game Engine Runtime

> Feature: Lightweight game runtime that AI-generated code targets, with touch support, sandboxed execution, and game lifecycle management.

## Problem Statement

Currently, AI-generated games are raw JavaScript executed via `eval()` in the main application context. This creates multiple issues:

1. **Security**: `eval()` can access the full DOM, localStorage, and application state
2. **No touch support**: Only keyboard events work — games are unplayable on iOS
3. **No game loop abstraction**: AI must generate its own RAF loop each time, leading to inconsistency
4. **No lifecycle management**: Switching apps on iOS breaks running games (no pause/resume)
5. **Variable leaks**: Despite IIFE wrapping, games can still pollute shared state
6. **No asset support**: Games can only use canvas primitives — no sprites, no audio
7. **Limited output**: 4096 token limit means AI spends tokens on boilerplate instead of game logic

## Goals

1. Provide a stable runtime API that AI-generated code hooks into
2. Execute game code in a sandboxed iframe with CSP restrictions
3. Support touch input (virtual d-pad, tap, swipe) as first-class input
4. Handle game lifecycle (pause/resume/cleanup)
5. Enable sprite and audio loading from blob URLs
6. Reduce AI token waste by providing standard game infrastructure

## Non-Goals

- Building a full-featured game engine (no 3D, no physics engine)
- Supporting multiplayer or networking
- Backward compatibility with existing games (clean break, migration tool later)
- WebGL rendering (Canvas 2D only for now)

## Requirements

### R1: Sandboxed Game Execution

**Description**: Replace `eval()` with an iframe sandbox that communicates via `postMessage`.

**Acceptance Criteria**:
- [ ] Game code executes in a sandboxed iframe with `sandbox="allow-scripts"` attribute
- [ ] iframe has CSP: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'`
- [ ] No direct DOM access to parent application from game code
- [ ] Communication between app and game happens exclusively via `postMessage`
- [ ] Game cleanup on switch: iframe is destroyed and recreated
- [ ] Memory usage does not increase with each game switch (no leaks)

**Tasks**:
1. Create `src/engine/sandbox.js`:
   - `createSandbox(containerEl)` → returns sandbox controller
   - `sandbox.loadGame(code, runtimeCode)` → inject and execute
   - `sandbox.postMessage(type, data)` → send commands
   - `sandbox.onMessage(handler)` → receive game events
   - `sandbox.destroy()` → cleanup iframe and event listeners
2. Create sandbox HTML template (injected as srcdoc):
   ```html
   <canvas id="game-canvas"></canvas>
   <script>/* GaimerRuntime injected here */</script>
   <script>/* Game code injected here */</script>
   ```
3. Implement message protocol:
   - `app→game`: `{ type: 'pause' | 'resume' | 'resize' | 'input', data }`
   - `game→app`: `{ type: 'state' | 'error' | 'ready' | 'audio', data }`
4. Refactor `GameContainer.vue` to use sandbox instead of eval
5. Write unit tests for sandbox creation, messaging, and cleanup
6. Write memory leak test (create/destroy 100 sandboxes, check heap)

**Verification**:
- `npm run test:unit -- sandbox` passes
- `document`, `localStorage`, `fetch` are NOT accessible from game code
- Creating and destroying 100 games does not increase heap beyond 10%
- Existing game generation flow still produces playable games

---

### R2: GaimerRuntime API

**Description**: A runtime library injected into the sandbox that provides the game development API.

**Acceptance Criteria**:
- [ ] Runtime provides: canvas context, dimensions, deltaTime, update/draw hooks
- [ ] Runtime manages the game loop (requestAnimationFrame)
- [ ] Input system handles both keyboard and touch events
- [ ] Sprite loading from blob URLs works
- [ ] Audio playback from blob URLs works
- [ ] Collision detection helpers available
- [ ] State persistence across game sessions (via postMessage to parent)
- [ ] Runtime is < 10KB minified

**Tasks**:
1. Create `src/engine/runtime.js` — the GaimerRuntime class:
   ```javascript
   class GaimerRuntime {
     constructor(canvas) { ... }
     // Game loop
     onUpdate(callback)    // Called every frame with deltaTime
     onDraw(callback)      // Called every frame after update
     start()               // Begin game loop
     stop()                // End game loop
     // Properties
     get canvas()          // Canvas 2D context
     get width()           // Current canvas width
     get height()          // Current canvas height
     get deltaTime()       // Seconds since last frame
     get frameCount()      // Total frames rendered
   }
   ```
2. Create `src/engine/input.js` — unified input system:
   ```javascript
   class InputManager {
     isPressed(key)        // 'left', 'right', 'up', 'down', 'action', 'back'
     isJustPressed(key)    // True only on first frame of press
     isTapped()            // Touch tap detected this frame
     swipeDirection()      // 'left' | 'right' | 'up' | 'down' | null
     touchPosition()       // { x, y } or null
   }
   ```
3. Create `src/engine/collision.js`:
   ```javascript
   collides(a, b)          // AABB collision: { x, y, w, h }
   circleCollides(a, b)    // Circle collision: { x, y, r }
   pointInRect(px, py, rect)
   ```
4. Create `src/engine/sprites.js`:
   ```javascript
   class SpriteManager {
     async load(id, blobUrl)
     draw(id, x, y, w, h)
     drawFrame(id, frameIndex, x, y, w, h)  // Sprite sheet
     animate(id, frames, fps)               // Auto-animate
     isLoaded(id)
   }
   ```
5. Create `src/engine/audio.js`:
   ```javascript
   class AudioManager {
     async loadEffect(name, blobUrl)
     playEffect(name)
     setVolume(level)      // 0.0 - 1.0
     mute() / unmute()
   }
   ```
6. Create `src/engine/game-loop.js` — RAF manager with fixed timestep
7. Bundle runtime modules into single injectable script
8. Write comprehensive unit tests for each module
9. Create example game using the runtime API (manual test fixture)

**Verification**:
- `npm run test:unit -- engine` passes (all modules)
- Runtime bundle size < 10KB minified
- Example game runs smoothly at 60 FPS on iOS Safari
- All API methods documented with JSDoc

---

### R3: Touch Input System

**Description**: First-class touch input with virtual controls for iOS gameplay.

**Acceptance Criteria**:
- [ ] Virtual d-pad overlay appears on touch devices (left, right, up, down)
- [ ] Action button(s) for primary/secondary game actions
- [ ] Tap anywhere (outside controls) registers as `isTapped()`
- [ ] Swipe gestures detected with direction and velocity
- [ ] Controls are semi-transparent and do not obscure gameplay
- [ ] Controls adapt to left-handed / right-handed preference
- [ ] Haptic feedback on button press (iOS)
- [ ] Keyboard input still works on desktop (parallel support)

**Tasks**:
1. Design virtual d-pad layout (SVG overlays on canvas):
   - D-pad: bottom-left quadrant
   - Action buttons (A, B): bottom-right quadrant
   - Pause button: top-right corner
2. Implement touch event handlers in `input.js`:
   - `touchstart` → detect which control zone
   - `touchmove` → update d-pad direction
   - `touchend` → release
   - Multi-touch: d-pad + action button simultaneously
3. Implement gesture recognition:
   - Swipe: track start → end, calculate direction + distance
   - Tap: touchstart + touchend within 200ms and 10px radius
   - Long press: touchstart held > 500ms
4. Map touch controls to abstract input names (same as keyboard):
   - D-pad left → `input.isPressed('left')`
   - Action A → `input.isPressed('action')`
   - Works identically for keyboard arrows + space/enter
5. Add control customization (left/right handed toggle)
6. Integrate haptic feedback via `navigator.vibrate()` or Tauri haptics plugin
7. Render controls as an overlay in `GameContainer.vue` (outside sandbox iframe)
8. Forward touch state to sandbox via postMessage
9. Write unit tests for gesture detection (simulated touch events)
10. Write Playwright e2e test with touch emulation

**Verification**:
- `npm run test:unit -- input` passes
- `npm run test:e2e -- touch-controls` passes
- D-pad + action button can be pressed simultaneously (multi-touch)
- Swipe detection accuracy > 95% in 4 cardinal directions
- Control overlay does not block canvas interaction in zones without controls

---

### R4: Game Lifecycle Management

**Description**: Handle pause, resume, cleanup, and canvas resizing.

**Acceptance Criteria**:
- [ ] Game pauses when app goes to background (iOS `visibilitychange`)
- [ ] Game resumes when app returns to foreground
- [ ] Pause shows overlay with "Paused" text and resume instruction
- [ ] Canvas resizes on orientation change without breaking the game
- [ ] Game state survives pause/resume cycle
- [ ] Switching to a different game properly cleans up the previous one
- [ ] No audio plays while paused

**Tasks**:
1. Implement pause/resume in `game-loop.js`:
   - `pause()`: Stop RAF loop, save timestamp
   - `resume()`: Restart RAF loop, adjust deltaTime to avoid jump
2. Listen for `visibilitychange` in `GameContainer.vue`:
   - `hidden` → `sandbox.postMessage('pause')`
   - `visible` → `sandbox.postMessage('resume')`
3. Implement canvas resize handling:
   - Listen for `resize` event and orientation change
   - Recalculate canvas dimensions
   - Send new dimensions to sandbox: `sandbox.postMessage('resize', { w, h })`
   - Runtime adjusts `game.width`, `game.height` — game code reacts
4. Implement pause overlay (rendered in parent, above iframe)
5. Implement cleanup sequence:
   - Stop game loop
   - Disconnect audio context
   - Revoke all blob URLs
   - Destroy iframe
6. Implement audio pause/resume in `audio.js`
7. Write unit tests for lifecycle transitions
8. Write integration test for orientation change flow

**Verification**:
- `npm run test:unit -- game-loop lifecycle` passes
- No `requestAnimationFrame` callbacks fire while paused
- Canvas dimensions update within 100ms of orientation change
- Audio stops immediately on pause, resumes on unpause
- No memory leaks on game switch (verified with Chrome DevTools heap snapshot)

---

### R5: Updated AI System Prompt

**Description**: Rewrite the system prompt to generate code targeting the GaimerRuntime API instead of raw canvas.

**Acceptance Criteria**:
- [ ] AI generates code that uses `game.onUpdate()`, `game.onDraw()`, `game.input.*`
- [ ] Generated code does NOT create its own game loop
- [ ] Generated code does NOT access `document`, `window`, or `localStorage`
- [ ] Generated games include sprite manifest for the generation pipeline
- [ ] Generated code works within the sandbox constraints
- [ ] Prompt fits within 2000 tokens to maximize output budget

**Tasks**:
1. Rewrite `src/helpers/prompts.js` with new system message:
   - Describe GaimerRuntime API surface
   - Provide code examples
   - Define output JSON schema (including sprites manifest)
   - Specify constraints (no DOM access, no global variables)
2. Update JSON schema to include:
   ```json
   {
     "title": "string",
     "description": "string",
     "sprites": [{ "id": "string", "description": "string", "frames": 1 }],
     "audio": [{ "id": "string", "description": "string" }],
     "code": "string (JavaScript using GaimerRuntime API)"
   }
   ```
3. Create prompt variants per provider (Anthropic tool_use vs OpenAI structured output)
4. Test prompts with multiple game types (platformer, shooter, puzzle, arcade)
5. Write unit tests for prompt template generation
6. Write integration test: prompt → AI → parse → validate schema

**Verification**:
- `npm run test:unit -- prompts` passes
- Generated code from all test game types validates against schema
- Generated code contains zero occurrences of `document.`, `window.`, `eval(`
- At least 5 different game types generate successfully

## Technical Constraints

- Runtime must work in WKWebView (iOS Safari engine)
- No WebGL — Canvas 2D only (broader device compatibility)
- No Web Workers for game logic (postMessage latency concerns)
- Touch controls rendered outside sandbox (overlay on parent)
- Audio requires user gesture to initialize AudioContext (iOS requirement)

## Open Questions

1. Should the runtime support a fixed-timestep physics update separate from the render loop?
   → **Proposed**: Yes, `onUpdate` runs at fixed 60Hz, `onDraw` runs at display refresh rate
2. Maximum canvas resolution on iOS?
   → **Proposed**: Cap at 1080p equivalent, use `devicePixelRatio` for sharpness
3. Should games be able to request specific controls (d-pad only, swipe only)?
   → **Proposed**: Yes, via game manifest: `"controls": "dpad+action" | "swipe" | "tap"`
