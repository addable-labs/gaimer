# Save/Restore Game State

## Context

Gaimer generates HTML5 canvas games via AI that run in sandboxed iframes. Currently games are fire-and-forget — closing or switching loses all progress. The user wants save/restore support: pause a game, persist its state, and resume later. Since games are AI-generated with arbitrary internal state, the AI must be instructed to implement a save/restore contract via the existing postMessage protocol. Games that implement it show a save button; games that don't gracefully hide it.

---

## 1. System Prompt (`src/helpers/prompts.js`)

Add a "Save/Restore support" section requiring the AI to:

- Define `window.__gaimer_onMessage = function(msg) { ... }` handling:
  - `saveState` → collect ALL mutable state (score, level, positions, velocities, game phase) into a plain object, send via `__gaimer_sendMessage('stateData', state)`
  - `restoreState` → restore all state from `msg.data`, continue game loop
  - `pause` / `resume` → pause/resume the game loop
- Include a concrete inline example showing the pattern
- Emphasize: every `let`/`var` game variable must be in the state object
- State must be JSON-serializable (no functions, DOM refs, circular refs)

---

## 2. Sandbox Protocol (`src/engine/sandbox.js`)

Add two methods to the sandbox controller:

- **`requestSave()`** → sends `postMessage('saveState', {})`, returns a `Promise` that resolves with state data or rejects after 2s timeout. Uses a one-shot message handler for `stateData`.
- **`requestRestore(stateData)`** → sends `postMessage('restoreState', stateData)`. Fire-and-forget.

No changes to `buildSrcdoc` needed — the existing `__gaimer_onMessage` wiring already dispatches arbitrary message types to the game code.

---

## 3. Storage (`src/helpers/game-storage.js`)

Store state as separate files alongside game files:
- `{id}-{title}.state.json` next to `{id}-{title}.json`

New exports:
- `saveGameState(id, stateData)` — find game file by ID, derive `.state.json` path, write
- `loadGameState(id)` — scan for `{id}-*.state.json`, parse, return data or `null`
- `deleteGameState(id)` — remove state file if exists

Modifications:
- `deleteGame()` → also delete `.state.json`
- `listGames()` → exclude `.state.json` from game list, add `hasSavedState: boolean` field

---

## 4. UI (`src/components/GameContainer.vue`)

New state:
- `saveSupported` (boolean) — game implemented the contract
- `saving` (boolean) — save in flight
- `hasSavedState` (boolean) — state file exists

Flow after game loads and sends `ready`:
1. Probe: call `sandbox.requestSave()` — if resolves within 2s, `saveSupported = true`
2. Check: call `loadGameState(gameId)` — if data exists, `hasSavedState = true`
3. If both true: show Quasar dialog "Restore saved progress?" (Yes/No)
4. On Yes: `sandbox.requestRestore(stateData)`

Game info bar additions:
- Save button (mdi-content-save) — only visible when `saveSupported` is true
- On click: `requestSave()` → `saveGameState()` → success notification

Get `gameId` from `useAppStore().loadedGame` (computed).

---

## 5. Auto-Detection

Sequence on game ready:
1. Game sends `{ type: 'ready' }`
2. Parent sends `{ type: 'saveState' }` (probe)
3. If game responds with `{ type: 'stateData', data: ... }` within 2s → supported
4. If timeout → not supported, save button hidden

Old games (pre-prompt-change) won't have `__gaimer_onMessage` → probe times out → button hidden. Graceful degradation.

---

## 6. Implementation Order

1. `src/helpers/game-storage.js` — state file CRUD, modify deleteGame/listGames
2. `src/engine/sandbox.js` — requestSave/requestRestore methods
3. `src/helpers/prompts.js` — extend system prompt
4. `src/components/GameContainer.vue` — detection, save button, restore dialog

---

## 7. Verification

- **Old games**: Load an existing game → save button should NOT appear (probe times out)
- **New game**: Generate a new game → save button SHOULD appear after load
- **Save**: Click save → `.state.json` file appears in iCloud folder
- **Restore**: Reload the game → "Restore progress?" dialog → click Yes → game resumes from saved state
- **Delete**: Delete a game → both `.json` and `.state.json` are removed
- `yarn test` passes, `yarn tauri build` succeeds
