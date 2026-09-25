# Gaimer — Product Description

**Status on 2026-09-25: Partly built.** This describes the product as planned on 2026-03-04. What the code does now is in [architecture.md](architecture.md).

- Built: generating a game from a description, with OpenAI (the user's API key) or Claude (the user's Claude CLI); changing the open game with a follow-up request, and going back to its earlier versions; games that run in a sandboxed canvas and are asked to pause while the app is hidden; a game library in the drawer, kept as JSON files.
- Not built: sprites and other generated art, haptics, an engine with physics and collision, sharing, and local models.
- Sound and touch controls are left to each game: the system message asks for short sound effects made in code with the Web Audio API, where they fit, and for touch buttons drawn on the canvas, or gestures. The app itself has no sound or music, and no virtual controls or gesture recognition for games.
- The Technology Stack table is out of date: the app uses Vite 8, the Claude CLI rather than the Agent SDK with OAuth, JSON files rather than IndexedDB, and the system keychain rather than Stronghold, and it has no Playwright tests.
- Platforms: CI builds for macOS, Windows, Linux and the iOS simulator. The Claude provider works on macOS, and on Linux with zsh installed, but not on Windows or iOS.

## What is Gaimer?

Gaimer is an AI-powered game creation platform that lets anyone describe a game in plain language and instantly play it. No coding required. No game development experience needed. Just describe what you want — "a space shooter where you dodge asteroids and collect power-ups" — and Gaimer generates a fully playable HTML5 game with custom-generated sprite art, sound effects, and touch-friendly controls.

## Target Users

### Primary: Creative Mobile Gamers (Ages 13-35)
People who have game ideas but lack the technical skills to build them. They want to see their ideas come alive instantly on their phone.

### Secondary: Educators & Parents
Using Gaimer as a teaching tool — describe a math game, a history quiz, or a science simulation and get an interactive experience immediately.

### Tertiary: Game Designers & Hobbyists
Rapid prototyping of game concepts before investing in full development.

## Core Value Proposition

**"Describe it. Play it. Share it."**

1. **Zero friction**: Connect your existing AI subscription (Anthropic, OpenAI) — no separate API keys to manage
2. **Instant gratification**: Games generate in under 30 seconds
3. **Visually rich**: AI-generated sprites and artwork — not just colored rectangles
4. **Touch-native**: Built for mobile with virtual controls, gestures, and haptics
5. **Your library**: Games are saved locally and playable offline

## Key Features

### AI Game Generation
- Describe any 2D game concept in natural language
- AI generates complete game code + visual assets
- Iterative refinement: "make the enemies faster" or "add a boss fight"
- Multiple AI providers via existing user subscriptions

### Sandboxed Game Runtime
- Lightweight HTML5 Canvas game engine
- Built-in physics, collision detection, and game loop
- Touch input with virtual d-pad and gesture recognition
- Audio support for sound effects and background music
- Automatic pause/resume on app lifecycle events

### Real-Time Sprite Generation
- AI generates custom characters, enemies, items, and backgrounds
- Sprite sheet composition with animation frames
- Progressive loading — play while assets are still generating
- Cached locally for instant replay

### AI Provider Integration
- **Anthropic Claude** (primary) — via Agent SDK with OAuth
- **OpenAI** — via API with OAuth or API key
- **Local models** (future) — via Ollama for offline generation
- Users connect their existing subscriptions — no extra cost from Gaimer

### Game Library
- All generated games saved to device (IndexedDB)
- Browse, replay, and delete from sidebar
- Game metadata: title, description, rules, controls
- Future: share games with other users

## Platform Support

| Platform | Framework | Status |
|----------|-----------|--------|
| iOS | Tauri 2 + WKWebView | Primary target |
| macOS | Tauri 2 native | Supported |
| Web | Vite PWA | Future |
| Windows | Tauri 2 native | Supported |
| Android | Tauri 2 | Future |

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | Vue 3 + Quasar (Material Design) |
| State | Pinia (reactive stores) |
| Build | Vite 5 |
| Native wrapper | Tauri 2 (Rust backend) |
| AI (primary) | Anthropic Agent SDK + Claude |
| AI (secondary) | OpenAI SDK |
| Storage | IndexedDB (games + sprites) |
| Secure storage | tauri-plugin-stronghold (tokens/keys) |
| Testing | Vitest (unit) + Playwright (e2e) |

## Competitive Landscape

| Product | Approach | Gaimer Differentiator |
|---------|----------|-----------------------|
| ChatGPT artifacts | Text-based game code in chat | Native app, touch controls, sprite art |
| Claude artifacts | Similar to ChatGPT | Dedicated game runtime, mobile-first |
| GameMaker AI | Traditional engine + AI assist | Zero-code, instant results |
| Roblox Studio | Full development environment | Describe & play, no learning curve |

## Revenue Model (Future)

Gaimer is **free to use** — users bring their own AI subscriptions. Future monetization options:
- Premium game templates
- Community game sharing marketplace
- Gaimer Pro: bundled AI credits for users without subscriptions

## Design Principles

1. **Mobile-first**: Every interaction designed for touch, then adapted for desktop
2. **Instant feedback**: Show progress during generation, never leave the user waiting with no feedback
3. **Safe by default**: All AI code runs in a sandbox, all credentials in secure storage
4. **Offline-capable**: Once generated, games work without a network connection
5. **Provider-agnostic**: Never lock users into a single AI provider
