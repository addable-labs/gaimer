# PRD: Real-Time Sprite Generation

**Status on 2026-09-25: Not built.** This is the plan as written on 2026-03-04, and none of it exists. It assumes IndexedDB, which the app no longer uses (games are JSON files; see [architecture.md](../architecture.md)), and sprites made by Claude through tool use, but Claude does not generate images.

> Feature: AI-generated visual game assets (characters, enemies, items, backgrounds) created in parallel with game code generation.

## Problem Statement

Gaimer currently generates games that use only canvas primitives — `fillRect()`, `arc()`, and basic shapes. This produces games that look like programmer art from the 1980s. Players expect visually appealing characters, enemies, environments, and effects. The gap between the sophisticated game logic AI can generate and the primitive visuals undermines the experience.

Modern image generation APIs can produce game-quality sprite art in 2-5 seconds. By generating sprites in parallel with game code and loading them progressively, we can deliver visually rich games without significantly increasing total generation time.

## Goals

1. Generate custom sprite art for each game (player, enemies, items, backgrounds)
2. Run sprite generation in parallel with game code generation
3. Progressive loading — games start playable immediately, sprites pop in as they arrive
4. Cache generated sprites in IndexedDB for instant replay
5. Support sprite sheet animation (walk cycles, attack frames, etc.)

## Non-Goals

- 3D model generation
- Animated GIF or video generation
- User-uploaded custom sprites (future feature)
- Style transfer from reference images
- Real-time sprite editing or modification

## Requirements

### R1: Sprite Generation Pipeline

**Description**: Orchestrate the generation of all sprites for a game, running in parallel with code generation.

**Acceptance Criteria**:
- [ ] Game generation returns a sprite manifest: `[{ id, description, frames, dimensions }]`
- [ ] Each sprite in the manifest triggers an independent image generation API call
- [ ] Sprite generation runs in parallel with (or immediately after) code generation
- [ ] Individual sprites are delivered to the game runtime as they complete (progressive)
- [ ] Failed sprite generation falls back to colored placeholder shapes
- [ ] Total sprite generation adds < 5 seconds to perceived game creation time (parallel)
- [ ] Pipeline handles 1-20 sprites per game

**Tasks**:
1. Create `src/sprites/pipeline.js` — sprite generation orchestrator:
   ```javascript
   class SpritePipeline {
     constructor(provider, cache)

     // Generate all sprites from manifest, emitting as each completes
     async *generateSprites(manifest, gameId): AsyncGenerator<SpriteResult>

     // Generate a single sprite
     async generateSprite(spriteSpec): Promise<SpriteResult>

     // Cancel all in-flight generations
     cancel()

     // Get generation progress
     get progress(): { completed: number, total: number, current: string }
   }
   ```
2. Implement parallel generation with concurrency limit (max 3 simultaneous):
   - Use `Promise.allSettled` with a semaphore pattern
   - Yield results as they complete (not wait for all)
3. Implement provider-specific sprite generation:
   - Anthropic: Tool_use with image generation capability
   - OpenAI: DALL-E 3 API call
4. Implement fallback: if image generation fails, create a colored rectangle with the sprite name
5. Wire pipeline into the game generation flow in `App.vue`
6. Write unit tests for pipeline orchestration (mock image generation)
7. Write integration test for full manifest → sprites flow

**Verification**:
- `npm run test:unit -- pipeline` passes
- 10-sprite manifest completes in < 15 seconds (with mocked 2s per sprite, 3 concurrent)
- Failed sprites produce colored placeholder, not errors
- Progress updates emit for each completed sprite

---

### R2: Image Generation API Integration

**Description**: Connect to image generation APIs through the provider abstraction layer.

**Acceptance Criteria**:
- [ ] Anthropic provider generates sprites via tool_use (image output)
- [ ] OpenAI provider generates sprites via DALL-E 3 API
- [ ] Generated images are in PNG format with transparent backgrounds
- [ ] Images are resized to game-appropriate dimensions (max 256×256 for sprites)
- [ ] API calls go through the Tauri Rust proxy (no direct browser calls)
- [ ] Generation prompts produce consistent pixel-art or vector-game-art style

**Tasks**:
1. Extend `AIProvider` interface with `generateSprite(description, options)`:
   ```javascript
   {
     description: "pixel art knight character facing right, transparent background",
     style: "pixel-art" | "vector" | "hand-drawn",
     dimensions: { w: 64, h: 64 },
     frames: 1,           // For sprite sheets: number of animation frames
     transparent: true
   }
   ```
2. Implement in `src/providers/anthropic.js`:
   - Use Agent SDK tool_use with image generation tool
   - Parse image response (base64 or URL)
   - Convert to Blob
3. Implement in `src/providers/openai.js`:
   - DALL-E 3 API: `POST /v1/images/generations`
   - Parameters: size 256×256, quality standard, response_format b64_json
   - Prompt engineering: prepend style instructions
4. Create sprite prompt builder `src/sprites/prompt-builder.js`:
   - Takes game context (genre, art style) + sprite description
   - Generates optimized prompt for the target API
   - Examples:
     - Input: `{ description: "player character", genre: "space shooter" }`
     - Output: `"pixel art spaceship, top-down view, transparent background, 64x64, game asset, clean edges"`
5. Implement image post-processing:
   - Resize to target dimensions (canvas drawImage)
   - Verify/enforce transparency
   - Convert to PNG Blob
6. Route through Tauri proxy
7. Write unit tests for prompt builder
8. Write unit tests for each provider's sprite generation (mocked API)
9. Write integration test with real API calls (gated behind env flag)

**Verification**:
- `npm run test:unit -- sprite-generation` passes
- Generated images are valid PNGs with transparent backgrounds
- Prompt builder produces consistent, descriptive prompts
- Both providers produce usable game sprites

---

### R3: Sprite Caching in IndexedDB

**Description**: Cache generated sprites alongside game data for instant replay without re-generation.

**Acceptance Criteria**:
- [ ] Sprites stored in dedicated IndexedDB object store (`sprites`)
- [ ] Sprites keyed by `gameId + spriteId` for unique identification
- [ ] Loading a cached game loads its sprites from IndexedDB (no API call)
- [ ] Deleting a game also deletes its associated sprites
- [ ] Cache supports both Blob and base64 storage
- [ ] Cache hit rate displayed in dev tools / debug mode

**Tasks**:
1. Add `sprites` object store to IndexedDB schema (`src/helpers/indexeddb.js`):
   ```javascript
   {
     keyPath: 'id',       // gameId + '_' + spriteId
     indexes: ['gameId']  // For bulk loading by game
   }
   ```
2. Bump DB version (currently 21 → 22) with migration
3. Create `src/sprites/cache.js`:
   ```javascript
   class SpriteCache {
     async store(gameId, spriteId, blob, metadata)
     async load(gameId, spriteId): Promise<Blob | null>
     async loadAllForGame(gameId): Promise<Map<string, Blob>>
     async deleteForGame(gameId): Promise<void>
     async getCacheSize(): Promise<number>  // bytes
   }
   ```
4. Integrate cache into pipeline:
   - Before generating: check cache
   - After generating: store in cache
   - On game load: load from cache
5. Update `GameList.vue` delete flow to also delete sprites
6. Write unit tests for cache operations (using fake-indexeddb)
7. Write integration test for cache → load → display flow

**Verification**:
- `npm run test:unit -- sprite-cache` passes
- Second load of same game uses cached sprites (0 API calls)
- Deleting a game removes all associated sprites from IndexedDB
- Cache correctly handles DB version migration from v21

---

### R4: Asset Loading System in Runtime

**Description**: Enable the game runtime to load and render sprite images from blob URLs.

**Acceptance Criteria**:
- [ ] `game.sprites.load(id, blobUrl)` loads an image asynchronously
- [ ] `game.sprites.draw(id, x, y, w, h)` renders a loaded sprite on canvas
- [ ] `game.sprites.drawFrame(id, frameIndex, x, y, w, h)` for sprite sheets
- [ ] `game.sprites.animate(id, frames, fps)` auto-cycles through frames
- [ ] Sprites not yet loaded render as placeholder (colored rect with name)
- [ ] `game.sprites.isLoaded(id)` returns boolean for conditional logic
- [ ] All blob URLs are revoked on game cleanup (memory management)

**Tasks**:
1. Implement `SpriteManager` in `src/engine/sprites.js` (inside runtime):
   - `load(id, blobUrl)`: Create `Image()`, set src to blob URL, track load state
   - `draw(id, x, y, w, h)`: `ctx.drawImage()` if loaded, placeholder if not
   - `drawFrame(id, frameIndex, x, y, w, h)`: Calculate source rect from sheet
   - `animate(id, frames, fps)`: Track current frame, auto-advance
   - `isLoaded(id)`: Return load state
2. Implement sprite sheet parsing:
   - Assumption: horizontal strip (frames side by side)
   - Frame width = total width / frame count
3. Implement placeholder rendering:
   - Colored rectangle (hash sprite description to color)
   - Sprite ID text rendered inside
4. Implement blob URL lifecycle:
   - Create blob URLs from Blobs received via postMessage
   - Track all created URLs
   - `cleanup()` method revokes all URLs
5. Wire sprite loading into sandbox message protocol:
   - App sends: `{ type: 'load-sprite', id, blobUrl }`
   - Note: blob URLs must be created inside the sandbox from transferred Blobs
   - Alternative: Transfer image data as ArrayBuffer, create blob inside sandbox
6. Write unit tests for SpriteManager (mock Image loading)
7. Write visual regression test with known sprite + known draw call

**Verification**:
- `npm run test:unit -- sprites` passes
- Loaded sprite renders at correct position and dimensions
- Placeholder renders for not-yet-loaded sprites
- Animation cycles through frames at correct FPS
- No blob URL leaks after game cleanup

---

### R5: Sprite Generation UX

**Description**: Show sprite generation progress to the user and handle the progressive loading experience.

**Acceptance Criteria**:
- [ ] During generation, show thumbnails of completed sprites
- [ ] Progress bar or counter: "Generating sprites: 3/8"
- [ ] Game becomes playable immediately with placeholders
- [ ] Sprites "pop in" smoothly as they complete (fade-in transition)
- [ ] User can skip sprite generation and play with placeholders
- [ ] Re-generate button for individual sprites that look wrong

**Tasks**:
1. Create `SpriteProgress.vue` component:
   - Grid of sprite thumbnails (loading indicator for pending, image for complete)
   - Progress counter
   - "Skip" button to start playing immediately
2. Integrate into generation flow:
   - Code generation completes → game becomes playable with placeholders
   - Sprite generation continues → sprites progressively loaded
3. Implement sprite pop-in effect:
   - Inside sandbox: when sprite loads, fade from placeholder to sprite over 300ms
4. Add "Regenerate" button on individual sprites in game info panel
5. Wire generation progress events from pipeline to Vue component
6. Write component tests for SpriteProgress.vue
7. Write Playwright e2e test for progressive loading flow

**Verification**:
- `npm run test:unit -- SpriteProgress` passes
- Game is playable within 5 seconds (code gen), sprites arrive over next 10 seconds
- Skip button works and game plays with colored placeholders
- Regenerated sprite replaces the old one in both game and cache

---

### R6: Updated System Prompt for Sprite-Aware Generation

**Description**: Modify the AI system prompt to generate sprite manifests alongside game code.

**Acceptance Criteria**:
- [ ] System prompt instructs AI to include `sprites` array in JSON output
- [ ] Each sprite entry has: `id`, `description` (detailed visual description), `frames` (animation frame count), `role` (player/enemy/item/background)
- [ ] AI-generated code references sprites by `id` using `game.sprites.draw(id, ...)`
- [ ] Sprite descriptions are detailed enough for image generation (style, color, perspective)
- [ ] Generated games typically include 3-10 sprites

**Tasks**:
1. Update `src/helpers/prompts.js` system message to include sprite instructions:
   - Explain the sprite manifest format
   - Provide examples of good sprite descriptions
   - Instruct code to use `game.sprites.draw(id, ...)` and `game.sprites.isLoaded(id)`
   - Instruct to design with placeholder fallback in mind
2. Update JSON schema:
   ```json
   "sprites": [
     {
       "id": "player",
       "description": "pixel art knight character, silver armor, blue cape, facing right, 64x64, transparent background",
       "frames": 4,
       "role": "player"
     },
     {
       "id": "enemy-goblin",
       "description": "pixel art green goblin, holding wooden club, menacing pose, 48x48, transparent background",
       "frames": 2,
       "role": "enemy"
     },
     {
       "id": "background",
       "description": "pixel art forest clearing, green grass, tall trees, blue sky, 1024x512, tileable horizontally",
       "frames": 1,
       "role": "background"
     }
   ]
   ```
3. Create prompt variants for different game genres:
   - Platformer: side-view characters, tileable ground/sky
   - Shooter: top-down ships, projectiles, explosions
   - Puzzle: isometric or flat blocks, UI elements
   - Arcade: front-facing characters, simple items
4. Test with 5+ game types and validate sprite manifests
5. Write unit tests for prompt template with sprite section
6. Write integration test: prompt → AI → validate sprite manifest quality

**Verification**:
- `npm run test:unit -- prompts` passes
- Generated games include 3-10 sprites with descriptive entries
- All sprite IDs referenced in code exist in the manifest
- Sprite descriptions include art style, dimensions, and transparency specification

## Technical Architecture

```
Game Generation Request
│
├──> Provider.generateGame(prompt)
│    │
│    ├──> Returns: { code, sprites: SpriteManifest[], ... }
│    │
│    └──> Stream: game JSON (code first, then sprites section)
│
├──> GameContainer loads game code immediately
│    │
│    └──> Game runs with placeholder sprites
│
└──> SpritePipeline.generateSprites(manifest)
     │
     ├──> [Parallel, max 3 concurrent]
     │    ├──> Provider.generateSprite(sprites[0]) ──> Blob ──> Cache + Load
     │    ├──> Provider.generateSprite(sprites[1]) ──> Blob ──> Cache + Load
     │    └──> Provider.generateSprite(sprites[2]) ──> Blob ──> Cache + Load
     │
     └──> Each completion:
          ├──> Store in IndexedDB cache
          ├──> Create blob URL
          └──> Send to sandbox: { type: 'load-sprite', id, blob }
```

## Performance Targets

| Metric | Target |
|--------|--------|
| Code generation (text) | < 10 seconds |
| First playable game (with placeholders) | < 15 seconds |
| Individual sprite generation | 2-5 seconds |
| Full sprite set (8 sprites, 3 concurrent) | < 15 seconds |
| Total time to fully rendered game | < 25 seconds |
| Cached game reload (with sprites) | < 1 second |

## Sprite Style Guide

To ensure consistent, game-appropriate visuals, sprite prompts should follow these rules:

1. **Always specify art style**: "pixel art", "vector flat design", "hand-drawn cartoon"
2. **Always specify dimensions**: "64x64", "128x128"
3. **Always request transparency**: "transparent background"
4. **Specify perspective**: "top-down", "side-view", "isometric", "front-facing"
5. **Include color guidance**: "bright colors", "muted earth tones", "neon cyberpunk"
6. **For animations**: "4 frames walking cycle, horizontal strip"

## Dependencies

| Dependency | Purpose |
|------------|---------|
| Provider abstraction (PRD-AI) | Provides `generateSprite()` method |
| Game runtime (PRD-Engine) | Provides `SpriteManager` in sandbox |
| IndexedDB helper (existing) | Storage for sprite cache |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Image gen produces inconsistent art styles within a game | High | Medium | Include game-level style in each sprite prompt |
| Transparent background not always generated | Medium | Low | Post-process with background removal |
| API rate limits on image generation | Medium | Medium | Queue with backoff, cache aggressively |
| Large blob sizes exhaust IndexedDB storage | Low | Medium | Compress sprites, set per-game size limit |
| Sprite generation significantly slower than code gen | High | Low | Progressive loading mitigates perceived delay |
