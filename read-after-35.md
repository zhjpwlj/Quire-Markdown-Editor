Flag accepted. Below: the v4.3 errata summary (what changes in the spec), then **M36–M43** as the add-on series. These are a **retrofit** — M2–M35 produced a working iOS/macOS app against v4.2. M36–M43 make it cross-platform without regressing iOS.

---

## v4.3 errata summary (assumed applied before M36)

Four patches. Rest of the spec unchanged.

**§1.4 — Platform support, rewritten.** Replace the three-line list with the four-tier model:

| Tier | Platform | Build target |
|---|---|---|
| **1 — Full parity** | iOS/iPadOS installed PWA, macOS Safari installed PWA | Everything in spec |
| **2 — Near parity** | Chrome / Edge / Chromium desktop, ChromeOS, Chrome Android installed PWA, Samsung Internet (best-effort) | Everything + File System Access "open a folder" (desktop only) |
| **3 — Functional** | Firefox desktop, Firefox Android | Everything except File System Access. Not installable. |
| **4 — Unsupported** | Older browsers, embedded WebViews | Page loads, no guarantees |

Add: *"Platform tier is determined by runtime capability tests (§M36), not UA sniffing. If a capability is missing at runtime, the app degrades to the next tier and shows a one-time banner."*

**§2.3 — File System Access clarification.** Append to the File System Access bullet: *"`showDirectoryPicker()` is Chromium desktop and ChromeOS only. Chrome Android availability is unverified — flagged for M40. Not available in Firefox. On platforms without it, the vault is OPFS-backed and folders are imported once via `webkitdirectory` (§17.1's Obsidian-vault import path)."*

**§15.1 — OAuth callback handoff, per-platform.** Insert before the existing iOS paragraph:

> **Callback handoff (per platform):**
> - **Chromium desktop, ChromeOS:** callback tab and PWA share `IndexedDB` and `BroadcastChannel` on the same origin. Use `BroadcastChannel('quire-oauth')` for immediate handoff. Always write to `quire-oauth-handoff-<state>` in IndexedDB as a fallback.
> - **iOS/iPadOS, Chrome Android:** installed PWA and system browser are separate contexts. Use `quire-oauth-handoff-<state>` IndexedDB key; PWA reads on next foreground.
> - **Firefox:** same as Chromium desktop — the PWA is a tab, not installed, and `BroadcastChannel` works between tabs.
>
> Handoff entry expires 10 minutes after write, on every platform.

**§20 — Alt+F/Alt+T addendum.** The existing cross-platform caveat now reads: *"Hide Alt+F and Alt+T from the reference on all Windows/Linux browsers (not just Firefox/Edge/Chrome). Hide Alt+1–Alt+9 from the reference only where the browser intercepts them (Firefox). All bindings still fire via `event.code` where the OS doesn't grab them; actions remain reachable via palette per §CONSTRAINTS #11."*

---

## M36 — Capability detection and degradation

**Read first:** §1.4 (v4.3), §2.3 (v4.3).
**Prereq:** M35 done. **This milestone retrofits capability checks into the existing app. Nothing else in M36 changes behavior on iOS.**

**Deliverables:**
- `src/platform/capabilities.js` — runtime feature tests
- `src/platform/tiers.js` — tier classification
- `src/platform/gates.js` — feature gates (helpers used throughout the app)
- `src/ui/DegradationBanner.js` — one-time banner per missing capability
- `docs/capability-matrix.md` — the reference table (logged on startup in dev)

**Scope:**
- Capability tests at startup (sync, cached):
  - `hasOPFS`: `'getDirectory' in navigator.storage`
  - `hasWASM`: `typeof WebAssembly === 'object' && WebAssembly.validate(...)`
  - `hasCrypto`: `'subtle' in crypto`
  - `hasServiceWorker`: `'serviceWorker' in navigator`
  - `hasBroadcastChannel`: `'BroadcastChannel' in window`
  - `hasShowDirectoryPicker`: `'showDirectoryPicker' in window`
  - `hasShowOpenFilePicker`: `'showOpenFilePicker' in window`
  - `isStandalone`: `matchMedia('(display-mode: standalone)').matches || navigator.standalone === true`
  - `isInstallable`: `'BeforeInstallPromptEvent' in window || isStandalone` (Firefox lacks installability)
  - `hasPeristentStorage`: `'persist' in navigator.storage`
- Tier classification:
  - **Tier 1** if `hasOPFS && hasCrypto && isInstallable && isAppleMobileOrSafariDesktop`
  - **Tier 2** if `hasOPFS && hasCrypto && hasShowDirectoryPicker` OR (`isChromiumAndroid && hasOPFS`)
  - **Tier 3** if `hasOPFS && hasCrypto` (Firefox)
  - **Tier 4** otherwise
- Feature gates replace inline capability checks in existing code. Grep audit: no `if ('showDirectoryPicker' in window)` in app code after this milestone — all go through `gates.canOpenFolderOnDisk()`.
- Degradation banners (one-time per session, dismissible):
  - No `showDirectoryPicker`, Tier 3: *"Direct folder access needs Chrome or Edge on desktop. Your vault lives in browser storage."* — shown once when user first tries "Open a folder."
  - Not installable (Firefox): *"Add to Home Screen isn't available in Firefox. Open in Chrome, Edge, or Safari for the full app experience."* — shown once on first launch, "never show again" link.
  - Missing OPFS: hard block — *"Your browser doesn't support the storage this app needs. Please update or use a modern browser."* — no dismiss.

**Data shapes:**

```js
// capabilities snapshot
{
  hasOPFS: true,
  hasWASM: true,
  hasCrypto: true,
  hasServiceWorker: true,
  hasBroadcastChannel: true,
  hasShowDirectoryPicker: false,
  hasShowOpenFilePicker: false,
  isStandalone: true,
  isInstallable: true,
  hasPersistentStorage: true,
  tier: 1
}

// gate helper
gates.canOpenFolderOnDisk() → boolean
gates.canInstall() → boolean
gates.canHandoffViaBroadcastChannel() → boolean
```

**Implementation notes:**
- **// DECISION:** Never use UA sniffing for tier classification. Feature tests are authoritative. UA is used only in §20's browser-menu caveat, which is about a *specific documented collision*, not about gating features.
- **// DECISION:** `isInstallable` on Chrome reports true even when installed. Combine with `isStandalone` to know install state. Store both.
- **// DECISION:** Tests run once at startup, results cached in memory for the session. A hard reload is required for updated tests (browsers don't change capability mid-session).
- **// DECISION:** `hasShowDirectoryPicker` is a *presence* check. Actual API availability on Chrome Android is the flag M40 closes. If the API is present but broken at call time, catch and fall back to `webkitdirectory` import with a one-time toast.
- **// DECISION:** Tier computation is a pure function of capabilities. Log the tier in dev console on startup: `[quire] platform tier: 2 (chromium-desktop)`. This is how testers confirm which tier they're on.
- Degradation banner styling: fixed top, `env(safe-area-inset-top)` padding, amber accent, dismissible. Matches the sync-status visual language.
- **// DECISION:** The Firefox installability banner's "never show again" writes to `localStorage.suppressInstallBanner`. If the user later opens Quire in Chrome, they still see install prompts from that browser's own UI — the app doesn't re-show the banner.

**Out of scope:** Any behavior change on Tier 1. Any actual multi-platform testing (M39+). Rewriting §15.1's OAuth flow (M37).

**Acceptance:**
1. On iOS installed PWA: tier = 1, no degradation banners.
2. On macOS Safari tab: tier = 1 (or 3 if `isInstallable` false — verify which).
3. On Chrome desktop tab: tier = 2, `showDirectoryPicker` present, no installability banner.
4. On Chrome Android: tier = 2 (assuming flags pass), installability available, `showDirectoryPicker` presence verified.
5. On Firefox desktop: tier = 3, no `showDirectoryPicker`, installability banner appears once, "never show again" works.
6. On Firefox Android: same as Firefox desktop.
7. Grep `src/**` for `'showDirectoryPicker' in window` after milestone → 0 matches (all use `gates.canOpenFolderOnDisk()`).
8. Logged capability matrix matches `docs/capability-matrix.md`.
9. Existing iOS behavior unchanged — M2–M35 QA rows still pass.

**STOP.**

---

## M37 — OAuth callback per platform

**Read first:** §15.1 (v4.3 patch), §15.4.
**Prereq:** M36 done.
**Retrofit note:** M14's iOS-only handoff flow is refactored to per-platform, not replaced.

**Deliverables:**
- `src/auth/callbackHandoff.js` — platform-aware handoff
- Refactored `src/auth/callback.html`
- Refactored `src/auth/oauth.js` (PWA-side handoff consumer)
- Per-provider test scripts for Chromium desktop and Firefox

**Scope:**
- Handoff strategy selection at callback time:
  1. **Fast path (Chromium desktop, ChromeOS, Firefox):** BroadcastChannel `quire-oauth`. If a listening PWA tab/window is alive, post message and close callback tab.
  2. **Fallback / mobile (iOS, Chrome Android, any missed fast path):** write to `quire-oauth-handoff-<state>` in IndexedDB. PWA reads on next foreground.
- **Always write to IndexedDB as a fallback**, even when BroadcastChannel succeeds. Costs nothing; adds resilience against a missed message.
- Handoff entry expires 10 minutes. PWA discards on read if older.
- All 8 OAuth providers use the same handoff flow — the flow itself is provider-agnostic, already factored that way in M14.
- Refactor `callback.html` to run the code exchange *on the callback page* (already does — M14). No change to that. Only the handoff shape changes.

**Data shapes:**

```js
// IndexedDB record
{
  key: "quire-oauth-handoff-<state>",
  value: {
    provider: "github",
    accessToken: "gho_...",
    refreshToken: "ghr_...",
    expiresAt: 1761436800000,
    receivedAt: 1761436800000
  }
}

// BroadcastChannel message
{ type: "oauth-complete", state: "...", provider: "github", payload: { ... } }
```

**Implementation notes:**
- **// DECISION:** BroadcastChannel name is `quire-oauth` — namespaced for the same reason as the IndexedDB key (§15.1 v4.2 had `quire-oauth-handoff-`, this is consistent).
- **// DECISION:** Callback page closes itself after posting to BroadcastChannel (`window.close()`). On mobile where BroadcastChannel isn't listened to, the callback page shows: *"Sign-in complete. Return to Quire."* — user swipes back to the PWA.
- **// DECISION:** PWA checks IndexedDB handoff on: startup, `visibilitychange → visible`, and any manual `sync` trigger. This catches the mobile case where the user returns to the PWA without a fresh launch.
- **// DECISION:** `sessionStorage` for `code_verifier` and `state` remains the mechanism — scoped to the callback tab. This is unchanged across platforms.
- **// DECISION:** On Chromium desktop, if the PWA is running as a tab and the user starts OAuth, the callback opens as a *new tab* in the same browser. `BroadcastChannel` works between tabs. On ChromeOS, the PWA might be a *standalone window* — BroadcastChannel still works between windows of the same origin.
- **// DECISION:** If BroadcastChannel message is received but the message is malformed (shouldn't happen with same-origin policy, but defensive), log and fall through to IndexedDB. Never crash the callback flow.
- **// DECISION:** On Firefox desktop, `window.close()` works if the window was opened by script. If the user pasted the callback URL manually or it was redirected from system browser, close may fail silently — fall back to the "Return to Quire" message.
- Existing M14 acceptance tests still pass on iOS after this refactor.

**Out of scope:** Any provider changes. Any token shape changes. Any credential storage changes.

**Acceptance:**
1. Chrome desktop: sign in, handoff completes via BroadcastChannel in <1s (verify in DevTools console log). Callback tab closes.
2. ChromeOS: sign in, PWA window foregrounds, handoff completes.
3. Chrome Android: sign in, handoff via IndexedDB on next PWA foreground. Callback page shows "Return to Quire."
4. iOS: unchanged from M14 — handoff via IndexedDB on next foreground.
5. Firefox desktop: sign in, handoff via BroadcastChannel. Callback tab closes if script-opened; otherwise "Return to Quire."
6. All 8 providers tested per platform (GitHub, GitLab, Gitea, WebDAV skipped — Basic auth, not OAuth; Google, Dropbox, OneDrive, Box). Actually: WebDAV and WordPress publish use Basic auth; only the 7 OAuth providers matter.
7. Expired handoff (wait 11 minutes, then foreground): cleared with "Sign-in expired, try again."
8. Malformed BroadcastChannel message: logged, falls through to IndexedDB, no crash.
9. iOS M14 acceptance re-run: all pass.

**STOP.**

---

## M38 — File System Access API gating

**Read first:** §2.3 (v4.3 patch), §17.1 (Obsidian vault import), §6.1 (VaultManager).
**Prereq:** M37 done.
**Retrofit note:** M2's vault creation flow assumed OPFS-only. This milestone adds File System Access vaults on Chromium desktop and clarifies the import path everywhere else.

**Deliverables:**
- `src/platform/fsa.js` — File System Access wrapper
- Refactored `src/vault/VaultManager.js` — new `vaultType: 'opfs' | 'fsa'`
- Refactored vault-creation UI
- `src/ui/FolderImportBanner.js` — clarifies import vs live-edit

**Scope:**
- **Tier 2 Chromium desktop and ChromeOS only:** "Open a folder on disk" option in vault creation. Uses `showDirectoryPicker()`.
- **Everywhere else:** "Open a folder" hidden. Only "Create a vault" (OPFS) available. Folder ingest available via `webkitdirectory` import (one-way).
- Vault record gains `vaultType`. All downstream modules (FileModel, Sync, Search, LinkIndex, E2EE) treat both vault types uniformly through the OPFS-like interface.
- Folder import (`webkitdirectory`): reads files into OPFS vault. Clear messaging: *"This imports your notes into Quire. Changes won't sync back to the original folder."*

**Data shapes:**

```js
// vault.json gains vaultType
{
  id: "<uuid>", name: "My Notes", createdAt: ..., schemaVersion: 1,
  vaultType: "opfs" | "fsa",
  fsaHandle: FileSystemDirectoryHandle | null  // serialized via handle serialization in IndexedDB only, NOT in vault.json
}

// IndexedDB vaults record
{
  id, name, ..., vaultType, fsaHandleKey: "<idbKey>"
}
```

**Implementation notes:**
- **// DECISION:** `FileSystemDirectoryHandle` can be persisted in IndexedDB (structured clone supports it since Chrome 86). Store under a separate IndexedDB key, not in `vault.json` — handle is device-specific, `vault.json` is vault-scoped.
- **// DECISION:** On vault open with `vaultType: 'fsa'`, re-request permission via `handle.requestPermission({ mode: 'readwrite' })`. Chrome may still hold permission across sessions; verify prompt only appears when needed.
- **// DECISION:** Sync from an FSA vault works identically — SyncEngine reads/writes via the FileSystemAccess adapter, not OPFS directly. The FileModel is the uniform interface; only the adapter below differs.
- **// DECISION:** E2EE works on FSA vaults — encryption is applied at FileModel write/read, above the adapter. No change needed.
- **// DECISION:** If FSA permission is revoked while the app is running (user removes access in Chrome settings), operations throw `NotAllowedError`. Catch and prompt: *"Quire lost access to this folder. Grant permission again, or import the folder as an OPFS vault instead."*
- **// DECISION:** The `webkitdirectory` import from M26's Obsidian-vault import is reused here — same underlying code. M38 only adds the UI entry point in vault creation.
- **// DECISION:** "Open a folder" is *not shown* on Chrome Android in M38. If M40's verification confirms `showDirectoryPicker` works on Android, a v4.3.1 patch updates this. If not, it stays hidden.
- **// DECISION:** FSA vault + publish: publishing reads from disk, same as OPFS vaults. No special path.
- Migrating existing OPFS vaults to FSA (and back) is out of scope — user creates a new vault.

**Out of scope:** Migrating between vault types. Multi-folder vaults (one vault = one directory). Directory-level watchers (no `FileSystemObserver` — out of scope).

**Acceptance:**
1. Chrome desktop: "Open a folder" available in vault creation, `showDirectoryPicker` fires, folder opens as live vault.
2. Edits to a note in an FSA vault write to the real folder on disk. Verify via Files app / Finder.
3. Firefox: "Open a folder" hidden. "Create a vault" available. Folder import via `webkitdirectory` works.
4. iOS: same as Firefox.
5. Chrome Android: "Open a folder" hidden. Verify this is what M40 will confirm (if `showDirectoryPicker` works on Android, M40 closes the flag and v4.3.1 enables it).
6. FSA vault syncs, searches, encrypts identically to OPFS vault. Verify by creating same-vault on both and comparing sync results.
7. FSA permission revoked mid-session: clear prompt, no data loss.
8. `webkitdirectory` import creates OPFS vault populated from disk. No sync-back.
9. Existing iOS M2 vault creation still works unchanged.

**STOP.**

---

## M39 — Chromium desktop and ChromeOS verification

**Read first:** §1.4 (v4.3), §22.
**Prereq:** M38 done.
**Type:** Verification, not engineering. Gaps fixed inline; structural gaps escalated for v4.4.

**Deliverables:**
- `docs/qa-tier2-desktop.md` — per-row pass/fail report
- Bug fixes for any issues found (in-scope)

**Scope:**
- Full Part 22 QA matrix executed on: Chrome desktop (Windows), Chrome desktop (macOS), Edge desktop, ChromeOS
- All features: OPFS, FSA, sync, E2EE, credential protection, plugins, publishing, graph, search
- Alt+F and Alt+T hidden from reference on Windows/Linux; present on macOS
- PWA install flow on each
- Firefox-specific caveats N/A here

**Implementation notes:**
- **// DECISION:** ChromeOS PWA install differs from Chrome desktop — more integrated, default in the launcher. Test both install paths.
- **// DECISION:** Edge desktop may have subtle differences from Chrome (e.g., `showDirectoryPicker` behavior around permission persistence). Test separately.
- **// DECISION:** This milestone is where File System Access "open a folder" gets its first real-user-style test. Try opening an actual Obsidian vault from disk, edit, verify on disk.
- **// DECISION:** Any failed test row is either: fixed inline (in scope for M39), or documented with severity and scheduled for the next milestone that could fix it. Do not silently pass a failed test.
- **// DECISION:** Cross-browser install sync: an FSA vault opened in Chrome desktop tab should be openable in the PWA window too (same handle permission model). Verify.

**Out of scope:** Android, Firefox, iOS (already verified in M2–M35).

**Acceptance:**
1. Full Part 22 QA matrix on Chrome desktop Windows: every row pass or documented failure.
2. Same on Chrome desktop macOS.
3. Same on Edge desktop.
4. Same on ChromeOS.
5. FSA "open a folder" flow tested end-to-end on all four.
6. Alt+F / Alt+T hidden on Windows/Linux reference; present on macOS.
7. PWA install works, standalone, no browser chrome.
8. Report filed with per-row results and severity for failures.
9. No regressions on iOS/macOS Safari — re-run 5 rows from M35 as a spot check.

**STOP.**

---

## M40 — Chrome Android verification (flag closure)

**Read first:** §1.4 (v4.3), §2.3 (v4.3), §22.
**Prereq:** M39 done.
**Type:** Verification. **This is where the `showDirectoryPicker` flag closes.**

**Deliverables:**
- `docs/qa-tier2-android.md`
- `showDirectoryPicker` availability result — this determines whether v4.3.1 errata is needed
- Safe-area inset verification on Android notch devices
- Bug fixes

**Scope:**
- Full Part 22 QA matrix on Chrome Android installed PWA
- `showDirectoryPicker()` tested on hardware (Pixel 8 Pro, Samsung Galaxy S23+, at minimum)
- Safe-area insets on Android gesture bar and punch-hole cutout
- Keyboard behavior (Android's `visualViewport` differs from iOS)
- Samsung Internet spot test (capability-equivalent, quirks documented)
- PWA install flow on Android

**Implementation notes:**
- **// DECISION:** If `showDirectoryPicker` works on Chrome Android, v4.3.1 errata closes the flag: §2.3 updated to include Chrome Android, M38's UI updated to show "Open a folder" on Android. If not, v4.3.1 documents the negative result and no code change needed.
- **// DECISION:** Safe-area insets on Android use the same `env(safe-area-inset-*)` API. Verify on both a gesture-bar device and a physical-cutout device (Pixel has both, Samsung has gesture-bar only). Content must clear both.
- **// DECISION:** Android keyboard behavior: `visualViewport.height` is more reliable on Android than iOS but has quirks with Gboard. Test toolbar-above-keyboard and credential-prompt-above-keyboard explicitly.
- **// DECISION:** Samsung Internet is Chromium-based but has different `showDirectoryPicker` support timing (behind Chrome's version). Test and document; do not add a milestone for it.
- **// DECISION:** Alt+F / Alt+T are already hidden from reference on mobile (M12's platform detection covers Android). Verify.
- **// DECISION:** Android's "Add to Home Screen" flow may prompt for notification permissions differently. Test that the PWA installs cleanly.

**Out of scope:** Firefox (M41). Any iOS re-verification (M35 covered).

**Acceptance:**
1. Full Part 22 QA matrix on Chrome Android (Pixel 8+): every row pass or documented.
2. `showDirectoryPicker` result documented: works or does not work. Determines v4.3.1 errata.
3. Safe-area insets verified on Pixel 8 Pro (cutout + gesture bar) and Galaxy S23+ (gesture bar). Content clears both.
4. Keyboard behavior verified: toolbar above Gboard, credential prompt above Gboard.
5. PWA installs cleanly, standalone window, no browser chrome.
6. Samsung Internet spot test documented (no milestone, just notes).
7. Report filed.
8. If `showDirectoryPicker` works: v4.3.1 errata written, §2.3 and M38's UI updated in a follow-up patch. If not: v4.3.1 documents negative result, no code change.

**STOP.**

---

## M41 — Firefox verification

**Read first:** §1.4 (v4.3), §22.
**Prereq:** M40 done.
**Type:** Verification.

**Deliverables:**
- `docs/qa-tier3-firefox.md`
- Bug fixes for Firefox-specific issues
- Any plugin sandbox issues surfaced

**Scope:**
- Full Part 22 QA matrix on Firefox desktop and Firefox Android
- Excluded rows: File System Access (Firefox doesn't have it), installability (Firefox doesn't support PWA install), Alt+F/Alt+T (already hidden)
- Verify Alt+F/Alt+T hidden from reference on Firefox Windows/Linux
- Verify `webkitdirectory` import works on Firefox (folder ingest)
- Verify plugin sandbox (`quickjs-emscripten`) runs on Firefox's WASM runtime
- Verify E2EE, credential protection, sync, publishing, graph, search

**Implementation notes:**
- **// DECISION:** Firefox's WASM runtime is solid but `quickjs-emscripten` needs a fresh verification on Firefox specifically. The library was tested on Chromium during M27b. Run a minimal WASM test first; if that fails, plugin Tier 2 may need a Firefox-specific fallback or documentation that plugins require Chromium/Safari.
- **// DECISION:** Firefox Android's `webkitdirectory` support has historically been inconsistent. Test folder import; if broken, offer drag-drop of individual files as a fallback and document the limitation.
- **// DECISION:** Firefox iOS is technically WebKit (Apple requires it) — it shares Safari's capabilities. Do not test it as Tier 3. If tested, treat as Tier 1 with the caveat that installability UX differs (Firefox iOS has its own "Add to Home Screen" flow). Document this, do not add to QA matrix.
- **// DECISION:** Firefox has no `BroadcastChannel` between the PWA and system-browser callback if the PWA is a regular tab — but it *does* work between tabs. Verified via M37's flow.
- **// DECISION:** Installability banner appears once per session, "never show again" persists via localStorage. Verify.
- **// DECISION:** Firefox's CSP enforcement is strict — verify `connect-src` allowlist works. Firefox does not allow `script-src 'self' blob:` by default for `import()` — may need testing for Tier 3 plugins (M27c). If it fails, document that Tier 3 plugins are Chromium/Safari only.

**Out of scope:** iOS (M35). Chromium (M39/M40).

**Acceptance:**
1. Full Part 22 QA matrix on Firefox desktop: every row pass or documented as N/A per tier model.
2. Same on Firefox Android.
3. Installability banner appears once, "never show again" works, persists across restart.
4. Plugin sandbox (WASM VM): runs on Firefox, no DOM access, no network. If broken, documented with severity.
5. Tier 3 plugins (host API): verify `import()` from `blob:` URL works on Firefox. If not, documented (may be Chromium/Safari-only).
6. `webkitdirectory` import works. If broken on Firefox Android, drag-drop fallback works.
7. Alt+F/Alt+T hidden from reference.
8. Report filed.
9. Firefox iOS documented (not part of QA matrix; notes on installability UX).

**STOP.**

---

## M42 — Cross-platform sync, credentials, E2EE

**Read first:** §13, §15, §16, §CONSTRAINTS #14.
**Prereq:** M41 done.
**Type:** Verification of inter-platform behavior. Not a build milestone unless a gap surfaces.

**Deliverables:**
- `docs/qa-cross-platform.md`
- Bug fixes for any issues found

**Scope:**
- Same vault on multiple platforms, sync round-trip
- Credential storage per-device (device key is device-bound — §15.5)
- Credential protection passphrase cross-platform (same passphrase unlocks on all — salt is per-user)
- E2EE recovery key across platforms (salt is per-vault)
- Conflict resolution across platforms
- Publishing from each platform

**Implementation notes:**
- **// DECISION:** Device key is per-device by design (§15.5). Signing in to GitHub on iOS does not sign in to GitHub on Chrome desktop — each device has its own wrapped token. Test this is *expected behavior*, not a bug. Two sign-ins on two devices is correct.
- **// DECISION:** Credential protection passphrase is user-scoped (salt stored in `app-settings` localStorage). But localStorage is per-device. So each device needs the *same passphrase entered*. Salt is per-user across devices — same passphrase on device A and device B derives same KEK, so a wrapped credential from device A can be unwrapped on device B if copied. **BUT** credentials are not synced across devices (they're device-local by design). So in practice: user enables protection on iOS, then must enter same passphrase on Chrome desktop when Chrome desktop enables it too. Verify this flow is clear in the UI.
- **// DECISION:** E2EE salt is per-vault (in `vault.json`). Same vault on any platform derives same KEK. Recovery key works on any platform. Verify.
- **// DECISION:** Publishing credentials are per-device. Signing in to WordPress on iOS does not sign in on Chrome desktop. Each device that publishes signs in independently. Verify.
- **// DECISION:** Conflict resolution across platforms: same note edited on iOS and Chrome desktop without sync → conflict file created on whichever device syncs second. Verify on third device too (all three conflict).
- **// DECISION:** Cross-platform FSA-vs-OPFS vault: an FSA vault on Chrome desktop (source of truth on disk) syncing to OPFS vault on iOS (source of truth in browser storage) — both sync to same GitHub repo. Changes propagate correctly. Verify.

**Out of scope:** Cross-device credential migration (design decision: not supported — re-sign-in per device). Shared passphrases across users (not multi-user in v4.3).

**Acceptance:**
1. Create vault on iOS, sync to GitHub. Chrome desktop syncs → vault pulled correctly.
2. Edit note on Chrome desktop, sync. iOS syncs → edit propagates.
3. Edit note on Chrome Android, sync. Both iOS and Chrome desktop sync → edit propagates.
4. Conflict: same note edited on iOS and Chrome desktop without sync. Sync on both → conflict files exist on both, no data loss.
5. Three-way conflict: same note edited on iOS, Chrome desktop, Firefox (all without sync). All sync → each device has conflict files (some may be duplicates with timestamps — acceptable per keep-both policy).
6. Credentials per device: sign in to GitHub on iOS. On Chrome desktop, sign-in prompt appears (expected). Sign in on Chrome desktop → both work.
7. Credential protection: enable on iOS with passphrase P. On Chrome desktop, enable with same passphrase P. Both derive same KEK (verify KEK bytes differ due to different per-device salt? **NO** — per-user salt is in localStorage, so different devices have different local storage salt. Wait — need to verify this). Document correct behavior clearly.
8. E2EE: enable on iOS with passphrase P. Chrome desktop: use recovery key → vault unlocks. Use passphrase P → also unlocks (salt is per-vault).
9. Publish from Chrome desktop to GitHub Pages → site live. Publish from iOS → no duplicate site, same site updated.
10. FSA vault on Chrome desktop syncing to OPFS vault on iOS via shared GitHub repo. Changes propagate. Verify.

**Note on #7:** The credential protection passphrase derivation needs verification. If per-user salt is stored in `app-settings` (localStorage), each device has its own salt → different KEK → wrapped credentials from device A cannot be unwrapped on device B. This is fine because credentials don't sync. But the *behavior* must be documented clearly: "Enabling credential protection on each device requires entering the passphrase on that device." Verify the UX makes this clear.

**STOP.**

---

## M43 — Cross-platform QA matrix closure

**Read first:** Part 22, all prior QA reports (M35, M39, M40, M41, M42).
**Prereq:** M42 done.
**Type:** Final verification. **This is the last milestone.**

**Deliverables:**
- Updated Part 22 in the spec with per-tier columns
- `docs/qa-final.md` — consolidated matrix
- v4.3.1 errata (if `showDirectoryPicker` on Chrome Android needs updating per M40)
- v4.4 errata (if any structural gaps surfaced in M39-M42)

**Scope:**
- Extend Part 22 QA matrix to have per-platform columns: iOS installed, macOS Safari installed, Chrome desktop, Edge desktop, ChromeOS, Chrome Android installed, Samsung Internet, Firefox desktop, Firefox Android
- Execute every row on every platform (or mark N/A per tier model, justified)
- Consolidate per-milestone reports into a single matrix
- Publish v4.3.1 or v4.4 errata if needed
- Final decision: **does Quire ship?**

**Implementation notes:**
- **// DECISION:** N/A justification required per row. "This is not supported in Tier 3" is only valid if the tier model documents it. "We didn't test it" is not valid — mark as NOT TESTED and escalate.
- **// DECISION:** If any N/A row is a regression from M2-M35's iOS-only test (i.e., a feature that worked on iOS now doesn't), it's a blocking failure. Cross-platform support must not regress Tier 1.
- **// DECISION:** v4.3.1 errata scope is limited to `showDirectoryPicker` on Chrome Android. v4.4 errata is for any structural gap surfaced in M39-M42 that couldn't be fixed inline. Do not mix — separate errata documents.
- **// DECISION:** Final QA pass must include the "capability log" — a screenshot of the startup console showing the tier for each device tested. This is how we verify M36 is working as designed.
- **// DECISION:** The matrix in the spec is the human checklist (per §22 preamble). Do not add CI-generated pass/fail to the spec — the matrix is written for humans running it.

**Out of scope:** New features. Any platform not in the tier model. Emulator testing (must be hardware).

**Acceptance:**
1. Full Part 22 executed on all 9 platforms (Tier 1: iOS, macOS Safari; Tier 2: Chrome desktop, Edge desktop, ChromeOS, Chrome Android, Samsung Internet; Tier 3: Firefox desktop, Firefox Android).
2. Every row has a result: PASS, FAIL (with repro), or N/A (with tier-model justification).
3. No regressions on iOS or macOS Safari (spot-check every row that was PASS in M35).
4. `showDirectoryPicker` on Chrome Android documented (result from M40).
5. v4.3.1 errata published if M40 found `showDirectoryPicker` works on Android (spec update) or documented negative result.
6. v4.4 errata published if any M39-M42 gaps couldn't be fixed inline.
7. Capability log screenshot per device.
8. Consolidated `docs/qa-final.md` filed.
9. **Quire v4.3 ships cross-platform.**

**STOP.** End of build series, cross-platform edition.

---

## Feed notes

**Sequencing:** Strictly M36 → M37 → M38 → M39 → M40 → M41 → M42 → M43. Out-of-order will surface verification failures that require re-running earlier milestones.

**M36 is the retrofit foundation.** Everything after depends on the capability layer. Do not shortcut it — running M39's Chromium desktop verification without M36 in place means half the acceptance criteria are untestable.

**M40 is the flag.** If `showDirectoryPicker` works on Chrome Android, v4.3.1 becomes a small positive errata (add Android to §2.3, enable UI in M38). If it doesn't, v4.3.1 becomes a small negative errata (confirm exclusion). Either way, this is a *one-line document update*, not a milestone.

**M39, M40, M41 are testing, not building.** If they surface structural gaps (e.g., Firefox WASM sandbox fails, or Edge has a CORS quirk), those gaps are escalated and either: (a) fixed inline if scoped, or (b) documented in v4.4 errata with a known limitation. Do not silently pass.

**M42 is where most "surprise" bugs live.** Cross-platform sync, per-device credentials, E2EE cross-platform — this is where the spec's design choices (per-device device key, per-vault E2EE salt, per-user credential salt) get exercised end-to-end. Budget extra time. If a choice turns out to be wrong in practice, that's a v4.4 errata conversation.

**M43 closes the flag formally.** It's the milestone that converts the tier model from spec-proposal to shipped-behavior. After M43, Quire's supported platform matrix is defined and tested.

**One thing to watch:** the four-tier model is a *testing* and *documentation* tier — the code is one codebase. If a milestone reveals that a tier's behavior requires code-level divergence (e.g., a whole separate Firefox-specific code path), that's a signal the tier model was too optimistic. Flag it. Do not silently add a code path.
