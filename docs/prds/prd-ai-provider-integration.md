# PRD: AI Provider Integration

> Feature: Multi-provider AI integration with Anthropic Agent SDK (OAuth) as primary provider.

## Problem Statement

Gaimer currently hardcodes OpenAI's GPT-4o as the sole AI provider, requiring users to manually obtain and paste an API key. This creates friction (users must visit OpenAI's developer platform, generate a key, manage billing), poses security risks (key stored in plaintext localStorage), and locks users into a single provider.

Users who already pay for AI subscriptions (Anthropic Pro, ChatGPT Plus) should be able to use their existing subscriptions seamlessly via OAuth — one click to connect, zero API key management.

## Goals

1. Enable OAuth-based authentication with Anthropic as the primary provider
2. Leverage Anthropic's Agent SDK for sandboxed game code generation via tool_use
3. Abstract providers behind a unified interface to support multiple AI services
4. Route all API traffic through the Tauri Rust backend for security
5. Store credentials securely in platform keychain (not localStorage)

## Non-Goals

- Building a custom AI model or fine-tuning
- Supporting more than 3 providers in the initial release
- Implementing a provider marketplace
- Handling AI billing or subscription management

## Reference: Notesage Architecture

Gaimer's provider integration is inspired by the Notesage connections system:
- **Connections list** in settings for managing providers
- **Smart auto-assignment**: First connected provider fills compatible slots
- **Multiple auth methods**: OAuth (Anthropic, OpenAI), API key (fallback), local (Ollama)
- **Standardized interface**: `generateText()` and `chat()` methods across providers
- **Backend routing**: All AI calls through Tauri Rust backend for security

## Requirements

### R1: Provider Abstraction Layer

**Description**: Create a provider interface that all AI integrations implement.

**Acceptance Criteria**:
- [ ] `AIProvider` interface defined with `connect()`, `disconnect()`, `isConnected()`, `generateGame()`, `generateSprite()`, and `capabilities` properties
- [ ] Provider registry allows registering and retrieving providers by ID
- [ ] Active provider selection persisted across sessions
- [ ] Provider switching does not require app restart
- [ ] Capability flags correctly reflect each provider's features

**Tasks**:
1. Define `AIProvider` TypeScript-style interface in `src/providers/types.js`
2. Implement provider registry in `src/providers/registry.js`
3. Create `provider-store.js` Pinia store (activeProvider, connections, routing)
4. Write unit tests for registry (register, get, list, switch)
5. Write unit tests for provider store (state transitions, persistence)

**Verification**:
- `npm run test:unit -- providers` passes
- Provider can be registered, retrieved, and switched programmatically
- Active provider survives app restart (persisted in localStorage)

---

### R2: Anthropic Agent SDK Integration (Primary Provider)

**Description**: Integrate Anthropic's Agent SDK with OAuth PKCE flow for user authentication and sandboxed tool_use for game generation.

**Acceptance Criteria**:
- [ ] User can authenticate with Anthropic via OAuth 2.0 PKCE flow
- [ ] OAuth tokens stored in Tauri Stronghold (never in localStorage)
- [ ] Agent SDK creates sandboxed execution environment for game generation
- [ ] Game generation uses `tool_use` with `generate_game_code` tool definition
- [ ] Streaming responses show real-time generation progress
- [ ] Token refresh happens transparently when access token expires
- [ ] Disconnect revokes tokens and clears stored credentials

**Tasks**:
1. Add `@anthropic-ai/claude-agent-sdk` to dependencies
2. Add `tauri-plugin-stronghold` to Rust dependencies
3. Implement OAuth PKCE flow in `src-tauri/src/commands/auth.rs`:
   - Generate code_verifier + code_challenge
   - Open system browser for authorization
   - Handle redirect callback (custom URL scheme `gaimer://`)
   - Exchange code for tokens
   - Store tokens in Stronghold
4. Create `src/providers/anthropic.js` implementing `AIProvider`:
   - `connect()`: Initiate OAuth via Tauri invoke
   - `disconnect()`: Revoke + clear tokens
   - `isConnected()`: Check token validity
   - `generateGame()`: Agent SDK with tool_use, streaming
   - `generateSprite()`: Tool_use for image generation
5. Define tool schemas for Agent SDK:
   - `generate_game_code`: Accepts game description, returns JSON game spec
   - `generate_sprite`: Accepts sprite description, returns image data
6. Implement streaming in `generateGame()` using AsyncGenerator
7. Write unit tests for OAuth flow (mock Tauri invokes)
8. Write unit tests for game generation (mock Agent SDK responses)
9. Write integration test for full auth → generate → parse flow

**Verification**:
- `npm run test:unit -- anthropic` passes
- `npm run test:integration -- provider-auth` passes
- OAuth flow opens browser, redirects back, stores token
- Generation produces valid game JSON with streaming chunks
- Token refresh happens without user interaction

---

### R3: OpenAI Provider (Secondary)

**Description**: Refactor existing OpenAI integration to implement the provider interface, with both OAuth and API key auth methods.

**Acceptance Criteria**:
- [ ] Existing OpenAI functionality preserved (no regression)
- [ ] OpenAI provider implements `AIProvider` interface
- [ ] Supports both API key (existing) and OAuth authentication
- [ ] Uses structured output (JSON mode) instead of fragile parsing
- [ ] Streaming responses supported
- [ ] API calls routed through Tauri backend (remove `dangerouslyAllowBrowser`)

**Tasks**:
1. Create `src/providers/openai.js` implementing `AIProvider`
2. Migrate logic from `src/helpers/openai.js` to new provider
3. Add structured output (`response_format: { type: "json_object" }`)
4. Implement streaming via `openai.chat.completions.create({ stream: true })`
5. Route API calls through `src-tauri/src/commands/proxy.rs`
6. Support OAuth flow (similar to Anthropic, different endpoints)
7. Maintain API key fallback for users who prefer it
8. Write unit tests for OpenAI provider
9. Write migration test ensuring existing games still load
10. Remove `dangerouslyAllowBrowser: true` flag

**Verification**:
- `npm run test:unit -- openai` passes
- Existing saved games load correctly after migration
- Generation works with both API key and OAuth auth
- No `dangerouslyAllowBrowser` in codebase

---

### R4: Tauri Backend HTTP Proxy

**Description**: Route all AI provider API calls through the Tauri Rust backend to prevent token/key exposure in the WebView.

**Acceptance Criteria**:
- [ ] Frontend never holds raw API tokens or keys
- [ ] Rust proxy attaches auth headers from Stronghold before forwarding
- [ ] Proxy supports streaming (SSE) pass-through
- [ ] HTTP capability permissions updated for all provider endpoints
- [ ] Proxy handles errors gracefully (401 → token refresh, 429 → backoff)

**Tasks**:
1. Create `src-tauri/src/commands/proxy.rs` with Tauri command:
   ```rust
   #[tauri::command]
   async fn proxy_ai_request(provider: String, endpoint: String, body: String) -> Result<String, String>
   ```
2. Implement streaming variant:
   ```rust
   #[tauri::command]
   async fn proxy_ai_stream(provider: String, endpoint: String, body: String, window: Window)
   ```
   (Emits `ai-stream-chunk` events)
3. Implement token retrieval from Stronghold
4. Update `capabilities/default.json` to allow Anthropic + OpenAI endpoints
5. Add error handling: 401 → refresh token, 429 → return retry-after, 5xx → error
6. Write Rust unit tests for proxy command
7. Frontend: Replace direct HTTP calls with `invoke('proxy_ai_request', ...)`

**Verification**:
- `cargo test` passes in src-tauri
- No direct API calls from frontend JavaScript (grep verification)
- Streaming works end-to-end (invoke → SSE → event → UI update)

---

### R5: Provider Settings UI

**Description**: Replace the API key input dialog with a connections management interface.

**Acceptance Criteria**:
- [ ] Settings shows a "Connections" section listing all available providers
- [ ] Each provider shows connected/disconnected status
- [ ] "Connect" button initiates OAuth flow (or shows API key input for fallback)
- [ ] "Disconnect" button revokes credentials with confirmation
- [ ] Active provider indicator shown in the main UI header
- [ ] Provider can be switched from the settings panel

**Tasks**:
1. Redesign `Settings.vue` to show provider connections list
2. Create `ProviderCard.vue` component (name, status, connect/disconnect buttons)
3. Add active provider selector (radio or dropdown)
4. Wire up to provider-store actions
5. Add loading states during OAuth redirect
6. Add error states (auth failed, network error)
7. Write component tests for Settings.vue and ProviderCard.vue
8. Write Playwright e2e test for connection flow

**Verification**:
- `npm run test:unit -- Settings ProviderCard` passes
- `npm run test:e2e -- provider-setup` passes
- UI correctly reflects connected/disconnected states
- OAuth flow completes and returns to settings

---

### R6: Streaming Generation UX

**Description**: Show real-time progress during game generation instead of a spinner.

**Acceptance Criteria**:
- [ ] Generation progress displayed as streaming text (game title, description appear as generated)
- [ ] Code generation shows a progress indicator (tokens generated / estimated)
- [ ] User can cancel generation mid-stream
- [ ] Error during generation shows actionable error message
- [ ] Completed generation transitions smoothly to game execution

**Tasks**:
1. Create `GenerationProgress.vue` component
2. Implement stream consumption in app-store (watch for `ai-stream-chunk` events)
3. Parse partial JSON as it arrives (show title, description early)
4. Add cancel button that aborts the stream
5. Handle stream errors (network drop, provider error)
6. Animate transition from progress → game canvas
7. Write component tests for GenerationProgress.vue
8. Write integration test for streaming flow

**Verification**:
- `npm run test:unit -- GenerationProgress` passes
- Title appears within 2 seconds of generation start
- Cancel stops generation and returns to input state
- Error messages are user-friendly (not raw HTTP errors)

## Technical Debt to Address

- [ ] Remove `src/helpers/openai.js` after migration to provider pattern
- [ ] Remove Firebase auth stub (`Login.vue` with empty credentials)
- [ ] Remove `dangerouslyAllowBrowser: true` from all code
- [ ] Update `capabilities/default.json` schema from desktop to mobile-inclusive

## Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| `@anthropic-ai/claude-agent-sdk` | latest | Agent SDK integration |
| `tauri-plugin-stronghold` | 2.x | Secure credential storage |
| `openai` | ^4.63.0 | OpenAI provider (existing) |

## Out of Scope (Future)

- Ollama local provider integration
- Provider usage analytics / token tracking
- Multi-provider simultaneous generation (race for best result)
- Provider-specific prompt optimization (handled in Game Engine PRD)
