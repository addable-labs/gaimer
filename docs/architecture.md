# Gaimer — Architecture Description

## System Overview

Gaimer is a cross-platform application built with **Vue 3** (frontend), **Tauri 2** (native shell + Rust backend), and **AI provider integrations** (Anthropic Agent SDK primary, OpenAI secondary). The architecture follows a layered design where the frontend handles UI and game rendering, the Rust backend handles security-sensitive operations (API routing, credential storage), and AI providers are abstracted behind a unified interface.

```
┌─────────────────────────────────────────────────────────┐
│                    Tauri Native Shell                    │
│  ┌───────────────────────────────────────────────────┐  │
│  │              Vue 3 Frontend (WebView)              │  │
│  │  ┌──────────┐ ┌──────────┐ ┌───────────────────┐  │  │
│  │  │    UI    │ │  Stores  │ │  Game Runtime     │  │  │
│  │  │ (Quasar) │ │ (Pinia)  │ │  (Canvas Engine)  │  │  │
│  │  └────┬─────┘ └────┬─────┘ └────────┬──────────┘  │  │
│  │       │             │                │             │  │
│  │  ┌────┴─────────────┴────────────────┴──────────┐  │  │
│  │  │           Provider Abstraction Layer          │  │  │
│  │  │  ┌───────────┐ ┌──────────┐ ┌─────────────┐  │  │  │
│  │  │  │ Anthropic │ │  OpenAI  │ │   Ollama    │  │  │  │
│  │  │  │ (Agent SDK│ │  (REST)  │ │  (Local)    │  │  │  │
│  │  │  │  + OAuth) │ │          │ │             │  │  │  │
│  │  │  └───────────┘ └──────────┘ └─────────────┘  │  │  │
│  │  └──────────────────────┬───────────────────────┘  │  │
│  └─────────────────────────┼─────────────────────────┘  │
│                            │ Tauri IPC (invoke)          │
│  ┌─────────────────────────┼─────────────────────────┐  │
│  │              Rust Backend                          │  │
│  │  ┌──────────┐ ┌────────┴───┐ ┌─────────────────┐  │  │
│  │  │Stronghold│ │ HTTP Proxy │ │ Tauri Commands  │  │  │
│  │  │(Keychain)│ │ (API calls)│ │ (custom logic)  │  │  │
│  │  └──────────┘ └────────────┘ └─────────────────┘  │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Layer Descriptions

### 1. UI Layer (Vue 3 + Quasar)

The presentation layer handles all user interactions and visual rendering.

**Components**:
```
src/components/
├── App.vue              # Main layout shell (header, drawer, footer)
├── GameContainer.vue    # Canvas rendering + sandboxed game execution
├── GameList.vue         # Sidebar with saved games
├── Settings.vue         # Provider connection management
├── UserInput.vue        # Natural language game description input
└── Login.vue            # OAuth login flows (replaces Firebase stub)
```

**Routing**: Single-page application (no vue-router needed — all state-driven).

**Styling**: Quasar components with Sass. JetBrainsMono font family. Dark theme default.

### 2. State Management (Pinia)

Reactive stores manage all application state with persistence.

```
src/stores/
├── app-store.js         # Transient app state
│   ├── gameDescription  # Current user prompt
│   ├── loadedGame       # Currently playing game
│   ├── gameList         # All saved games
│   └── generating       # Loading state flag
│
├── provider-store.js    # AI provider configuration (NEW)
│   ├── activeProvider   # Currently selected provider
│   ├── providers[]      # Registered provider configs
│   ├── connections[]    # Active OAuth connections
│   └── routingConfig    # Which provider handles what
│
└── persisted-store.js   # User settings (persisted to localStorage)
    ├── user             # Auth user info
    └── preferences      # UI preferences
```

**Persistence strategy**:
- **Credentials/tokens**: Tauri Stronghold (encrypted, platform keychain)
- **Game data + sprites**: IndexedDB (large binary-friendly)
- **User preferences**: localStorage (simple key-value)

### 3. Provider Abstraction Layer

Inspired by the Notesage connections architecture, all AI providers implement a unified interface.

```typescript
// Provider interface contract
interface AIProvider {
  id: string;                          // 'anthropic' | 'openai' | 'ollama'
  name: string;                        // Display name
  authMethod: 'oauth' | 'apikey' | 'local';

  // Authentication
  connect(): Promise<AuthResult>;       // Initiate OAuth or API key flow
  disconnect(): Promise<void>;          // Revoke tokens
  isConnected(): boolean;

  // Game generation
  generateGame(prompt: string, options: GenOptions): AsyncGenerator<StreamChunk>;

  // Sprite generation
  generateSprite(description: string, style: SpriteStyle): Promise<SpriteResult>;

  // Capabilities
  capabilities: {
    streaming: boolean;
    imageGeneration: boolean;
    maxOutputTokens: number;
    sandboxedExecution: boolean;
  };
}
```

**Provider implementations**:

| Provider | Auth | Game Gen | Sprite Gen | Sandbox |
|----------|------|----------|------------|---------|
| Anthropic (Agent SDK) | OAuth PKCE | Claude + tool_use | Via tool_use | Yes (Agent SDK sandbox) |
| OpenAI | OAuth / API key | GPT-4o structured output | DALL-E 3 | No (iframe fallback) |
| Ollama | Local | Local LLM | Stable Diffusion (if available) | No (iframe fallback) |

### 4. Game Runtime Engine

A lightweight runtime providing the API that AI-generated game code targets.

```
src/engine/
├── runtime.js           # GaimerRuntime — main API surface
├── game-loop.js         # requestAnimationFrame loop manager
├── input.js             # Input system (touch + keyboard)
├── collision.js         # AABB + circle collision detection
├── audio.js             # Web Audio API wrapper
├── sprites.js           # Sprite loading, sheet parsing, animation
└── sandbox.js           # iframe sandbox + message passing
```

**Runtime API** (injected into game scope):

```javascript
// What AI-generated code can call:
game.canvas          // Canvas 2D context
game.width / height  // Current canvas dimensions
game.deltaTime       // Frame delta in seconds

game.onUpdate(fn)    // Register update callback
game.onDraw(fn)      // Register draw callback

game.input.isPressed('left')     // Keyboard/touch d-pad
game.input.isTapped()            // Touch tap
game.input.swipeDirection()      // Swipe gesture

game.sprites.load(id, url)       // Load sprite from blob URL
game.sprites.draw(id, x, y, w, h)
game.sprites.animate(id, frames, fps)

game.audio.playEffect(name)      // Trigger cached audio
game.collides(a, b)              // AABB collision check

game.setState(key, value)        // Persistent game state
game.getState(key)
```

**Sandbox execution model**:
```
Main App (Vue)                    Sandboxed iframe
┌──────────────┐                 ┌──────────────────┐
│              │  postMessage    │                  │
│  Load game ──┼────────────────>│  Receive code    │
│              │                 │  Inject runtime  │
│              │  postMessage    │  Execute game    │
│  Receive  <──┼────────────────│  Report state    │
│  state       │                 │                  │
│              │  postMessage    │                  │
│  Pause/    ──┼────────────────>│  Lifecycle ctrl  │
│  Resume      │                 │                  │
└──────────────┘                 └──────────────────┘
         CSP: script-src 'none' (only postMessage allowed)
```

### 5. Sprite Generation Pipeline

```
User Prompt
    │
    ├──> AI: Generate game JSON (code + asset descriptions)
    │         { "sprites": [{ "id": "player", "description": "pixel art knight" }] }
    │
    └──> For each sprite (parallel):
              │
              ├──> Image generation API call
              │    (Anthropic tool_use or DALL-E 3)
              │
              ├──> Post-process (resize, transparency)
              │
              ├──> Create blob URL
              │
              ├──> Cache in IndexedDB
              │
              └──> Notify runtime → game.sprites.load(id, blobUrl)
```

### 6. Rust Backend (Tauri)

The Rust layer handles security-sensitive operations.

```
src-tauri/src/
├── lib.rs               # Plugin initialization
├── main.rs              # Windows entry point
├── commands/
│   ├── auth.rs          # OAuth flow handling (PKCE, token exchange)
│   ├── proxy.rs         # HTTP proxy for AI API calls
│   └── storage.rs       # Stronghold credential management
└── capabilities/
    └── default.json     # Permission declarations
```

**Tauri plugins**:
- `tauri-plugin-http`: Proxied API calls to AI providers
- `tauri-plugin-stronghold`: Encrypted credential storage
- `tauri-plugin-shell`: System commands (Ollama management)
- `tauri-plugin-fs`: File system access for game export

**Security model**:
- Frontend never holds raw API tokens (Stronghold manages them)
- All external HTTP goes through Rust proxy (no `dangerouslyAllowBrowser`)
- Game code runs in CSP-restricted iframe sandbox
- OAuth tokens refresh transparently in Rust layer

### 7. Data Model

```
IndexedDB: GaimerDB
├── games (keyPath: id)
│   ├── id: number (timestamp)
│   ├── prompt: string
│   ├── content: JSON string
│   │   ├── title
│   │   ├── description
│   │   ├── rules
│   │   ├── controls
│   │   ├── code: string (game JavaScript)
│   │   ├── sprites: SpriteManifest[]  (NEW)
│   │   └── audio: AudioManifest[]     (NEW)
│   ├── provider: string               (NEW)
│   └── createdAt: ISO string          (NEW)
│
├── sprites (keyPath: id)              (NEW)
│   ├── id: string (gameId + spriteId)
│   ├── gameId: number
│   ├── blob: Blob (PNG image data)
│   ├── description: string
│   └── dimensions: { w, h }
│
└── settings (keyPath: key)            (NEW)
    ├── activeProvider
    └── preferences
```

## Data Flow: Game Generation

```
1. User types "space shooter with aliens"
   │
2. UserInput.vue → appStore.gameDescription = "..."
   │
3. App.vue watch triggers → providerStore.activeProvider
   │
4. Provider.generateGame(prompt, options)
   │   ├─ Anthropic: Agent SDK with tool_use
   │   │   └─ Tools: generate_game_code, generate_sprite
   │   └─ OpenAI: Chat completion with structured output
   │
5. Streaming response → UI shows progress
   │
6. Parse response → game JSON + sprite descriptions
   │
7. Store game in IndexedDB
   │
8. Parallel sprite generation (for each sprite)
   │   ├─ Image API call → blob
   │   └─ Cache in IndexedDB sprites store
   │
9. GameContainer.vue loads game
   │   ├─ Create sandboxed iframe
   │   ├─ Inject GaimerRuntime
   │   ├─ Post game code via postMessage
   │   └─ Runtime loads sprites from blob URLs
   │
10. Game runs! User plays on canvas
```

## Testing Architecture

```
tests/
├── unit/                        # Vitest
│   ├── providers/               # Provider interface tests
│   │   ├── anthropic.test.js
│   │   ├── openai.test.js
│   │   └── provider-interface.test.js
│   ├── engine/                  # Runtime engine tests
│   │   ├── game-loop.test.js
│   │   ├── input.test.js
│   │   ├── collision.test.js
│   │   └── sprites.test.js
│   ├── stores/                  # Pinia store tests
│   │   ├── app-store.test.js
│   │   └── provider-store.test.js
│   └── helpers/                 # Utility tests
│       ├── indexeddb.test.js
│       └── prompts.test.js
│
├── integration/                 # Vitest (longer-running)
│   ├── game-generation.test.js  # Prompt → game JSON → execution
│   ├── sprite-pipeline.test.js  # Description → image → cache
│   └── provider-auth.test.js    # OAuth flow simulation
│
├── e2e/                         # Playwright
│   ├── game-creation.spec.ts    # Full user journey
│   ├── game-library.spec.ts     # Save, load, delete games
│   ├── provider-setup.spec.ts   # Connect/disconnect providers
│   └── touch-controls.spec.ts   # Mobile interaction testing
│
└── src-tauri/src/               # Rust tests (#[cfg(test)])
    ├── commands/auth.rs          # OAuth token handling tests
    └── commands/proxy.rs         # HTTP proxy tests
```

## Key Architectural Decisions

### ADR-001: Tauri over Capacitor/Electron
**Decision**: Use Tauri 2 for native shell.
**Rationale**: Rust backend enables secure credential storage and HTTP proxying without Node.js overhead. Smaller binary size. iOS/macOS first-class support in Tauri 2.

### ADR-002: Anthropic Agent SDK as Primary Provider
**Decision**: Prioritize Anthropic's Agent SDK with OAuth over direct API key integration.
**Rationale**: Agent SDK provides sandboxed tool execution, reducing risk from AI-generated code. OAuth via existing subscriptions eliminates API key management friction. Aligns with Notesage's ACP architecture pattern.

### ADR-003: Sandboxed iframe for Game Execution
**Decision**: Execute AI-generated game code in a CSP-restricted iframe instead of `eval()`.
**Rationale**: `eval()` in the main context is a security risk (XSS, scope pollution). iframe sandbox with `postMessage` provides process-level isolation while maintaining canvas rendering performance.

### ADR-004: Provider Abstraction Interface
**Decision**: All AI providers implement a common interface with capability flags.
**Rationale**: Enables provider swapping without UI changes. Capability flags let the UI adapt (e.g., hide sprite generation if provider doesn't support images). Pattern proven in Notesage's connections architecture.

### ADR-005: TDD with Vitest + Playwright
**Decision**: Vitest for unit/integration tests, Playwright for e2e.
**Rationale**: Vitest is the fastest test runner for Vite projects with native ESM support. Playwright handles mobile viewport emulation for touch control testing. Both integrate well with CI pipelines.

## Module Dependency Graph

```
                    ┌──────────┐
                    │  App.vue │
                    └────┬─────┘
           ┌─────────────┼──────────────┐
           │             │              │
    ┌──────┴──────┐ ┌────┴────┐  ┌──────┴──────┐
    │ UserInput   │ │GameList │  │ Settings    │
    └──────┬──────┘ └────┬────┘  └──────┬──────┘
           │             │              │
           └──────┬──────┘              │
                  │                     │
           ┌──────┴──────┐      ┌───────┴───────┐
           │  app-store  │      │provider-store │
           └──────┬──────┘      └───────┬───────┘
                  │                     │
           ┌──────┴──────┐      ┌───────┴───────┐
           │   IndexedDB │      │  Providers    │
           │   (games,   │      │  (Anthropic,  │
           │    sprites) │      │   OpenAI,     │
           └─────────────┘      │   Ollama)     │
                                └───────┬───────┘
                                        │
                                ┌───────┴───────┐
                                │ Tauri Backend │
                                │ (Rust proxy,  │
                                │  Stronghold)  │
                                └───────────────┘
```
