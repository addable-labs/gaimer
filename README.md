# Gaimer

AI-powered game generator. Describe a game idea in plain text and get a playable HTML5 game in seconds.

Built with [Tauri 2](https://tauri.app/) + [Vue 3](https://vuejs.org/) + [Quasar](https://quasar.dev/). Runs on macOS, Windows, Linux, and iOS.

## Features

- **AI game generation** — Describe a game, get playable JavaScript running in a sandboxed canvas
- **Multiple AI providers** — OpenAI (API key) or Anthropic Claude Code (subscription-based, no API key needed)
- **Model selection** — Choose which model to use per provider
- **Save/restore game state** — Games implement a save contract; save progress and restore on reload
- **iCloud sync** — Games stored as JSON files in iCloud Drive for cross-device access
- **Touch + keyboard** — Generated games support both input methods

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) stable
- [Yarn](https://yarnpkg.com/) 1.x

### Install

```bash
git clone https://github.com/PeterBlenessy/gaimer.git
cd gaimer
yarn install
```

### Development

```bash
yarn tauri dev
```

### Build

```bash
# macOS desktop
yarn tauri build

# iOS simulator
yarn tauri ios init
yarn tauri ios build --target aarch64-sim
```

### Tests

```bash
yarn test          # all unit tests
yarn test:coverage # with coverage report
```

## AI Providers

### OpenAI
Requires an API key. Set it in Settings after launching the app.

### Anthropic Claude Code
Uses your existing Claude Pro/Max subscription via the [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code). No API key needed.

```bash
# Install Claude Code
npm install -g @anthropic-ai/claude-code

# Authenticate
claude auth login
```

Then select "Claude" in the app's Settings.

## Game Storage

Games are stored as JSON files in `~/Library/Mobile Documents/com~apple~CloudDocs/Gaimer/` (iCloud Drive on macOS). Each game is a separate file that syncs across devices.

Existing games from IndexedDB are automatically migrated on first launch.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop runtime | Tauri 2 (Rust) |
| Frontend | Vue 3 + Quasar |
| Build tool | Vite |
| State management | Pinia |
| Game sandbox | iframe with postMessage |
| Credential storage | Tauri Stronghold (encrypted) |
| Game storage | Filesystem (iCloud Drive) |
| Testing | Vitest + Playwright |
| CI/CD | GitHub Actions |

## License

[MIT](LICENSE)
