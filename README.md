# Quire

Local-first markdown notes that sync to your cloud. Installable PWA, plain markdown in OPFS, opt-in sync and encryption.

Status: **Milestone 4 — sidebar and navigation.** Folder tree, pointer drag-and-drop, rename, duplicate and delete (to trash) work against OPFS. No preview, search, sync, or auth yet.

## Run

```sh
npm install
npm run dev          # dev server with CSP + HMR
npm run build        # production build
npm test             # build, build assertions, offline/MV3 e2e (Chromium)
node scripts/seed-vault.mjs   # seed a "Seed" vault (needs `vite preview` on :4173)
```

`npm test` needs one browser download once: `npx playwright install chromium`.

## Deploy at the domain root

`manifest.webmanifest` sets `id`, `start_url`, and `scope` to `/`. If Quire is served from a subpath, change all three consistently **before first install** — changing them after install orphans the installed app from its own storage.

## CSP is a fixed allowlist

The allowlist is compiled into the page at build time (`vite.config.js`); `connect-src` cannot be widened at runtime. Self-hosted providers (Gitea, self-hosted GitLab, WebDAV) and self-hosted publish targets (WordPress, custom endpoint) need a custom build:

```sh
CSP_EXTRA_ORIGINS="https://gitea.example.com https://blog.example.com" npm run build
```

Runtime host enforcement is `SafeFetch` (Milestone 13), which rejects origins outside the configured provider list.

## GitHub sign-in needs one stateless relay

GitHub's token endpoint requires `client_secret` for the web flow and sends no CORS headers, so a browser-only PKCE exchange is impossible. Quire uses a stateless Worker (`worker/`, Milestone 14) that receives `{ code, codeVerifier }`, adds the secret, and returns tokens. It stores nothing. All GitHub API traffic stays direct from the browser to `api.github.com`.

Until then, the `/oauth/callback` page is a stub.

## Storage model (M2)

- Files live at OPFS `quire/vaults/<uuid>/<path>`; each vault has `.quire/vault.json` and `.trash/`.
- IndexedDB database `quire` holds vault records plus the empty stores later milestones fill.
- `localStorage` holds only `activeVaultId` and `vaultOrder`; order is stored because IndexedDB returns rows in key (UUID) order, not creation order.
- Deleting a note moves it to `.trash/<UTC timestamp>/<original path>`; `emptyTrash()` is the only hard delete.
- Deleting a vault moves its whole folder to `quire/vaults/.trash/<id>-<timestamp>` (§6.1).
- On startup, vault records whose `.quire/vault.json` is missing are treated as evicted and dropped, so the app prompts for a first vault instead of crashing.
- `window.__quire` is an internal test/seed handle, marked `shortcut:` in `src/main.js`; remove before 1.0.

## Editing model (M3)

- `FileModel` owns note records (`path`, `title`, `content`, `mtime`, `size`, `dirty`) and the debounced writer. `readNote()` always reads OPFS; content is never trusted from a previous vault.
- Autosave is trailing-debounce 500ms. `flush()` runs on note navigation, `visibilitychange → hidden`, and `pagehide`. `beforeunload` is deliberately unused (iOS Safari does not fire it reliably).
- **Known ceiling:** the unload flush is asynchronous, so a tab killed in the same tick can lose the last keystroke. The window is bounded by the 500ms debounce; there is no synchronous OPFS write on the main thread.
- Frontmatter is preserved byte-for-byte. Nothing parses or reformats it until M8.
- The editor is CodeMirror 6 with `@codemirror/lang-markdown` and `theme-one-dark` as the placeholder surface; M10 replaces the colors with theme CSS vars.

## Sidebar and file operations (M4)

- Folders sort before files at every level; names use `localeCompare(..., { numeric: true, sensitivity: 'base' })`.
- Drag-and-drop uses pointer events with a floating clone, not HTML5 DnD (unreliable on iOS). Dropping onto a file is a no-op; folder reordering is not supported in Simple Mode.
- Rename follows §6.2: write the new file with byte-identical content, then remove the old one directly (rename is not a delete). Frontmatter and aliases pass through untouched.
- `LinkIndex.getIncoming()` is an interface stub returning `[]`; M6 replaces it. When it reports more than 50 incoming links, the rename modal asks first and Cancel aborts before any write.
- Deleting a note or folder moves it to `.trash/`; `.trash/` is never shown in the tree.
- Filenames are validated, not sanitized: `/`, `\`, `:`, control characters, and trailing space or dot are rejected with a visible error.

## Decisions taken in M1

- Plain JavaScript, Vite, no UI framework. Revisit TypeScript before the sync/provider work if type drift starts to hurt.
- Theme palette vars live per theme; editor/syntax vars are derived once in `app-shell.css` (§11.2) so no theme can miss one.
- Precached responses are matched with `ignoreVary: true`, and `Content-Encoding` is stripped
  at install: Cloudflare sends brotli on HTML, `cache.addAll` stores the decoded body with the
  header still attached, and replaying that as a document fails with `net::ERR_FAILED`.
- Swapping JSON handoff keys are prefixed `quire-` (Milestone 14).

## Verified

- `npm run check`: manifest fields and icon dimensions, CSP origins present, no placeholder leaked, every emitted JS/CSS precached, payload under 10 MB (currently ~588 KB, CodeMirror included).
- `npm test`: 24 e2e tests pass — offline reload served by the worker, CSP blocks foreign origins, manifest shape, fixed-body scroll, long-press debug log, the M2 storage acceptance list (restart persistence, trash, vault order/delete, eviction recovery, `persist() === false`, localStorage keys), the M3 editor list (debounced write, pagehide flush, frontmatter round-trip, mtime/size after restart, dirty flag, single editor instance, no CodeMirror warnings), and the M4 sidebar list (drag into folder, rename, 60-link cancel, delete to trash, natural sort, empty folder, filename validation).

## Not verified (needs hardware)

- iOS 26 standalone install, safe-area insets, status bar, and real offline launch.
- Safari 26 PWA/Safari shared storage — decides the OAuth handoff design at Milestone 14.
