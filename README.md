# Quire

Local-first markdown notes that sync to your cloud. Installable PWA, plain markdown in OPFS, opt-in sync and encryption.

Status: **Milestone 1 — app shell only.** No storage, editor, sync, or auth yet.

## Run

```sh
npm install
npm run dev          # dev server with CSP + HMR
npm run build        # production build
npm test             # build, build assertions, offline/MV3 e2e (Chromium)
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

## Decisions taken in M1

- Plain JavaScript, Vite, no UI framework. Revisit TypeScript before the sync/provider work if type drift starts to hurt.
- Theme palette vars live per theme; editor/syntax vars are derived once in `app-shell.css` (§11.2) so no theme can miss one.
- Precached responses are matched with `ignoreVary: true` — CDNs send `Vary: Origin` on JS/CSS and would otherwise miss offline.
- Swapping JSON handoff keys are prefixed `quire-` (Milestone 14).

## Verified

- `npm run check`: manifest fields and icon dimensions, CSP origins present, no placeholder leaked, every emitted JS/CSS precached, payload under 10 MB (currently ~59 KB).
- `npm test`: shell boots and stays styled with the network offline after one visit; CSP blocks a non-allowlisted origin; manifest is served and installable-shaped.

## Not verified (needs hardware)

- iOS 26 standalone install, safe-area insets, status bar, and real offline launch.
- Safari 26 PWA/Safari shared storage — decides the OAuth handoff design at Milestone 14.
