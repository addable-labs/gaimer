# Gaimer

AI-powered game generator. Describe a game idea in plain text and get a playable HTML5 game.

Built with [Tauri 2](https://tauri.app/) + [Vue 3](https://vuejs.org/) + [Quasar](https://quasar.dev/). CI builds it for macOS, Windows, Linux and the iOS simulator. The Claude provider runs the Claude CLI through `/bin/zsh`, so it works on macOS, and on Linux with zsh installed, but not on Windows or iOS.

## Features

- **AI game generation** — Describe a game, get playable JavaScript running in a sandboxed canvas
- **Change a game** — With a game open, describe a change and get the changed game; Undo change goes back to earlier versions, and New game starts a new one
- **Automatic fix** — A new or changed game that fails as it starts goes back once, with its error, to the model that wrote it
- **Multiple AI providers** — OpenAI (API key) or Anthropic Claude Code (subscription-based, no API key needed)
- **Model selection** — Choose which model to use per provider
- **Effort level** — With Claude, choose how long Claude thinks: Low (the default), Medium or High; with sonnet, the default model, a game usually takes about a minute, 1–5 minutes or 3–8 minutes
- **Save/restore game state** — Games implement a save contract; save progress and restore on reload
- **iCloud sync (macOS)** — Games are stored as JSON files in iCloud Drive, so they sync to your other Macs
- **Touch + keyboard** — Generated games support both input methods. Keys go to a game as soon as it starts, when you click it, and when you return to Gaimer. While you type in the box or a dialog is open, they stay there until you click the game.
- **Controls and rules** — The buttons below a game show its controls and its rules in a panel that stays until you close it, while the game waits

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 22 (22.22.2 or later), 24 (24.15 or later) or 26+
- [Rust](https://rustup.rs/) stable
- [Yarn](https://yarnpkg.com/) 1.x
- For iOS: Xcode and XcodeGen (`brew install xcodegen`)

### Install

```bash
git clone https://github.com/addable-labs/gaimer.git
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

cd src-tauri && cargo test   # Rust tests
```

`yarn test:coverage` fails when coverage drops below the floor set in `vitest.config.js`. CI runs it, so such a change fails CI.

## AI Providers

### OpenAI
Requires an API key. Set it in Settings after launching the app. The app keeps the key in the system keychain (Keychain Services on macOS and iOS, Credential Manager on Windows, Secret Service on Linux), which protects it as it protects your other passwords. The app's window reads the key and calls `api.openai.com` with it directly. If the keychain cannot be reached (on Linux, when no Secret Service runs), Settings says so, and the key works only until the app quits.

### Anthropic Claude Code
Uses your existing Claude Pro/Max subscription via the [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code). No API key needed. Needs Claude Code 2.1.169 or later.

```bash
# Install Claude Code
npm install -g @anthropic-ai/claude-code

# Authenticate
claude auth login
```

Then select "Claude" in the app's Settings.

## Game Storage

Games are stored as JSON files in `~/Library/Mobile Documents/com~apple~CloudDocs/Gaimer/`, one file per game, and a `.state.json` file next to it once the game's progress is saved. On macOS that folder is iCloud Drive, which syncs it to your other Macs. The other platforms use the same path in the home folder, which iCloud does not sync (on iOS the home folder is the app's own container).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop runtime | Tauri 2 (Rust) |
| Frontend | Vue 3 + Quasar |
| Build tool | Vite |
| State management | Pinia |
| Game sandbox | iframe with postMessage |
| Credential storage | System keychain |
| Game storage | Filesystem (iCloud Drive on macOS) |
| Testing | Vitest + Vue Test Utils, Rust unit tests |
| CI | GitHub Actions |

## License

[MIT](LICENSE)
