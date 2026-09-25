# Gaimer — Architecture

This page describes the code as it is. The plans it grew from are in [improvement-plan.md](improvement-plan.md), [product-description.md](product-description.md) and [prds/](prds/); each starts with a status line saying how much of it is built.

## Overview

Gaimer is a [Tauri 2](https://tauri.app/) app. Almost all of it runs in the app's window, a web view: a Vue 3 + Quasar front end with Pinia stores. The window asks an AI provider for a game, saves the game as a JSON file, and runs the game's code in a sandboxed iframe. The Rust side (`src-tauri/`) starts three Tauri plugins and adds four commands that keep the OpenAI API key in the system keychain.

```
App window (web view), in src/
├── App.vue, components/, stores/
├── providers/registry.js
│   ├── openai-provider.js ──► openai SDK ──► https://api.openai.com
│   └── anthropic-provider.js ──► shell plugin ──► /bin/zsh -l -c "exec claude -p …"
├── helpers/game-storage.js ──► fs plugin ──► the Gaimer folder (iCloud Drive on macOS)
├── engine/sandbox.js ──► <iframe sandbox="allow-scripts">: the game page
└── credentials/credential-store.js ──► Tauri IPC ──► src-tauri/src/credentials.rs ──► system keychain

Rust side, in src-tauri/src/
├── lib.rs: starts the fs, shell and opener plugins
└── credentials.rs: get_credential, set_credential, delete_credential, import_old_vault
```

## Front end

### Components

| File | What it does |
|------|--------------|
| `src/App.vue` | The layout, and the app's flow. At start it lists the games and connects the chosen provider; Settings opens when none connects. It generates a game from the user's description, saves and shows it, opens games from the list, changes the open game from a follow-up request (in the toolbar, New game closes the game and Undo change goes back one version), and sends a new or changed game that fails as it starts back once to be fixed. |
| `src/components/UserInput.vue` | The field for the game's description, up to 4096 characters. With a game open, it takes a request to change that game instead, and says "Change this game...". |
| `src/components/GameList.vue` | The saved games, in the drawer. Deleting a game asks first. |
| `src/components/GameContainer.vue` | Runs one game; App gives each game, and each version of it, a container of its own. It scales the game to fit, asks it to pause while the window is hidden, shows a Save button when the game can save, offers to restore saved progress, and shows the game's errors. |
| `src/components/Settings.vue` | The provider (OpenAI or Claude), the OpenAI API key, a model for each provider, and Claude's effort level, with how long a game usually takes at each level when the model is `sonnet`. |
| `src/components/ConnectClaude.vue` | The Claude panel in Settings. It checks that the Claude CLI is installed and signed in. "Sign in to Claude" opens Terminal (on macOS) and copies `claude auth login`. |

### Stores (Pinia)

- `src/stores/app-store.js`: what the components share while the app runs: the text the user sent (a game's description, or a change to the open game), the open game's id, the game list, and whether a game is being generated, changed or fixed.
- `src/stores/persisted-store.js`: what outlasts a restart. The provider, the model chosen for each provider and Claude's effort level are in the window's local storage. The OpenAI API key is in the system keychain (see [Credentials](#credentials)).

## Providers

`src/providers/registry.js` holds the providers and which one is active. A provider has `id`, `name`, `authMethod`, `defaultModel`, `connect()`, `disconnect()`, `isConnected()`, `listModels()` and `generateGame(prompt, options)`. `generateGame` is an async generator, but both providers yield a single `complete` chunk that holds the whole answer: nothing streams. The answer is read as a game, unless the caller passes `options.parse` to read it itself, as a change request does for change blocks or the whole game. An answer that cannot be read fails with `AnswerFormatError`, which App tells apart from a request that failed.

App connects the provider the user chose, and only a connected provider is active. A connect that ends after the user has picked another provider or pressed Disconnect is ignored.

### OpenAI

`src/providers/openai-provider.js` runs the `openai` SDK in the window, with `dangerouslyAllowBrowser`, and calls `api.openai.com` with the user's API key. It asks for JSON mode. A GPT-5 model gets `max_completion_tokens`, with 16384 tokens more for its reasoning, and no temperature; other models get `max_tokens` and `temperature`. An answer cut off at the limit is an error. The models on offer are a fixed list; the default is `gpt-4o`.

### Claude

`src/providers/anthropic-provider.js` runs the user's Claude CLI (Claude Code) as a plain completion. Through the shell plugin, `src/helpers/shell.js` starts a login shell, `/bin/zsh -l -c`, which runs:

```
exec claude -p --model <model> --effort <level> --settings '{"env":{"CLAUDE_CODE_EFFORT_LEVEL":"<level>"}}' --tools "" --system-prompt-file '<temp>/gaimer-system-<n>.txt' --no-session-persistence --safe-mode --strict-mcp-config --output-format json < '<temp>/gaimer-prompt-<n>.txt'
```

- The login shell gives the CLI the user's `PATH`, which an app started from the Finder or the Dock does not get.
- The system message and the prompt, the user's description or a request to fix or change a game, go in the two temp files, which are deleted afterwards.
- The built-in tools are off, and no session is saved. `--safe-mode` leaves out the user's `CLAUDE.md`, hooks, plugins and skills, and `--strict-mcp-config` starts no MCP servers.
- The effort level is the one chosen in Settings, `low`, `medium` or `high`, and `low` when none is chosen: at `low` Claude thinks next to nothing before it answers. The level goes with `--effort` and as `CLAUDE_CODE_EFFORT_LEVEL` in the settings given with `--settings`, which decide over that variable in the user's environment or `~/.claude/settings.json`. A `maxEffortLevel` in the user's settings still caps it, and `alwaysThinkingEnabled: false` still turns thinking off. `haiku` has no effort levels and runs without one.
- The CLI uses its own sign-in, which the app never sees. The sign-in check runs `claude auth status`.
- A call that runs past its time limit (15 minutes for a game, 10 seconds for a check) fails, and the CLI is stopped.
- The models are the CLI's aliases `sonnet`, `opus` and `haiku`; the default is `sonnet`.

## Generating a game

1. With no game open, the text the user sends is a game's description. It goes through `app-store` to App, which asks the active provider for a game, with the system message from `src/helpers/prompts.js` and the model chosen for that provider. App also passes a limit of 16384 tokens and a temperature of 0.2, which only the OpenAI provider uses.
2. The system message asks for one JSON object: a title, a description, rules, controls and other fields, and the game's code. The code is plain JavaScript that draws on the page's canvas, handles keyboard and touch, and answers the app's save, restore, pause and resume messages.
3. `src/helpers/json-utils.js` strips code fences from the answer and requires `title` and `code`.
4. App saves the game, puts it first in the list and shows it.

While Claude makes a new game with `sonnet`, the "Generating game..." line, with the seconds passed, also says how long a game usually takes at the level chosen: about a minute at low, 1–5 minutes at medium, 3–8 minutes at high.

### Changing a game

With a game open, the text the user sends is a request to change it. App reads the game from its file and asks the provider and model selected now, with the same system message and options as for a new game. The prompt, from `getChangePrompt` in `prompts.js`, holds the game as JSON, the requests it was made from, oldest first, and the new request. It asks for change blocks, `{ "changes": [{ "find": "...", "replace": "..." }] }`, and the whole new text of those other keys of the game whose text changes. `src/helpers/change-blocks.js` reads the answer and makes the blocks: each `find` must be in the code exactly once, no two may overlap, and all of them are found in the code as it was and made together. An answer that is the whole game, changed, with no `"changes"` and with the `title` and `code` a new game needs, is taken as it is, with no second call. When the answer is neither change blocks nor the whole game, as when it gives both `"changes"` and `"code"`, when its blocks cannot be made, or when they change nothing, App asks once more, with the same request, for the whole game, and reads it as a new game. A request that fails asks for nothing more: the user sees why, and the game stays as it was. The changed game is saved as the game's new version and shown. While the change runs, "Changing the game..." shows with the seconds passed, and the box waits.

In the toolbar, New game closes the open game, so that the box makes a new game. Undo change, there while the open game has an earlier version, goes back to the version before the last change and drops the version it goes back from. If the user opens another game, presses New game or deletes the game while its change runs, the answer is dropped, and nothing is saved.

### The automatic fix

A new or changed game that fails as it starts goes back once to the provider and model that wrote it. `getFixPrompt` in `prompts.js` gives the game, the error's message and stack, and where the error is in the game's code: its line and column, or, when the page found the error only after the end of the code, that the code ended before a brace, bracket or parenthesis was closed, or before a string, comment or statement was ended, or that it closes more braces than it opens. The fix is sent with the same system message and options as a new game. A fixed new game is saved as a new game, and the broken one is deleted, with any progress saved in it. A fixed changed game replaces the version that failed.

A game fails as it starts when its page reports an error before the game is ready, in its first 5 seconds after that, or in the first 5 seconds after the player's first touch, click or key press, from which a game with a start screen plays; only seconds with the window visible count. There is at most one fix per new game or change. A game opened from the list, a version that Undo change went back to, a fixed game, and a game whose provider the user has since switched from or disconnected are not sent: their errors are only shown.

## The game page

`src/engine/sandbox.js` writes each game's page into an iframe through `srcdoc`. The iframe's `sandbox` attribute allows scripts and nothing else, so the page has an opaque origin: it cannot reach the window's DOM or storage. It exchanges messages with the app through `postMessage`, and the app takes messages only from that iframe.

The page holds a canvas the size of the game's container, and two scripts, both loaded from `data:` URLs:

1. **The harness** passes the app's messages to the game's `window.__gaimer_onMessage`, gives the game `__gaimer_sendMessage` to answer with, stops the browser's own scrolling and zooming on touches of the canvas, reports the player's first touch, click or key press, and reports errors.
2. **The game's script** wraps the game's code in a function and a `try` block, then sends `ready`. A line holding only `;` follows the code, so code cut off in the middle of an expression fails with a syntax error that the page finds after the end of the code, instead of being completed by the `ready` call after it.

| Messages from the app | Messages from the game |
|-----------------------|------------------------|
| `saveState`, `restoreState`, `pause`, `resume` | `ready`; `firstInput`, the player's first touch, click or key press; `stateData`, the state asked for by `saveState`; `saveFailed`, when the state cannot be sent; `error` |

**Errors.** The harness reports a syntax error in the game's script, and any error the game throws, as it starts or later: in its loop, its input handlers or a promise. A report holds the message, the stack, and, when the page can tell, the error's line and column in the game's own code; WebKit gives no column for a syntax error. For an error the parser finds only after the end of the code, as when a brace is left open, the report says so instead (`afterCode`). GameContainer shows every error as a notification, and sends App the first one that comes as the game starts, for the automatic fix.

**Why `data:` URLs.** The page has no inline script, for three reasons. In the built app, Tauri adds a hash of each of the app's script files to the window's `script-src`; the page inherits that policy, and a hash voids `'unsafe-inline'`. WebKit reports an error in an inline script of a page with an opaque origin only as "Script error.". And the game's code stays away from the HTML parser, where `<!--` and `<script` in it could stop it from running.

**Resizing.** When the window resizes or the device rotates, the iframe is scaled with a CSS transform to fit its container, keeping its aspect ratio. The game keeps running: its canvas keeps its size, and input still arrives at canvas coordinates.

**Saving.** Once a game is ready, GameContainer asks it for its state. A game that answers gets a Save button, which writes the state next to the game's file. When a game with saved state is opened, the app offers to restore it. The contract is in [features/save-restore-support.md](features/save-restore-support.md).

## Game files

`src/helpers/game-storage.js` keeps each game as a JSON file in `~/Library/Mobile Documents/com~apple~CloudDocs/Gaimer/`, through the fs plugin. On macOS that folder is iCloud Drive. The other platforms use the same path in the home folder, which iCloud does not sync.

- `<id>-<title>.json`: the game as the provider wrote it, or as a change made it, plus `id`, the time it was made in milliseconds, `prompt`, the user's description, and, once the game has been changed, `versions`: its earlier versions, oldest first, each with the request that changed it. The file is named after the game's title, so a change of title renames it.
- `<id>-<title>.state.json`: the game's saved progress, once there is some.

The game list reads every game file and shows the newest first; earlier versions are not listed. Deleting a game deletes both files. A change, the fix of a changed game and an undo delete the saved progress, which was saved from other code.

## Credentials

The OpenAI API key is the only credential the app keeps. `src-tauri/src/credentials.rs` keeps it in the system keychain: Keychain Services on macOS and iOS, the Credential Manager on Windows and the Secret Service on Linux. The window reaches it through four commands, `get_credential`, `set_credential`, `delete_credential` and `import_old_vault`, which file every entry under the app's identifier, `se.addablelabs.gaimer`: a script in the window can reach no other keychain entry. When the keychain fails (on Linux when no Secret Service runs, say), Settings says why, and a key the user enters works until the app quits.

Versions before the keychain kept the key in a Stronghold vault, encrypted with a password and a salt that are in this repository. At start, `import_old_vault` moves that key into the keychain, unless the keychain holds one already, and deletes the vault. Once the vault is gone, it does nothing.

## Capabilities

Besides Tauri's basic commands (`core:default`) and the four keychain commands, a script in the window can use only what `src-tauri/capabilities/default.json` grants:

- **shell**: starting `/bin/zsh -l -c` with one of three command lines: `exec claude --version`, `exec claude auth status`, or the game call above, whose model must be a plain model name, whose effort level must be `low`, `medium` or `high`, and whose files must be named like the app's temp files. Starting `open -a Terminal`. Stopping a process it started.
- **opener**: opening `https://` links in the browser.
- **fs**: reading and writing files in the temp folder, where the Claude call's temp files go; reading the app's own folders; and creating, listing, reading, writing and deleting in the Gaimer folder.

## Content Security Policy

Two policies bind a game page, and every load in it must pass both:

- **The window's**, in `src-tauri/tauri.conf.json`. Scripts come from the app, inline or from `data:` URLs; styles from the app or inline; fonts from the app or `data:`; images from the app, `data:` or `blob:`; frames from the app. The window connects only to the app itself, Tauri's IPC and `https://api.openai.com`. A page set through `srcdoc` takes a copy of its parent's policy, so this one binds every game as well.
- **The game page's own**, in a `<meta>` tag the sandbox writes: `default-src 'none'`, scripts inline or from `data:`, styles inline, images from `blob:` or `data:`. It allows no connection, so a game's requests (`fetch`, XHR, WebSocket) are refused.

In the built app, Tauri adds hashes of the app's script files to the window's `script-src`, which voids `'unsafe-inline'` for scripts, in the window and in every game page. `index.html` has no `<style>` element, so Tauri adds no nonce to `style-src`, and the game page's own `<style>` applies.

## Security

- **The OpenAI API key** is kept in the system keychain, but the window holds it too: it reads the key at start, and the OpenAI SDK sends it from the window to `api.openai.com`. No proxy on the Rust side stands in between. A script running in the window could read the key.
- **Claude**: the window never holds Claude's credentials; the Claude CLI keeps its own sign-in. The window can start only the three Claude command lines and `open -a Terminal`.
- **Games**: a game's code runs only in its page, which has an opaque origin, allows no connection, and talks to the app only through the messages above.
- **The keychain**: the window reaches only the entries filed under the app's identifier.

## Tests

- `tests/unit/`: Vitest, with happy-dom and Vue Test Utils, for App and the components, the stores, providers and helpers, the sandbox and the credential store. Fakes stand in for the Tauri plugins (`tests/setup.js`, `tests/plugin-shell.js`). `tests/capability.js` reads the capability file the way Tauri does, so tests check what the window may run and open.
- `yarn test:coverage` fails when coverage drops below the floor in `vitest.config.js`: statements 94%, branches 89%, functions 90%, lines 96%.
- `src-tauri/src/credentials.rs` has Rust tests for the keychain commands and for the move out of the old vault, against a mock keychain.
- CI (`.github/workflows/ci.yml`) runs `yarn test:coverage`, then builds the front end, and the app for Linux, macOS, Windows and the iOS simulator. On Linux it also runs `cargo fmt --check`, clippy and `cargo test`.
