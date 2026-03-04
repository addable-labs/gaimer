# Gaimer — Overall Improvement Plan

> Version 0.2.0 roadmap — from working prototype to iOS App Store launch.

## Vision

Turn Gaimer into a polished, App Store-ready AI game generator where users describe a game in plain language and instantly get a playable, visually rich HTML5 game — complete with real-time generated sprites — running in a sandboxed, touch-friendly runtime on iOS (and desktop).

## Current State (v0.1.0)

| Area | Status |
|------|--------|
| Core generation loop | Working — single-shot GPT-4o → canvas game |
| AI provider | Hardcoded OpenAI, API key in localStorage |
| Game runtime | Raw `eval()` of AI output, no engine abstraction |
| Sprites / visuals | None — canvas primitives only |
| iOS | Tauri 2 RC, simulator confirmed, no Xcode project committed |
| Testing | Zero — no unit, integration, or e2e tests |
| Auth | Firebase stub (empty credentials) |

## Phased Roadmap

### Phase 1 — Foundation & Safety (Weeks 1-3)

**Goal**: Establish testable architecture, fix critical bugs, upgrade platform.

| # | Task | Tracks |
|---|------|--------|
| 1.1 | Set up testing infrastructure (Vitest + Playwright) | Testing |
| 1.2 | Fix `Document.getElementById` bug in UserInput.vue | Bugfix |
| 1.3 | Upgrade Tauri from 2.0.0-rc to stable 2.x | Platform |
| 1.4 | Replace `eval()` with iframe-sandbox execution | Security |
| 1.5 | Implement provider abstraction interface | AI |
| 1.6 | Add secure credential storage via tauri-plugin-stronghold | Security |
| 1.7 | Set up CI pipeline (lint, test, build) | DevOps |

### Phase 2 — Anthropic Agent SDK Integration (Weeks 3-6)

**Goal**: Replace direct API key flow with OAuth-based Anthropic integration using Agent SDK for sandboxed game code generation.

| # | Task | Tracks |
|---|------|--------|
| 2.1 | Implement OAuth 2.0 PKCE flow for Anthropic | AI / Auth |
| 2.2 | Integrate Anthropic Agent SDK with sandboxed tool use | AI |
| 2.3 | Route AI requests through Tauri Rust backend | Security |
| 2.4 | Build provider settings UI (connect / disconnect) | Frontend |
| 2.5 | Implement streaming responses with generation progress | UX |
| 2.6 | Increase output token support (16K-128K) | AI |
| 2.7 | Add structured output / tool_use for guaranteed JSON | AI |
| 2.8 | Write unit + integration tests for provider layer | Testing |

### Phase 3 — Game Engine Runtime (Weeks 6-9)

**Goal**: Ship a lightweight runtime that AI-generated code hooks into, with touch support and lifecycle management.

| # | Task | Tracks |
|---|------|--------|
| 3.1 | Design and implement GaimerRuntime API | Engine |
| 3.2 | Implement touch input system (virtual d-pad, gestures) | Engine / iOS |
| 3.3 | Add game loop abstraction (RAF-based) | Engine |
| 3.4 | Implement collision detection helpers | Engine |
| 3.5 | Add game lifecycle (pause/resume on app background) | Engine / iOS |
| 3.6 | Handle canvas resize + orientation changes | Engine / iOS |
| 3.7 | Add Web Audio API support for sound effects | Engine |
| 3.8 | Update AI system prompt to target runtime API | AI |
| 3.9 | Write runtime unit tests + game execution tests | Testing |

### Phase 4 — Real-Time Sprite Generation (Weeks 9-12)

**Goal**: Generate visual game assets (characters, enemies, items, backgrounds) alongside game code.

| # | Task | Tracks |
|---|------|--------|
| 4.1 | Design sprite generation pipeline architecture | Sprites |
| 4.2 | Integrate image generation API (Anthropic vision or DALL-E) | Sprites / AI |
| 4.3 | Build asset loading system (Image + blob URLs) | Sprites / Engine |
| 4.4 | Implement sprite sheet composition + atlas generation | Sprites |
| 4.5 | Add sprite caching in IndexedDB | Sprites / Storage |
| 4.6 | Build sprite animation frame system | Sprites / Engine |
| 4.7 | Update system prompt for sprite-aware code generation | AI |
| 4.8 | Progressive sprite loading UX | Sprites / UX |
| 4.9 | Write sprite pipeline tests | Testing |

### Phase 5 — iOS Polish & App Store (Weeks 12-15)

**Goal**: Ship to the App Store with all platform requirements met.

| # | Task | Tracks |
|---|------|--------|
| 5.1 | Run `tauri ios init`, configure Xcode project | Platform |
| 5.2 | Generate full iOS icon set (1024×1024 + variants) | Platform |
| 5.3 | Implement safe area / notch handling | Platform / UX |
| 5.4 | iOS keyboard management (show/hide + canvas) | Platform / UX |
| 5.5 | Add haptic feedback for touch controls | Platform / UX |
| 5.6 | Set Content Security Policy | Security |
| 5.7 | Performance testing on older iOS devices | QA |
| 5.8 | Memory leak audit (game switching cleanup) | QA |
| 5.9 | App Store metadata, screenshots, privacy policy | Launch |
| 5.10 | Remove or complete Firebase auth (currently stub) | Cleanup |
| 5.11 | E2e test suite with Playwright | Testing |
| 5.12 | Submit to App Store | Launch |

## Cross-Cutting Concerns

### Testing (TDD throughout all phases)

- **Unit tests** (Vitest): Provider abstraction, runtime API, sprite pipeline, stores, helpers
- **Component tests** (Vitest + Vue Test Utils): All Vue components
- **Integration tests** (Vitest): AI provider → game generation → execution flow
- **E2E tests** (Playwright): Full user journeys on web target
- **Backend tests** (Rust `#[cfg(test)]`): Tauri command handlers, HTTP routing

Tests are written **before** implementation for each task (red-green-refactor).

### Security

- All AI API calls routed through Tauri Rust backend (no browser-direct)
- OAuth tokens stored in platform keychain via Stronghold
- Game code executed in sandboxed iframe (CSP-restricted)
- Content Security Policy enforced in tauri.conf.json

### Architecture Principles

- **Provider-agnostic**: AI provider interface allows swapping/adding providers
- **Runtime-first**: Games target a stable runtime API, not raw canvas
- **Offline-capable**: Generated games + sprites cached in IndexedDB
- **Mobile-first**: Touch input as primary, keyboard as secondary

## Dependencies & Risks

| Risk | Mitigation |
|------|------------|
| Anthropic OAuth not yet GA for consumer apps | Start with API key fallback, design for OAuth swap-in |
| Agent SDK sandboxing may not match game execution needs | Prototype early in Phase 2, fallback to iframe sandbox |
| Sprite generation latency (2-10s per image) | Parallel generation, progressive loading, caching |
| Tauri 2 iOS maturity | Track upstream releases, contribute bug reports |
| App Store review for AI-generated content | Add content moderation, clear AI disclosure |

## Success Metrics

- Time from description to playable game: < 30 seconds
- Touch input responsiveness: < 16ms (60 FPS)
- App Store approval on first submission
- Test coverage: > 80% on business logic, > 60% overall
- Zero API keys stored in plaintext
