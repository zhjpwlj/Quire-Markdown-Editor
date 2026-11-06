# Quire

Local-first markdown notes that sync to your cloud. Installable PWA, plain markdown in OPFS, opt-in sync and encryption.

Status: **Milestone 2 — OPFS storage.** Vaults create, switch, rename and delete; notes live in OPFS; deletes go to `.trash/`. No editor, sidebar, sync, or auth yet.

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

## Decisions taken in M1

- Plain JavaScript, Vite, no UI framework. Revisit TypeScript before the sync/provider work if type drift starts to hurt.
- Theme palette vars live per theme; editor/syntax vars are derived once in `app-shell.css` (§11.2) so no theme can miss one.
- Precached responses are matched with `ignoreVary: true`, and `Content-Encoding` is stripped
  at install: Cloudflare sends brotli on HTML, `cache.addAll` stores the decoded body with the
  header still attached, and replaying that as a document fails with `net::ERR_FAILED`.
- Swapping JSON handoff keys are prefixed `quire-` (Milestone 14).

## Verified

- `npm run check`: manifest fields and icon dimensions, CSP origins present, no placeholder leaked, every emitted JS/CSS precached, payload under 10 MB (currently ~59 KB).
- `npm test`: 11 e2e tests pass — offline reload served by the worker, CSP blocks foreign origins, manifest shape, fixed-body scroll, long-press debug log, and the M2 storage acceptance list (restart persistence, trash, vault order/delete, eviction recovery, `persist() === false`, localStorage keys).

## Not verified (needs hardware)

- iOS 26 standalone install, safe-area insets, status bar, and real offline launch.
- Safari 26 PWA/Safari shared storage — decides the OAuth handoff design at Milestone 14.
