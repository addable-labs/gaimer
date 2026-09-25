# PRD: Testing Strategy

**Status on 2026-09-25: Partly built.** This is the plan as written on 2026-03-04, when Gaimer had no tests. What exists now is described in [architecture.md](../architecture.md#tests).

- R1, infrastructure: Vitest is set up with Vue Test Utils, happy-dom and v8 coverage. There is no Playwright, and no `test:integration` or `test:e2e` script.
- R2 to R4, unit, store and component tests: built, in `tests/unit/`, for the modules that exist. The planned tests of the runtime modules (collision, input, game loop, audio), sprites, IndexedDB and the provider store do not apply: those modules do not exist.
- R5, integration tests, and R6, Playwright tests: not built.
- R7, Rust tests: the keychain commands in `src-tauri/src/credentials.rs` have tests. The proxy, OAuth and storage commands they were planned for do not exist.
- R8, CI: `.github/workflows/ci.yml` runs `yarn test:coverage`, then the builds, and on Linux `cargo fmt --check`, clippy and `cargo test`. There is no JavaScript lint and no coverage artifact.
- Coverage: the [targets below](#test-coverage-targets) are not what is set. `vitest.config.js` sets one floor for all of `src/` but `src/main.js`: statements 94%, branches 89%, functions 90%, lines 96%. `yarn test:coverage` fails below it, and so does CI. There is no floor per module, and none for the Rust code.

> Feature: Comprehensive TDD-based testing infrastructure with Vitest (unit/integration), Vue Test Utils (component), Playwright (e2e), and Rust `#[cfg(test)]` (backend).

## Problem Statement

Gaimer has zero tests. No unit tests, no component tests, no integration tests, no e2e tests, no backend tests. The `package.json` has no test script. There is no test framework configured. This makes every change a risk — there's no safety net to catch regressions, no way to verify behavior, and no confidence in refactoring.

As Gaimer grows from prototype to production app with sandboxed execution, multi-provider AI, sprite generation, and iOS deployment, a robust test suite is essential for maintaining quality and velocity.

## Goals

1. Establish TDD workflow: tests written before implementation for all new features
2. Unit test coverage for all business logic (providers, engine, helpers, stores)
3. Component test coverage for all Vue components
4. Integration tests for cross-module flows (generation pipeline, sprite pipeline)
5. E2E tests for critical user journeys via Playwright
6. Backend tests for Tauri Rust commands
7. CI pipeline that runs all tests on every PR

## Non-Goals

- 100% code coverage (target 80% on business logic, 60% overall)
- Visual regression testing (future enhancement)
- Performance benchmarking automation (manual for now)
- Testing on real iOS devices in CI (simulator only)

## Testing Pyramid

```
                    ┌──────────┐
                    │   E2E    │  Playwright (5-10 tests)
                    │ (slow)   │  Full user journeys
                   ┌┴──────────┴┐
                   │ Integration │  Vitest (15-25 tests)
                   │  (medium)   │  Cross-module flows
                  ┌┴────────────┴┐
                  │  Component    │  Vitest + Vue Test Utils (20-30 tests)
                  │  (fast)       │  Vue component behavior
                 ┌┴──────────────┴┐
                 │    Unit Tests   │  Vitest (50-80 tests)
                 │    (fastest)    │  Individual functions/classes
                ┌┴────────────────┴┐
                │   Rust Backend    │  cargo test (10-20 tests)
                │   (compiled)      │  Tauri commands
                └──────────────────┘
```

## Requirements

### R1: Test Infrastructure Setup

**Description**: Configure Vitest, Vue Test Utils, and Playwright in the project.

**Acceptance Criteria**:
- [ ] Vitest configured with Vue plugin and Quasar support
- [ ] Vue Test Utils available for component mounting
- [ ] Playwright configured with mobile viewport presets
- [ ] Test scripts in `package.json`: `test`, `test:unit`, `test:integration`, `test:e2e`, `test:coverage`
- [ ] Tests run in under 30 seconds (unit) / 2 minutes (e2e)
- [ ] Coverage reporting configured (Istanbul/v8)
- [ ] CI configuration (GitHub Actions) runs all tests

**Tasks**:
1. Install dev dependencies:
   ```bash
   yarn add -D vitest @vue/test-utils happy-dom @vitest/coverage-v8
   yarn add -D @playwright/test
   yarn add -D fake-indexeddb  # For IndexedDB mocking
   ```
2. Create `vitest.config.js`:
   ```javascript
   import { defineConfig } from 'vitest/config'
   import vue from '@vitejs/plugin-vue'

   export default defineConfig({
     plugins: [vue()],
     test: {
       environment: 'happy-dom',
       globals: true,
       include: ['tests/unit/**/*.test.js', 'tests/integration/**/*.test.js'],
       coverage: {
         provider: 'v8',
         reporter: ['text', 'lcov'],
         include: ['src/**/*.{js,vue}'],
         exclude: ['src/main.js']
       },
       setupFiles: ['tests/setup.js']
     }
   })
   ```
3. Create `playwright.config.ts`:
   ```typescript
   import { defineConfig, devices } from '@playwright/test'

   export default defineConfig({
     testDir: './tests/e2e',
     timeout: 30000,
     use: {
       baseURL: 'http://localhost:1420',
     },
     projects: [
       { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
       { name: 'mobile-safari', use: { ...devices['iPhone 15'] } },
       { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
     ],
     webServer: {
       command: 'yarn dev',
       port: 1420,
       reuseExistingServer: true,
     }
   })
   ```
4. Create `tests/setup.js` for global test utilities:
   - Mock `@tauri-apps/api` (invoke, event listeners)
   - Mock `localStorage`
   - Setup `fake-indexeddb`
   - Provide Pinia test helpers
5. Add scripts to `package.json`:
   ```json
   {
     "test": "vitest run",
     "test:unit": "vitest run tests/unit",
     "test:integration": "vitest run tests/integration",
     "test:e2e": "playwright test",
     "test:coverage": "vitest run --coverage",
     "test:watch": "vitest watch"
   }
   ```
6. Create `.github/workflows/test.yml` CI workflow:
   - Run on push and PR
   - Steps: install → lint → test:unit → test:integration → test:e2e → coverage
7. Create directory structure:
   ```
   tests/
   ├── setup.js
   ├── mocks/
   │   ├── tauri.js         # Mock @tauri-apps/api
   │   ├── indexeddb.js      # fake-indexeddb setup
   │   └── providers.js      # Mock AI providers
   ├── unit/
   ├── integration/
   └── e2e/
   ```
8. Write a "smoke test" that verifies the setup works

**Verification**:
- `yarn test:unit` runs and passes (smoke test)
- `yarn test:e2e` runs Playwright against dev server
- `yarn test:coverage` produces coverage report
- CI pipeline runs successfully on a test PR

---

### R2: Unit Tests — Helpers & Utilities

**Description**: Unit tests for all helper modules and utility functions.

**Acceptance Criteria**:
- [ ] IndexedDB helper: all CRUD operations tested with fake-indexeddb
- [ ] Prompt builder: template generation tested for each game type
- [ ] Logger: output formatting tested
- [ ] Provider registry: register, get, list, remove tested
- [ ] Collision detection: AABB, circle, point-in-rect tested
- [ ] Input mapping: keyboard and touch events mapped correctly
- [ ] Each test file mirrors the source file path

**Tasks & Test Cases**:

#### `tests/unit/helpers/indexeddb.test.js`
1. `initDB()` creates database with correct version and stores
2. `addItem(item)` stores item and returns ID
3. `getItem(id)` retrieves stored item
4. `putItem(id, item)` updates existing item
5. `listItems()` returns all items sorted by ID
6. `deleteItem(id)` removes item and subsequent `getItem` returns null
7. Concurrent operations don't corrupt data
8. DB version migration from v21 to v22 preserves data

#### `tests/unit/helpers/prompts.test.js`
1. System prompt includes GaimerRuntime API reference
2. System prompt includes sprite manifest schema
3. System prompt fits within 2000 tokens
4. Prompt variants differ by provider (Anthropic vs OpenAI)
5. Generated prompts include game description verbatim

#### `tests/unit/engine/collision.test.js`
1. `collides()`: overlapping AABBs return true
2. `collides()`: non-overlapping AABBs return false
3. `collides()`: edge-touching AABBs return true (inclusive)
4. `circleCollides()`: overlapping circles return true
5. `circleCollides()`: non-overlapping circles return false
6. `pointInRect()`: point inside returns true
7. `pointInRect()`: point outside returns false
8. `pointInRect()`: point on edge returns true

#### `tests/unit/engine/input.test.js`
1. `isPressed('left')` returns true when left arrow held
2. `isPressed('left')` returns true when d-pad left touched
3. `isJustPressed('action')` returns true only on first frame
4. `swipeDirection()` returns correct direction for swipe gestures
5. `isTapped()` returns true for quick touch-and-release
6. No input reported when no events occur

#### `tests/unit/providers/registry.test.js`
1. `register(provider)` adds provider to registry
2. `get(id)` returns registered provider
3. `get(unknownId)` returns null
4. `list()` returns all registered providers
5. `setActive(id)` switches active provider
6. `getActive()` returns currently active provider

**Verification**:
- `yarn test:unit -- helpers engine providers` passes
- Each module has > 80% line coverage
- Tests run in < 5 seconds total

---

### R3: Unit Tests — Pinia Stores

**Description**: Test all Pinia stores in isolation with proper test helpers.

**Acceptance Criteria**:
- [ ] App store: gameDescription, loadedGame, gameList state management tested
- [ ] Provider store: connection management, active provider switching tested
- [ ] Persisted store: localStorage sync and hydration tested
- [ ] Store actions that trigger side effects are tested with mocks

**Tasks & Test Cases**:

#### `tests/unit/stores/app-store.test.js`
1. Initial state has empty gameDescription, null loadedGame, empty gameList
2. Setting gameDescription triggers reactive update
3. Setting loadedGame populates game data
4. Adding to gameList updates array reactively
5. Removing from gameList filters correctly
6. `generating` flag toggles correctly

#### `tests/unit/stores/provider-store.test.js`
1. Initial state has no active provider
2. `connect(providerId)` creates connection entry
3. `disconnect(providerId)` removes connection
4. `setActive(providerId)` updates activeProvider
5. `isConnected(providerId)` returns correct boolean
6. Active provider persists to localStorage
7. Store hydrates from localStorage on init

#### `tests/unit/stores/persisted-store.test.js`
1. API key saved to localStorage on change
2. API key loaded from localStorage on init
3. User data persists across store re-creation
4. Missing localStorage key uses default value
5. Invalid localStorage data handled gracefully

**Verification**:
- `yarn test:unit -- stores` passes
- All store state transitions covered
- localStorage interactions verified with mocks

---

### R4: Component Tests

**Description**: Test Vue components with Vue Test Utils, verifying rendering, user interactions, and emitted events.

**Acceptance Criteria**:
- [ ] All components mounted without errors
- [ ] User interactions (click, type, submit) trigger expected behavior
- [ ] Component props and emitted events tested
- [ ] Loading and error states tested
- [ ] Quasar components properly stubbed/configured

**Tasks & Test Cases**:

#### `tests/unit/components/UserInput.test.js`
1. Renders textarea with placeholder "Describe your game..."
2. Typing updates the character counter
3. Cmd+Enter triggers handleUserInput
4. Send button click triggers handleUserInput
5. Empty input is rejected (no emit)
6. Input is trimmed before submission
7. Loading spinner shown when `generating` is true
8. Input disabled when `generating` is true

#### `tests/unit/components/GameContainer.test.js`
1. Renders canvas element when game is loaded
2. Creates sandbox iframe (not eval)
3. Sends game code to sandbox via postMessage
4. Handles 'ready' message from sandbox
5. Handles 'error' message from sandbox
6. Cleanup destroys iframe on game switch
7. Pause/resume messages forwarded on visibility change

#### `tests/unit/components/GameList.test.js`
1. Renders empty state when no games
2. Renders game titles from gameList
3. Click on game title emits 'loadGame' with ID
4. Delete button removes game from list
5. Tooltip shows game description on hover
6. Games loaded from IndexedDB on mount

#### `tests/unit/components/Settings.test.js`
1. Dialog opens when triggered
2. Shows list of available providers
3. Connected providers show "Connected" status
4. "Connect" button triggers OAuth flow
5. "Disconnect" button shows confirmation
6. Active provider indicator displayed

#### `tests/unit/components/GenerationProgress.test.js`
1. Shows "Generating..." when stream starts
2. Displays title as soon as it appears in stream
3. Shows sprite generation progress (3/8)
4. Cancel button stops generation
5. Error state shows retry button
6. Transitions to game view on completion

#### `tests/unit/components/SpriteProgress.test.js`
1. Shows empty grid for pending sprites
2. Updates thumbnails as sprites complete
3. Progress counter updates correctly
4. "Skip" button starts game with placeholders
5. "Regenerate" button triggers re-generation for single sprite

**Verification**:
- `yarn test:unit -- components` passes
- All components render without console errors
- User interaction flows tested end-to-end within component

---

### R5: Integration Tests

**Description**: Test cross-module flows that span multiple units working together.

**Acceptance Criteria**:
- [ ] Game generation flow: prompt → provider → parse → store → display
- [ ] Sprite pipeline flow: manifest → parallel generation → cache → load
- [ ] Provider auth flow: connect → OAuth mock → store token → verify
- [ ] Game lifecycle flow: load → play → pause → resume → switch → cleanup
- [ ] Integration tests use mocked external APIs (no real AI calls)

**Tasks & Test Cases**:

#### `tests/integration/game-generation.test.js`
1. Full generation flow: set description → provider generates → JSON parsed → stored in IndexedDB → loadedGame updated
2. Streaming flow: chunks arrive → partial JSON visible → complete → game loads
3. Error handling: provider returns error → error state shown → user can retry
4. Invalid JSON from provider → error handled gracefully → fallback message shown
5. Cancel mid-generation → generation stopped → clean state

#### `tests/integration/sprite-pipeline.test.js`
1. Sprite manifest → parallel generation (3 concurrent) → all complete
2. Partial failure: 2/5 sprites fail → game loads with 3 sprites + 2 placeholders
3. Cache hit: second load of same game → 0 API calls → sprites from IndexedDB
4. Game deletion → sprites deleted from cache
5. Progressive loading: game playable before all sprites complete

#### `tests/integration/provider-auth.test.js`
1. Anthropic OAuth: initiate → redirect → callback → token stored in Stronghold
2. Token refresh: expired token → auto-refresh → request succeeds
3. Disconnect: revoke → clear Stronghold → UI shows disconnected
4. Multiple providers: connect Anthropic + OpenAI → switch active → correct one used
5. Auth failure: invalid code → error → user prompted to retry

#### `tests/integration/game-lifecycle.test.js`
1. Load game → sandbox created → runtime injected → game runs
2. Visibility hidden → pause message → game loop stops
3. Visibility visible → resume message → game loop resumes
4. Switch game → old sandbox destroyed → new sandbox created → no leaks
5. Orientation change → resize message → canvas dimensions updated

**Verification**:
- `yarn test:integration` passes
- Tests run in < 30 seconds (all mocked, no real API calls)
- Each integration test covers a complete user-meaningful flow

---

### R6: E2E Tests (Playwright)

**Description**: End-to-end tests that exercise the full app through the browser, simulating real user behavior.

**Acceptance Criteria**:
- [ ] Tests run against the Vite dev server (web target)
- [ ] Mobile viewport tested (iPhone 15 emulation)
- [ ] Desktop viewport tested
- [ ] Tests handle async operations (generation, loading)
- [ ] Tests are stable and not flaky (< 1% flake rate)

**Tasks & Test Cases**:

#### `tests/e2e/game-creation.spec.ts`
1. User opens app → sees input field and empty game area
2. User types game description → character counter updates
3. User submits → generation progress shown → game appears
4. Generated game canvas is interactive (click/touch produces response)
5. Game appears in sidebar game list after generation

#### `tests/e2e/game-library.spec.ts`
1. Generated game appears in sidebar
2. Click on game in sidebar → game loads in main area
3. Game info tooltip shows description
4. Delete game → confirmation → game removed from list
5. App reload → games persist (IndexedDB)

#### `tests/e2e/provider-setup.spec.ts`
1. Open settings → provider list visible
2. Click "Connect" on Anthropic → OAuth redirect initiated
3. After mock auth → provider shows "Connected"
4. Switch active provider → indicator updates
5. Disconnect → confirmation → status shows "Disconnected"

#### `tests/e2e/touch-controls.spec.ts` (mobile viewport)
1. Game running → virtual d-pad visible
2. Touch d-pad left → game character moves left
3. Touch action button → game action triggered
4. Swipe gesture → detected and processed
5. Tap outside controls → registered as tap event

#### `tests/e2e/responsive-layout.spec.ts`
1. Mobile viewport: header, game area, and input visible
2. Mobile viewport: drawer opens on menu tap
3. Desktop viewport: drawer visible by default
4. Orientation change: layout adjusts without breaking
5. Keyboard open: input remains visible

**Verification**:
- `yarn test:e2e` passes on all 3 viewport configurations
- Tests complete in < 2 minutes total
- No tests depend on external AI API availability
- Screenshots captured on failure for debugging

---

### R7: Rust Backend Tests

**Description**: Unit tests for Tauri Rust commands using `#[cfg(test)]`.

**Acceptance Criteria**:
- [ ] HTTP proxy command tested (request forwarding, header injection)
- [ ] OAuth token exchange tested (mock HTTP responses)
- [ ] Stronghold operations tested (store, retrieve, delete credentials)
- [ ] Error handling tested (network failures, invalid tokens)

**Tasks & Test Cases**:

#### `src-tauri/src/commands/proxy.rs` tests
1. `proxy_ai_request` forwards body to correct provider URL
2. Auth header injected from Stronghold
3. Streaming response emits correct events
4. 401 response triggers token refresh
5. 429 response returns retry-after header
6. Network error returns descriptive error message

#### `src-tauri/src/commands/auth.rs` tests
1. PKCE code_verifier is 43-128 characters, URL-safe
2. code_challenge is SHA256(code_verifier) base64url-encoded
3. Token exchange sends correct parameters
4. Access token stored in Stronghold after exchange
5. Refresh token flow exchanges refresh token for new access token
6. Revoke clears all tokens from Stronghold

#### `src-tauri/src/commands/storage.rs` tests
1. Store credential → retrieve returns same value
2. Delete credential → retrieve returns None
3. Overwrite credential → retrieve returns new value
4. Non-existent key → retrieve returns None

**Verification**:
- `cargo test` passes in `src-tauri/`
- All Rust commands have tests for happy path and error cases
- Tests run in < 10 seconds

---

### R8: CI Pipeline

**Description**: GitHub Actions workflow that runs all tests on every push and PR.

**Acceptance Criteria**:
- [ ] Workflow triggers on push to main and all PR branches
- [ ] Steps: install → lint → unit tests → integration tests → e2e tests → coverage
- [ ] Rust tests run as separate job
- [ ] Coverage report uploaded as artifact
- [ ] PR blocked if tests fail
- [ ] Total CI time < 10 minutes

**Tasks**:
1. Create `.github/workflows/test.yml`:
   ```yaml
   name: Test
   on: [push, pull_request]

   jobs:
     frontend-tests:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with: { node-version: 20 }
         - run: yarn install --frozen-lockfile
         - run: yarn test:unit
         - run: yarn test:integration
         - run: npx playwright install --with-deps
         - run: yarn test:e2e
         - run: yarn test:coverage
         - uses: actions/upload-artifact@v4
           with: { name: coverage, path: coverage/ }

     backend-tests:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: dtolnay/rust-toolchain@stable
         - run: cd src-tauri && cargo test
   ```
2. Configure branch protection rules (require tests to pass)
3. Add coverage badge to README

**Verification**:
- CI runs on test PR without errors
- All test stages pass
- Coverage report accessible as artifact
- Failed tests block PR merge

## TDD Workflow

For every new feature or bugfix:

```
1. Write failing test(s) that describe the expected behavior    [RED]
2. Run tests — confirm they fail for the right reason           [RED]
3. Write the minimum code to make tests pass                    [GREEN]
4. Run tests — confirm they pass                                [GREEN]
5. Refactor code while keeping tests green                      [REFACTOR]
6. Commit: "test: add tests for X" + "feat: implement X"
```

### What to test first (by priority)

1. **Helpers/utilities**: Pure functions, easy to test, high value
2. **Engine modules**: Collision, input, game loop — well-defined contracts
3. **Pinia stores**: State transitions, persistence, actions
4. **Provider abstraction**: Interface compliance, error handling
5. **Vue components**: User interactions, rendering, events
6. **Integration flows**: Generation pipeline, sprite pipeline
7. **E2E journeys**: Critical user paths
8. **Rust backend**: Commands, proxy, auth

## Test Coverage Targets

| Module | Target | Rationale |
|--------|--------|-----------|
| `src/helpers/` | 90% | Pure utility functions, easy to cover |
| `src/engine/` | 85% | Core game logic, high regression risk |
| `src/providers/` | 80% | Provider contracts must be reliable |
| `src/stores/` | 80% | State management drives the app |
| `src/components/` | 60% | UI rendering harder to test exhaustively |
| `src/sprites/` | 75% | Pipeline orchestration needs coverage |
| `src-tauri/src/` | 70% | Backend commands, auth, proxy |
| **Overall** | **65%** | Balanced across all modules |

## Mock Strategy

| External Dependency | Mock Approach |
|---------------------|---------------|
| Tauri invoke (`@tauri-apps/api`) | Vi.mock with custom responses |
| IndexedDB | `fake-indexeddb` package |
| localStorage | Vi.stubGlobal |
| Anthropic Agent SDK | Vi.mock with streaming fixture data |
| OpenAI SDK | Vi.mock with fixture JSON responses |
| DALL-E / Image APIs | Vi.mock returning test PNG blobs |
| Canvas API | happy-dom provides basic canvas mock |
| Touch events | Playwright touch emulation (e2e) |
| iOS-specific APIs | Vi.mock (haptics, safe areas) |

## File Structure

```
tests/
├── setup.js                      # Global test setup
├── fixtures/
│   ├── game-response.json        # Sample AI game generation response
│   ├── sprite-manifest.json      # Sample sprite manifest
│   ├── test-sprite.png           # 64x64 test sprite image
│   └── stream-chunks.json        # Sample streaming response chunks
├── mocks/
│   ├── tauri.js                  # Mock @tauri-apps/api
│   ├── indexeddb.js              # fake-indexeddb setup
│   ├── providers.js              # Mock AI provider implementations
│   └── canvas.js                 # Canvas context mock extensions
├── unit/
│   ├── helpers/
│   │   ├── indexeddb.test.js
│   │   ├── prompts.test.js
│   │   └── logger.test.js
│   ├── engine/
│   │   ├── collision.test.js
│   │   ├── input.test.js
│   │   ├── game-loop.test.js
│   │   ├── sprites.test.js
│   │   ├── audio.test.js
│   │   └── sandbox.test.js
│   ├── providers/
│   │   ├── registry.test.js
│   │   ├── anthropic.test.js
│   │   └── openai.test.js
│   ├── stores/
│   │   ├── app-store.test.js
│   │   ├── provider-store.test.js
│   │   └── persisted-store.test.js
│   ├── components/
│   │   ├── UserInput.test.js
│   │   ├── GameContainer.test.js
│   │   ├── GameList.test.js
│   │   ├── Settings.test.js
│   │   ├── GenerationProgress.test.js
│   │   └── SpriteProgress.test.js
│   └── sprites/
│       ├── pipeline.test.js
│       ├── cache.test.js
│       └── prompt-builder.test.js
├── integration/
│   ├── game-generation.test.js
│   ├── sprite-pipeline.test.js
│   ├── provider-auth.test.js
│   └── game-lifecycle.test.js
└── e2e/
    ├── game-creation.spec.ts
    ├── game-library.spec.ts
    ├── provider-setup.spec.ts
    ├── touch-controls.spec.ts
    └── responsive-layout.spec.ts
```
