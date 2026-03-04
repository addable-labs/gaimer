# PRD: iOS Platform Readiness

> Feature: Prepare Gaimer for Apple App Store submission with full iOS platform compliance.

## Problem Statement

Gaimer runs in the iOS simulator (confirmed in commit `9a62cf1`) but is far from App Store ready. The Tauri configuration is at release candidate (2.0.0-rc), no Xcode project is committed, iOS-specific UX patterns (safe areas, keyboard handling, haptics) are missing, and App Store requirements (icons, privacy policy, content moderation) are unaddressed.

## Goals

1. Upgrade Tauri to stable 2.x for production iOS builds
2. Complete iOS Xcode project setup with proper signing
3. Implement iOS-specific UX (safe areas, keyboard, haptics, orientation)
4. Meet all App Store submission requirements (metadata, privacy, icons)
5. Ensure smooth performance on target iOS devices

## Non-Goals

- Android support (future phase)
- iPad-specific layouts (universal app, phone-first)
- App Store Optimization (ASO) or marketing
- In-app purchases or subscriptions

## Requirements

### R1: Tauri Upgrade & Xcode Project Setup

**Description**: Upgrade from Tauri 2.0.0-rc to stable and initialize the iOS Xcode project.

**Acceptance Criteria**:
- [ ] Tauri CLI and all plugins upgraded to stable 2.x releases
- [ ] `yarn tauri ios init` successfully generates Xcode project in `src-tauri/gen/apple/`
- [ ] App builds and runs on iOS 17.4+ simulator
- [ ] App builds and runs on physical iOS device
- [ ] Bundle identifier set to `com.gaimer.app`
- [ ] Xcode project committed to repo (excluding user-specific files)
- [ ] `yarn tauri ios build` produces a release IPA

**Tasks**:
1. Update `package.json` dependencies:
   - `@tauri-apps/api` → `^2.0.0` (stable)
   - `@tauri-apps/cli` → `^2.0.0` (stable)
   - `@tauri-apps/plugin-fs` → `^2.0.0`
   - `@tauri-apps/plugin-http` → `^2.0.0`
   - `@tauri-apps/plugin-shell` → `^2.0.0`
2. Update `src-tauri/Cargo.toml` Rust dependencies to stable 2.x
3. Run `yarn tauri ios init` and configure:
   - Bundle ID: `com.gaimer.app`
   - Deployment target: iOS 17.4
   - Device family: iPhone (universal)
4. Configure Xcode signing (development + distribution profiles)
5. Add `src-tauri/gen/apple/.gitignore` for user-specific Xcode files
6. Test build on simulator and physical device
7. Verify all Tauri plugins work on iOS (HTTP, Stronghold, FS)

**Verification**:
- `yarn tauri ios build` succeeds without errors
- App launches on iOS 17.4 simulator
- App launches on physical iPhone
- HTTP proxy to AI provider works on device
- Stronghold credential storage works on device

---

### R2: iOS App Icons & Launch Screen

**Description**: Generate and configure all required iOS app icons and launch screen.

**Acceptance Criteria**:
- [ ] App icon set includes all required sizes (1024×1024 App Store, @2x, @3x device icons)
- [ ] Icons follow Apple Human Interface Guidelines (no transparency, no rounded corners in source)
- [ ] Launch screen configured (simple branded splash, not a static image)
- [ ] Dark mode variant of app icon provided
- [ ] Icons look crisp on all device sizes

**Tasks**:
1. Design app icon (1024×1024 source):
   - Game controller + AI/sparkle motif
   - Bold, recognizable at small sizes
   - No text in the icon (won't be legible at 29×29)
2. Generate icon set using `tauri icon` command or manual export:
   - 20×20, 29×29, 40×40, 58×58, 60×60, 76×76, 80×80, 87×87
   - 120×120, 152×152, 167×167, 180×180, 1024×1024
3. Configure launch screen in Xcode:
   - Storyboard-based (required by Apple)
   - App name + icon centered
   - Supports both light and dark mode
4. Update `tauri.conf.json` icon references
5. Verify icons render correctly on multiple device sizes

**Verification**:
- All icon sizes present in `src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/`
- No missing icon warnings in Xcode
- Launch screen displays correctly on iPhone SE, iPhone 15, iPhone 15 Pro Max
- Icon appears correctly on home screen after install

---

### R3: Safe Area & Notch Handling

**Description**: Respect iOS safe areas (notch, Dynamic Island, home indicator) in all UI layouts.

**Acceptance Criteria**:
- [ ] No UI elements hidden behind the notch or Dynamic Island
- [ ] No UI elements hidden behind the home indicator bar
- [ ] Game canvas properly inset within safe areas
- [ ] Touch controls (d-pad, action buttons) placed within safe areas
- [ ] Status bar handled appropriately (hidden during gameplay, visible in menus)
- [ ] Works on notched (iPhone X+) and non-notched (iPhone SE) devices

**Tasks**:
1. Add CSS environment variables to `styles.css`:
   ```css
   :root {
     --safe-area-top: env(safe-area-inset-top);
     --safe-area-bottom: env(safe-area-inset-bottom);
     --safe-area-left: env(safe-area-inset-left);
     --safe-area-right: env(safe-area-inset-right);
   }
   ```
2. Update `index.html` viewport meta:
   ```html
   <meta name="viewport" content="..., viewport-fit=cover">
   ```
3. Apply safe area padding to:
   - Header toolbar (top inset)
   - Footer input bar (bottom inset)
   - Game canvas container (all insets)
   - Touch control overlays (bottom inset)
   - Left drawer (left inset in landscape)
4. Hide status bar during active gameplay
5. Test on all device form factors:
   - iPhone SE (no notch)
   - iPhone 15 (Dynamic Island)
   - iPhone 15 Pro Max (largest Dynamic Island)
   - Landscape orientation
6. Write Playwright e2e test with mobile viewport emulation

**Verification**:
- `npm run test:e2e -- ios-layout` passes (viewport emulation)
- Visual inspection on 3 device sizes shows no overlap with system UI
- Landscape mode properly adjusts all safe area insets
- Touch controls are fully accessible (not under home indicator)

---

### R4: iOS Keyboard Management

**Description**: Handle the iOS virtual keyboard for the game description input without breaking the layout.

**Acceptance Criteria**:
- [ ] Keyboard appearance doesn't cover the input field
- [ ] Game canvas resizes or scrolls when keyboard is visible
- [ ] Keyboard dismissal returns to full-screen layout
- [ ] "Send" button accessible while keyboard is open
- [ ] No layout jump or flash when keyboard appears/disappears
- [ ] Keyboard dismiss on tap outside input area

**Tasks**:
1. Implement keyboard detection:
   - Listen for `visualViewport.resize` event
   - Calculate keyboard height: `window.innerHeight - visualViewport.height`
2. Adjust layout when keyboard is visible:
   - Scroll input into view
   - Reduce game canvas height (or hide it)
   - Ensure send button remains visible
3. Handle keyboard dismissal:
   - Tap on game canvas area dismisses keyboard
   - Smooth transition back to full layout
4. Configure Tauri iOS keyboard behavior:
   - `"adjustResize"` mode for WebView
5. Fix existing bug: `Document.getElementById` → `document.getElementById` in `UserInput.vue:23`
6. Write component test for UserInput keyboard interaction
7. Test on physical device (keyboard behavior differs from simulator)

**Verification**:
- Input field visible when keyboard is open
- Send button tappable when keyboard is open
- Canvas returns to full size after keyboard dismissal
- No layout jitter during keyboard transitions
- `Document.getElementById` bug is fixed

---

### R5: Performance & Memory

**Description**: Ensure smooth 60 FPS gameplay and stable memory on iOS devices.

**Acceptance Criteria**:
- [ ] Games run at 60 FPS on iPhone 12 and newer
- [ ] Games run at minimum 30 FPS on iPhone SE 3rd gen
- [ ] Memory usage stays below 200MB during gameplay
- [ ] No memory leaks when switching between games
- [ ] App does not crash after 30 minutes of continuous use
- [ ] Canvas rendering doesn't cause WKWebView crashes

**Tasks**:
1. Profile game rendering performance on iOS:
   - Use Safari Web Inspector → Timeline
   - Identify expensive canvas operations
   - Optimize sprite drawing (caching, dirty rects)
2. Implement canvas resolution management:
   - Cap at `devicePixelRatio * logicalSize` for sharpness
   - Provide `game.setQuality('high' | 'medium' | 'low')` for auto-adjustment
3. Memory management audit:
   - Verify all blob URLs revoked on game switch
   - Verify all AudioContext instances closed
   - Verify no detached DOM nodes from iframe destruction
4. Implement automatic FPS monitoring in dev mode
5. Add low-memory warning handler:
   - Listen for `window.onmemorywarning` (if available) or monitor heap
   - Reduce sprite quality or disable audio on low memory
6. Stress test: generate and switch 20 games in sequence
7. Long-running test: leave a game running for 30 minutes

**Verification**:
- FPS counter shows ≥ 60 on iPhone 15 during typical gameplay
- FPS counter shows ≥ 30 on iPhone SE 3rd gen
- Memory profiler shows < 200MB after playing 5 different games
- 30-minute stress test completes without crash

---

### R6: App Store Submission Requirements

**Description**: Prepare all metadata, policies, and compliance items for App Store review.

**Acceptance Criteria**:
- [ ] App Store Connect listing fully configured
- [ ] Privacy policy URL hosted and linked
- [ ] App description, keywords, and category set
- [ ] Screenshots for required device sizes (6.7", 6.1", 5.5")
- [ ] Age rating questionnaire completed
- [ ] Content moderation for AI-generated games implemented
- [ ] IDFA / tracking declaration completed (no tracking)
- [ ] Export compliance (encryption) declaration completed

**Tasks**:
1. Write privacy policy:
   - No user data collected by Gaimer
   - AI provider handles API data per their policies
   - OAuth tokens stored locally on device
   - No analytics or tracking
2. Write App Store description:
   - What the app does
   - How AI generation works
   - Provider requirements (user needs AI subscription)
   - Key features list
3. Generate screenshots:
   - Game creation flow
   - Sample games running
   - Settings / provider connection
   - 3 device sizes
4. Complete age rating:
   - User-generated content: Yes (AI-generated games)
   - Unrestricted web access: No
   - Simulated gambling: No
   - Violence: Infrequent/Mild (games may include it)
5. Implement basic content moderation:
   - AI provider's built-in content filtering
   - Block obviously inappropriate prompts client-side
   - Display content warning for generated games
6. Set export compliance:
   - Uses HTTPS: Yes
   - Exempt from export compliance (standard HTTPS only)
7. Configure App Store Connect listing
8. Prepare for review — include demo account / instructions for reviewer

**Verification**:
- Privacy policy accessible via URL
- All screenshot slots filled for required devices
- Age rating set to 12+ (appropriate for user-generated content)
- Content moderation blocks test inappropriate prompts
- App review notes clearly explain how to test AI generation

---

### R7: Content Security Policy

**Description**: Configure proper CSP for the WKWebView to replace the current `null` policy.

**Acceptance Criteria**:
- [ ] CSP defined in `tauri.conf.json` that allows app functionality
- [ ] Game sandbox iframe has restrictive CSP (no external network access)
- [ ] No `eval()` in main app context (only in sandbox iframe)
- [ ] Script sources limited to app bundle + inline (sandbox only)
- [ ] Style sources limited to app bundle + inline
- [ ] Image sources allow blob URLs (for sprites) and data URLs
- [ ] Connect sources limited to allowed AI provider domains

**Tasks**:
1. Define main app CSP in `tauri.conf.json`:
   ```
   default-src 'self';
   script-src 'self';
   style-src 'self' 'unsafe-inline';
   img-src 'self' blob: data:;
   connect-src https://api.anthropic.com https://api.openai.com;
   frame-src 'self' blob:;
   ```
2. Define sandbox iframe CSP (set via srcdoc meta tag):
   ```
   default-src 'none';
   script-src 'unsafe-inline';
   style-src 'unsafe-inline';
   img-src blob: data:;
   ```
3. Test that all app functionality works under CSP
4. Test that sandbox cannot make network requests
5. Test that sandbox cannot access parent DOM
6. Write unit test verifying CSP headers are set

**Verification**:
- No CSP violation errors in Safari Web Inspector console during normal use
- Sandbox iframe cannot `fetch()` external URLs
- Sandbox iframe cannot access `parent.document`
- All sprites load correctly via blob URLs under CSP

## Device Test Matrix

| Device | iOS Version | Test Priority |
|--------|-------------|---------------|
| iPhone SE 3rd gen | 17.4+ | High (lowest spec) |
| iPhone 13 | 17.4+ | Medium |
| iPhone 15 | 17.4+ | High (primary target) |
| iPhone 15 Pro Max | 17.4+ | High (largest screen) |
| iPhone 16 | 18.x | Medium (latest) |

## Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| Tauri CLI | ^2.0.0 stable | iOS build tooling |
| Xcode | 15.0+ | iOS compilation |
| CocoaPods | latest | iOS dependency management |
| Ruby | ≥ 2.6.0 | CocoaPods prerequisite |
| Apple Developer Account | Active | Signing + App Store submission |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| App Store rejection for AI content | Medium | High | Content moderation + clear disclosure |
| Tauri 2 iOS bugs | Medium | Medium | Track upstream, contribute reports |
| WKWebView performance limitations | Low | Medium | Canvas optimization, quality settings |
| Review delay (Apple turnaround) | Medium | Low | Submit early, iterate on feedback |
