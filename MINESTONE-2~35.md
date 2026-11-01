Same structure as before, but each milestone now carries **Deliverables** (files/modules that should exist), **Data shapes** (schemas and API contracts), **Implementation notes** (gotchas), **Acceptance** (specific tests), plus the existing **Read first / Scope / Out of scope**.

Two things up front:

**Feed template.** Prepend each milestone with this to the build AI:

```
You are implementing Quire v4.2, Milestone N. Load spec sections listed below. Do not proceed past the STOP. Do not implement anything under "Out of scope," even if trivial. Add // DECISION: comments on every platform workaround. If spec conflicts with implementation, follow CONSTRAINTS #13.
```

**Structural.** M27 and M30 are still split (a/b/c) for feedability. M14–M21 remain blocked on the domain decision — but their per-milestone detail assumes the domain is confirmed. M13 is unblocked and can proceed while you resolve it.

---

## M2 — OPFS storage

**Read first:** §2.3, §2.12, §3.3, §6.1, §21 (OPFS rows), §22 (storage rows).
**Prereq:** M1 (shell + service worker, offline load verified).

**Deliverables:**
- `src/storage/opfs.js` — OPFS wrapper
- `src/storage/trash.js` — trash helpers
- `src/vault/VaultManager.js` — vault CRUD
- `src/storage/idb.js` — IndexedDB schema init (empty stores: `vaults`, `syncConfigs`, `publishConfigs`, `syncState`, `cryptoKeys`, `searchIndex`, `linkIndex`, `appState`)
- `scripts/seed-vault.mjs` — dev-only script to seed a test vault

**Scope:**
- `getDirectory()`, `readFile(path)`, `writeFile(path, content)`, `listFiles(path)`, `deleteFile(path)`, `moveToTrash(path)`, `createFolder(path)`, `moveFile(from, to)`.
- All paths relative to `/quire/vaults/<vault-id>/`. The vault-id is a UUID generated at creation.
- Trash: `.quire/vaults/<id>/.trash/<timestamp>/<original-path>`. Timestamp format `YYYY-MM-DDTHH-MM-SS-mmmZ`.
- VaultManager: `createVault({ name })`, `listVaults()`, `switchTo(id)`, `deleteVault(id)`, `renameVault(id, name)`.
- Storage persistence: call `navigator.storage.persist()` on vault open. Log the result. Do not gate anything on it.
- Storage-eviction recovery: if OPFS is empty on startup, prompt to create the first vault (default name "My Notes"), do not crash.

**Data shapes:**

```js
// .quire/vaults/<id>/.quire/vault.json — stub for now, expanded in M8 and M25
{
  "id": "<uuid>",
  "name": "My Notes",
  "createdAt": 1761436800000,
  "schemaVersion": 1
}

// IndexedDB vaults record — mirrors the above plus runtime state
{
  id, name, createdAt, lastOpenedAt, syncConfigId: null, publishConfigId: null, e2eeEnabled: false
}
```

**Implementation notes:**
- OPFS `getDirectory()` requires a user gesture on first call in some browsers — gate `init()` on the shell being ready and a synchronous entry point.
- `writeFile` uses `FileSystemFileHandle.createWritable()` → `write()` → `close()`. Do not leave a writable open across awaits.
- `listFiles` uses an async iterator over `dirHandle.entries()`. Do not `await` in a tight loop over >100 files — batch by directory depth.
- Trash is a normal directory. Deletes are `moveFile` to trash, not `deleteFile`. Hard delete only via explicit "empty trash" action (lands in M11 command palette, implemented here as `emptyTrash()`).
- **// DECISION:** Use ISO-with-dashes for the trash subfolder timestamp. Colons are legal on OPFS but break some export paths; dashes are safe everywhere.

**Out of scope:** FileModel, editor, sidebar, sync, encryption, E2EE, `vault.json` fields beyond the stub. Do not create `sync.json` or `publish.json` yet.

**Acceptance:**
1. Create vault "Test 1", create note "hello.md", write "Hello world", restart app, note present with correct content.
2. Delete note → appears in `.trash/<timestamp>/hello.md`, not gone.
3. `emptyTrash()` → `.trash/` is empty.
4. Create 3 vaults, switch between them, list shows all 3, active persists across restart.
5. Simulated eviction: clear OPFS via DevTools, restart app → prompt to create first vault, no crash, no console error.
6. `navigator.storage.persist()` returns `false` on iOS — functionality unaffected.
7. Nothing on-device writes to `localStorage` except `activeVaultId` and `vaultOrder` (verify in DevTools).

**STOP.**

---

## M3 — FileModel + basic editor (CodeMirror)

**Read first:** §3.4, §6.2, §6.3, §21 (frontmatter row).
**Prereq:** M2 done.

**Deliverables:**
- `src/vault/FileModel.js` — note CRUD + dirty tracking
- `src/editor/EditorController.js` — mode-agnostic facade
- `src/editor/SourceEditor.js` — CodeMirror 6 wrapper
- `src/editor/autosave.js` — debounced writer

**Scope:**
- FileModel: `readNote`, `writeNote` (debounced 500ms), `createNote`, `deleteNote` (to trash), `listNotes`, `flush`.
- `writeNote` updates `mtime`, sets `dirty: true` until `flush` completes.
- `flush()` forces all dirty writes synchronously, awaits completion. Called on: navigation away from note, vault switch, `visibilitychange → hidden`, `pagehide`.
- EditorController: `load(content, path)`, `getContent()`, `focus()`, `setMode('source' | 'split' | 'preview')` — only `'source'` functional this milestone. `'split'`/`'preview'` throw `NotImplemented`.
- SourceEditor: CodeMirror 6 with `@codemirror/lang-markdown`, `@codemirror/theme-one-dark` as placeholder. Wrap so themes can swap CSS later (M10).
- Frontmatter block is preserved verbatim — no parsing yet, no reformatting. If a note has `---` on line 1, keep it byte-identical.

**Data shapes:**

```js
// FileModel in-memory record
{
  path: "folder/note.md",
  title: "note",          // filename without .md
  content: null,          // lazy; loaded on readNote
  frontmatter: null,      // populated in M8
  tags: [],
  aliases: [],
  outgoingLinks: [],      // populated in M6
  mtime: 1761436800000,
  size: 1234,
  dirty: false
}
```

**Implementation notes:**
- The 500ms debounce is *leading-edge-with-trailing-commit*: first keystroke starts a timer, subsequent keystrokes reset it, timer fires → write. If the timer is pending and `flush()` is called, write immediately and clear the timer.
- `visibilitychange → hidden` on iOS may fire after the page is already being frozen. Use `pagehide` as a backstop.
- **// DECISION:** Never use `beforeunload` for the flush — iOS Safari does not reliably fire it. `pagehide` + `visibilitychange` covers the cases observed.
- CodeMirror extensions: `history`, `keymap` (default), `markdown`, `syntaxHighlighting`, `lineNumbers` (toggle in settings later). Do not enable `autocompletion` yet — deferred.
- On `load(path)`, always read content from OPFS. Do not trust an in-memory cache across vault switches.

**Out of scope:** Milkdown/RichEditor (M30a). Split/preview modes (M5 for preview, M30a for split). Sidebar (M4). Rename (M4). Preview pipeline (M5). Search (M7). LinkIndex (M6). Themes (M10).

**Acceptance:**
1. Open `note.md`, type, wait 500ms → file on disk contains new content.
2. Type, immediately close tab → on next open, content is present (verify via `flush` on `pagehide`).
3. Frontmatter block `---\ntitle: x\n---` survives a round-trip byte-identical.
4. Restart app → note still there, `mtime` updated on save, `size` matches content length.
5. `dirty` flag: true during edit, false after `flush()`. Verify via DevTools.
6. No console warnings from CodeMirror (verify no duplicate instance on rapid navigation).

**STOP.**

---

## M4 — Sidebar, navigation, rename, delete

**Read first:** §6.2 (renames), §6.5 (`getIncoming`), §7.2 (file tree spec), §8.1 (Power layout), §22 (rename rows).
**Prereq:** M3 done. **LinkIndex `getIncoming(path)` must be *designed*, not implemented — the interface shape is what this milestone consumes.**

**Deliverables:**
- `src/ui/Sidebar.js` — folder tree
- `src/ui/FileTree.js` — tree render + DnD
- `src/ui/RenameModal.js` — rename with >50-link prompt
- `src/ui/NewNoteModal.js`
- `src/vault/rename.js` — rename algorithm

**Scope:**
- Sidebar: folders first, then files, natural sort at each level. Natural sort = `localeCompare(..., { numeric: true, sensitivity: 'base' })`.
- Click file → open. Click folder → expand/collapse. State persists in memory (not on disk yet — disk persistence in M30a).
- Drag file → move into folder. Drag onto another file → no-op (no file-in-file).
- Drag folder to reorder — **not in this milestone.** Simple Mode's default sort does not support custom ordering (§7.2). Deferred.
- Context menu: New Note here, New Folder here, Rename, Delete (to trash), Duplicate.
- Rename flow (§6.2):
  1. Write new file (new content copied verbatim), delete old file (do NOT move to trash — rename is not a delete).
  2. Get `LinkIndex.getIncoming(path)` — **stub returns `[]` this milestone**; M6 wires it.
  3. Rewrite incoming links — **stub logs `// DECISION: Link rewriting lands M6`** and does not modify other files.
  4. Preserve frontmatter aliases verbatim.
  5. If `getIncoming().length > 50`, prompt: "Rename will update N notes' links. Continue?" Cancel aborts cleanly before step 1.
- Delete: `deleteNote` (to trash), no confirmation dialog in this milestone (added in M30a with proper UX).

**Implementation notes:**
- Drag-and-drop on iOS is unreliable via HTML5 DnD. Implement via `pointerdown`/`pointermove`/`pointerup` with a floating clone — CodeMirror-independent.
- The sidebar must show *all* vault content including `.trash/`? **No.** `.trash/` is hidden from the tree always. Empty-trash action lives in command palette (M11).
- **// DECISION:** Rename writes the new file first, then deletes the old. If the delete fails after the write, we have both files — recoverable (user can delete one). Reverse order risks data loss. Priority order §CONSTRAINTS #13(a).
- Filename validation: reject `/`, `\`, `:`, control chars, trailing space/dot on Windows-parity. Do not sanitize silently — show error.

**Out of scope:** Link rewriting (M6). Custom sort in Simple Mode (never — §7.2). Recycle bin UI (M30a). Confirmation dialogs (M30a). File tree persistence across restarts (M30a).

**Acceptance:**
1. Create folder "Projects", drag "note.md" into it. Verify on disk.
2. Rename "note.md" → "note-2.md". Old file gone, new exists, frontmatter preserved byte-identical.
3. Rename with 60 backlinks (manually seeded) → prompt shows, cancel aborts before any write.
4. Delete → file in `.trash/`, tree updates.
5. Natural sort: `Note 2.md` before `Note 10.md`, folders always above files at each level.
6. Drag on iOS: pointer events work, no HTML5 DnD ghost.
7. Empty folder shows "This folder is empty."

**STOP.**

---

## M5 — Preview pipeline (marked + DOMPurify)

**Read first:** §6.4, §10.1, §10.2, §21 (frontmatter, wiki-link, missing-embed rows), §22 (XSS, blob-URL rows).
**Prereq:** M3 done (M4 optional).

**Deliverables:**
- `src/render/RenderPipeline.js` — `render(markdown) → { html, links, embeds, headings }`
- `src/render/extensions/wikilink.js`
- `src/render/extensions/embed.js`
- `src/render/extensions/tag.js`
- `src/render/blobUrlRegistry.js` — per-render Set lifetime
- `src/render/sanitize.js` — DOMPurify config

**Scope:**
- `render(markdown)` returns HTML plus metadata (`links` for LinkIndex, `embeds` for attachment resolution, `headings` for anchor IDs).
- Wiki-links:
  - `[[note]]` → `<a data-wikilink="note" class="wikilink">note</a>`
  - `[[note|display]]` → `<a data-wikilink="note" class="wikilink">display</a>`
  - `[[note#heading]]` → `<a data-wikilink="note" data-anchor="heading" class="wikilink">note</a>`
  - Unresolved (stub — resolution lands M6): add `class="wikilink wikilink-unresolved"`
- Embeds:
  - `![[image.png]]` → `<img data-embed="image.png">` with `src` set to `blob:` URL at render time. URL tracked in per-render Set.
  - `![[file.pdf]]` → download chip (`<a class="embed-file" download>file.pdf</a>`)
  - Missing → `<span class="embed-missing">![[image.png]]</span>` — original text preserved, styled red in UI.
- Tags: `#tag` → `<a class="tag">#tag</a>`. Do not double-wrap tags inside code spans or headings.
- Sanitization: DOMPurify whitelist. Strip `<script>`, `<iframe>`, `<object>`, `<embed>`, `on*` handlers, `javascript:` URLs. Allow `data-*` attributes only for `data-wikilink`, `data-anchor`, `data-embed`.
- Blob URL lifetime: **per-render `Set<blobUrl>`**. Every URL created is added. `releaseBlobUrls(renderId)` revokes the whole set. Never share a URL between renders — verify by rendering the same note twice and confirming two distinct URLs.
- Dev-only preview pane: `setMode('preview')` in EditorController renders read-only. Toggle button in the toolbar (dev-visible only, will be restyled M30a).

**Data shapes:**

```js
// render() return shape
{
  html: "<p>...</p>",
  links: [{ target: "note", display: "note", isEmbed: false, anchor: null }, ...],
  embeds: [{ path: "image.png", isMissing: false }, ...],
  headings: [{ level: 1, id: "heading-id", text: "Heading Text" }, ...],
  renderId: "<uuid>"  // for releaseBlobUrls
}
```

**Implementation notes:**
- marked's `extensions` API: each extension defines `name`, `level: 'inline'`, `start(src)`, `tokenizer(src)`, `renderer(token)`. Wiki-links and tags are inline; embeds are inline too (they can appear mid-paragraph).
- **// DECISION:** Tag regex is `/(^|\s)#([a-zA-Z0-9_-]+)/g` — requires whitespace or start-of-line before `#`. This avoids matching URL fragments `#section` inside links. Standard trade-off; document it in the tag tokenizer.
- Heading IDs: slugify with `text.toLowerCase().replace(/[^a-z0-9]+/g, '-')`. Duplicate slugs get `-1`, `-2` suffixes per-document. This is what `[[note#heading]]` anchors resolve to.
- **// DECISION:** `opfs://` is not a real scheme. Embeds always go through `URL.createObjectURL(file)` at render time. Attachment loading is synchronous-ish from an in-memory File cache (populated on vault open) — the embed tokenizer does not `await`.
- DOMPurify: use `ALLOWED_TAGS` + `ALLOWED_ATTR` whitelist, not the default (default allows `<style>`, which we don't want). Add `RETURN_TRUSTED_TYPE: false` — we render into standard DOM.
- Preview mode is `readOnly` — no editing.

**Out of scope:** LinkIndex real resolution (M6). Split view (M30a). Live preview while typing (§1.5 — deferred). Custom embed types beyond image/PDF.

**Acceptance:**
1. Render a note with all extensions — no crash, all elements present.
2. `[[broken]]` renders muted/dashed (`wikilink-unresolved`).
3. `![[missing.png]]` renders broken, original text preserved.
4. Paste `<script>alert(1)</script>` into a note → sanitized on render, no execution, no alert.
5. Paste `<img src=x onerror=alert(1)>` → `onerror` stripped.
6. Open a note with 5 images, close, reopen, close — `createObjectURL`/`revokeObjectURL` delta returns to 0.
7. Render the same note twice simultaneously (dev tool) — two distinct blob URLs, revoking one does not break the other.
8. Heading IDs are stable across renders of the same content.

**STOP.**

---

## M6 — LinkIndex and backlinks

**Read first:** §6.5, §10.2, §10.3, §5 (`link-index-updated`).
**Prereq:** M5 done.

**Deliverables:**
- `src/index/LinkIndex.js` — index build + query
- `src/index/linkResolver.js` — resolution order
- `src/ui/BacklinksPanel.js` — basic list
- `src/ui/DisambiguationPopover.js`
- Complete the rename link-rewrite from M4

**Scope:**
- LinkIndex data structure (in-memory, serialized to IndexedDB):
  ```
  outgoing: Map<path, Array<{ target, display, isEmbed, anchor, line }>>
  incoming: Map<path, Array<{ from, display, isEmbed, anchor, line }>>
  aliases:  Map<alias, Array<path>>
  byName:   Map<basename-lowercase, Array<path>>
  ```
- Rebuild strategies (§6.5): full on vault open, incremental on `note-saved`, full on `note-renamed`.
- `resolveLink(target)`:
  1. Exact path match → return single.
  2. Case-insensitive filename (basename without extension) → return list.
  3. Alias match → return list.
  4. If list > 1, prefer closest to current note (same folder → parent → root).
  5. If still ambiguous, return `{ resolved: null, candidates: [...], ambiguous: true }` — caller shows popover.
- Wire RenderPipeline to real resolution. Re-render on `link-index-updated`.
- Complete M4's rename link-rewrite: iterate `getIncoming(oldPath)`, rewrite each file. Use `writeNote` so `dirty`/`mtime` flow correctly.
- Backlinks panel: list incoming notes with 1-line context snippet. Click → navigate.
- Disambiguation popover: when a wiki-link click is ambiguous, show candidates. Do not auto-pick.

**Data shapes:**

```js
// serialized linkIndex (IndexedDB, key: [vaultId, 'links'])
{
  version: 1,
  builtAt: 1761436800000,
  outgoing: { "/note.md": [...] },
  incoming: { "/target.md": [...] },
  aliases: { "alias1": ["/a.md", "/b.md"] },
  byName: { "note": ["/folder/note.md", "/other/note.md"] }
}
```

**Implementation notes:**
- **// DECISION:** `resolveLink` returns `{ resolved, candidates, ambiguous }` — never throws, never auto-picks. Every caller decides what to do with ambiguity. Priority order §CONSTRAINTS #13(a) — surface to user, don't guess.
- Incremental update: on `note-saved`, remove all `outgoing[path]` entries, recompute from new content, update `incoming` symmetrically. Full rebuild is O(N²); incremental is O(1) per note.
- Link rewriting on rename: rewriting a note counts as an edit → dispatches `note-saved` → triggers its own incremental update. Guard against re-entrancy (a rewrite must not trigger another rename).
- Aliases are user-authored — never auto-prune, even if the target moves (§6.2 step 3).

**Out of scope:** Graph view (M28). Rename >50-link prompt is already landed (M4). Custom sidebar panel positioning (M31).

**Acceptance:**
1. `[[note]]` navigates to `note.md`.
2. `[[alias]]` resolves via `aliases:` frontmatter.
3. Two notes with the same basename → clicking a link shows disambiguation popover, user picks.
4. Rename "note.md" → "renamed.md". Every note that linked to it is rewritten. Verify 3 seed notes.
5. Rename with 60 backlinks → prompt (M4 flow), cancel aborts, no changes made.
6. Backlinks list shows correct incoming with context.
7. Restart app → LinkIndex loads from IndexedDB, no full rebuild required for unchanged notes (verify via timing).
8. Emit `link-index-updated` after every rebuild/incremental update.

**STOP.**

---

## M7 — Search (FlexSearch)

**Read first:** §6.6, §19.1–§19.4, §5 (`search-index-updated`).
**Prereq:** M6 done.

**Deliverables:**
- `src/search/SearchIndex.js`
- `src/search/queryParser.js` — `tag:`, `path:`, `created:` syntax
- `src/ui/SearchModal.js` — full-text modal
- `src/ui/SidebarSearch.js` — live filter
- Wire in-note search: CodeMirror's native search extension

**Scope:**
- SearchIndex: `index(note)`, `update(note)`, `remove(path)`, `query(query, opts)`, `save()`, `load()`.
- Indexes: full text, title, tags, aliases.
- Query parser handles `tag:foo`, `path:folder/*`, `created:>2026-01-01`. Combined with free text via implicit AND.
- Persistence: serialize to IndexedDB. `search.idx` file in `.quire/.../index/` is the export artifact — the actual live index uses IndexedDB (large content).
- Lifecycle (§19.4): incremental on vault open (mtime diff), `note-saved` re-index, `note-created`/`note-renamed` index, `note-deleted` remove.
- In-note search: `Cmd/Ctrl+F` → CodeMirror's `@codemirror/search` extension.
- Vault search (sidebar): live filter on title + tag matches.
- Full-text modal: `Alt+Shift+F` and command-palette entry. Results with snippets (30 chars either side of match). Arrow keys + Enter to navigate.

**Implementation notes:**
- **// DECISION:** FlexSearch config: `{ preset: 'performance', tokenize: 'forward', cache: 100 }`. Fine-tune if 2,000-note query exceeds 200ms — but start here.
- Serialize via FlexSearch's `.export()` / `.import()` (JSON-safe). Do not serialize the raw tokenizer — that's versioned and rebuilds cheaply.
- **// DECISION:** On vault open, iterate OPFS files sorted by `mtime` descending, index the first 500 immediately, then continue in a `requestIdleCallback`-driven background sweep. User can search the recent 500 immediately; the rest fills in within a few seconds.
- `created:` uses file birth time if available; on iOS OPFS does not reliably expose birth time → fall back to `mtime`. Document this fallback in the UI tooltip.
- Snippet extraction: find the first match offset, take 30 chars before and 30 after, wrap match in `<mark>`. DOMPurify both sides again even though content is already sanitized — defense in depth.

**Out of scope:** Command palette itself (M11). Search-index encryption under E2EE (M25 — will wrap the serialized form). Cross-vault search (never — §1.5).

**Acceptance:**
1. 2,000-note vault: full-text query returns in < 200ms.
2. Restart app → search works without full re-index of unchanged notes (verify via log of "indexed N notes").
3. `tag:foo` filters. `path:folder/*` filters. `created:>2026-01-01` filters. Combined: `tag:foo folder/*` returns only foo-tagged notes in `folder/`.
4. Snippet shows `<mark>` around match.
5. Sidebar live filter updates as you type, no lag.
6. `Cmd/Ctrl+F` opens CodeMirror's search box in-editor.
7. Delete a note → disappears from search immediately.

**STOP.**

---

## M8 — Frontmatter and tags

**Read first:** §3.4, §6.2 (`frontmatter-changed`), §21 (frontmatter parse error row).
**Prereq:** M7 done.

**Deliverables:**
- `src/frontmatter/parse.js`
- `src/frontmatter/serialize.js`
- `src/frontmatter/tags.js` — inline `#tag` + frontmatter `tags:` merge
- `src/ui/FrontmatterTable.js` — Power Mode display

**Scope:**
- Parse YAML frontmatter block. Return `{ data, body, raw, error }`.
- Malformed YAML → `error` populated, `raw` preserved, `body` = full content including the broken frontmatter block. Note still opens. Warning icon in UI.
- Serialize back: preserve key order if data was parseable, else write fresh block. Never fabricate.
- Tag extraction: `#tag` inline (from `body`) + `tags:` frontmatter array. Merge, dedupe, natural sort.
- Aliases from `aliases:` array. String or array accepted (Obsidian compat).
- Emit `frontmatter-changed { path, frontmatter }` on every successful write.
- Power Mode frontmatter panel: table view, read-only this milestone. Editing lands in M30b.
- Tag list in sidebar: aggregate all tags across vault.

**Implementation notes:**
- **// DECISION:** Use `js-yaml` with `safeLoad` (default in v4) — no custom loader. This prevents YAML deserialization attacks (`!!js/function`).
- Preserve quoted strings verbatim when round-tripping. Only rewrite the block when a field changes via M30b UI. Reading is byte-preserving.
- Inline tag regex: same as M5's `/(^|\s)#([a-zA-Z0-9_-]+)/g`. Excluded inside code blocks and inline code. Use a markdown-aware scan (line-by-line, skip fenced regions).
- Empty frontmatter (`---\n---\n`) → valid, `data = {}`. Preserve.
- Frontmatter block must be at file start. If `---` appears after blank lines, it's not frontmatter — treat as body.

**Out of scope:** Editing UI (M30b). Type-inferred editors (M30b). Frontmatter schema validation (never in v4.2 — the user owns their fields).

**Acceptance:**
1. `---\ntitle: X\ntags: [a, b]\n---\n# Body` → title resolves to "X", tags resolve to `[a, b]`, body is `# Body`.
2. Malformed YAML `---\ntitle: [unclosed\n---` → note opens, warning icon, body treated as text (not corrupted).
3. `#foo` inline + `tags: [bar]` frontmatter → tags = `[bar, foo]`.
4. Aliases as string `alias: [one]` → array `["one"]`. As array → unchanged.
5. Delete frontmatter block entirely → tags empty, no crash.
6. Emit `frontmatter-changed` on write.
7. Tag list in sidebar aggregates across all notes.

**STOP.**

---

## M9 — Templates and daily notes

**Read first:** §8.9, §6.11 (SettingsStore).
**Prereq:** M8 done.

**Deliverables:**
- `src/templates/DailyNotes.js`
- `src/templates/Templates.js`
- `src/settings/SettingsStore.js` — first pass, grows through M10–M12
- Settings UI: template folder path, daily-notes folder path, date format

**Scope:**
- Daily notes:
  - Configure folder (default `/daily/`) and date format (default `YYYY-MM-DD`).
  - "Today's note" creates/opens `<daily-folder>/<formatted-date>.md`.
  - If template exists at `<template-folder>/daily.md`, use it as the initial content.
  - Creates folder if missing.
- Templates:
  - Configure folder (default `/templates/`).
  - Command palette "Insert template" → picker → inserts at cursor.
  - Command palette "Use as template" → picker → creates new note from template.
- SettingsStore: persist `templateFolder`, `dailyNotesFolder`, `dateFormat` in `app-settings`. Dispatch `settings-changed` on write.

**Implementation notes:**
- **// DECISION:** Date formatting is a minimal internal implementation (`YYYY`, `MM`, `DD`, `HH`, `mm`, `ss`), not a library. Adds ~40 lines, avoids 5KB `date-fns`. Document in tooltip.
- Template content is inserted verbatim — no variable substitution in v4.2. `{{date}}` etc. is not a feature. If a user wants it, they use a Tier 2 plugin later (M27b).
- Command palette doesn't exist yet — this milestone exposes dev-only buttons for template actions, which get wired to real palette commands when M11 lands.
- Daily-notes folder path: validate on save (no `..`, no absolute paths).

**Out of scope:** Rich template syntax. Variables. Simple Mode UI (M30b).

**Acceptance:**
1. "Today's note" creates `daily/2026-10-25.md` if missing, opens if present. Second call opens, does not recreate.
2. Custom date format `YYYY/MM/DD` → creates `daily/2026/10/25.md`. Folder structure created automatically.
3. Template at `templates/daily.md` → "Today's note" seeds new file with template content.
4. "Insert template" at cursor position 42 → template inserted starting at 42.
5. "Use as template" → prompts for name, creates `name.md` with template content.
6. Settings persist across restart.
7. Missing folder → created, not error.

**STOP.**

---

## M10 — Themes

**Read first:** Part 11 in full, §11.2 (CSS variable contract), §11.3 (theme swap).
**Prereq:** M9 done.

**Deliverables:**
- `src/themes/manager.js` — swap logic
- `src/themes/{obsidian-dark,obsidian-light,solarized-dark,nord,custom}.css`
- `src/themes/manifest.json` — theme registry
- `<link rel="stylesheet" data-theme="<id>" media="not all">` tags in `index.html` for all five

**Scope:**
- Five built-in themes (§11.1): Obsidian Dark, Obsidian Light, Solarized Dark, Nord, Custom (default).
- Every theme defines the full CSS variable contract (§11.2) — all 28 variables listed. Missing variable → CI check fails (M-tbd, but build the CI check now).
- Theme swap: set `media="all"` on the active link, `media="not all"` on others. No re-fetch, no flash.
- Update `<meta name="theme-color">` from computed `--bg-primary`.
- Persist theme choice in `app-settings`, apply on startup before first paint (inline `<script>` in `<head>` reads `localStorage` synchronously).
- Base CSS references only the variables. No hard-coded colors anywhere in `src/`.
- Editor (CodeMirror) picks up theme via CSS variables — no JS re-theme needed.

**Implementation notes:**
- **// DECISION:** The startup inline script in `<head>` sets the active theme's `<link media>` before the first paint. This is the only script allowed in `<head>` — everything else loads deferred. Avoids a flash of default theme on cold start.
- `computedStyle(document.body).getPropertyValue('--bg-primary').trim()` → set meta. Run after theme link swap completes (one frame).
- The Custom theme uses the palette from §11.1. Build the other four to WCAG AA contrast (verify in M34) — do not ship a theme that fails contrast.
- Theme files are ~150–250 lines each. They should not be minified — these are meant to be readable and forkable.

**Out of scope:** Custom Mode theme editor (M31). Per-vault theme override (deferred). Live CSS variable editing (M31).

**Acceptance:**
1. Swap between all five themes mid-edit → no flash, no content change, no lost edits.
2. `<meta name="theme-color">` updates to the theme's `--bg-primary`.
3. Restart preserves last theme.
4. Cold start: no flash of wrong theme (verify with Slow 3G throttling).
5. Every theme defines every variable in §11.2 — verify via a dev-only console check.
6. No `#fff`, `#000`, or any hard-coded color in `src/**/*.js` or base CSS files. Only in theme files.

**STOP.**

---

## M11 — Command palette

**Read first:** §6.9, §20 (shortcut table), §5 (`note-opened`), §CONSTRAINTS #11.
**Prereq:** M10 done.

**Deliverables:**
- `src/ui/CommandPalette.js`
- `src/ui/paletteSources/{recent,notes,actions,settings}.js`
- `src/ui/fuzzyMatch.js` — small, correct, no dependency

**Scope:**
- Trigger: `Alt+K` (all platforms), `Cmd/Ctrl+K` (desktop, focus not in editor).
- Sources, in order: Recent (last 5, with folder path) → Notes (fuzzy title + alias) → Actions (fixed list) → Settings (jump to section).
- Fuzzy: subsequence match with score = sum of gap penalties. No fzf-level scoring — simple, predictable.
- Enter invokes, Escape dismisses, ArrowUp/Down navigates, Tab accepts current.
- Actions list (§6.9): new note, new folder, daily note, sync now (stub), open settings, toggle preview, open graph (stub), export vault, update links to note, empty trash, publish (stub), unlock credentials (stub).
- **Every command-palette action becomes reachable via palette even before its keyboard binding exists** — §CONSTRAINTS #11. This is why M11 lands before M12.
- Recent notes: read from `localStorage` (`app-settings.recentNotes`), updated on `note-opened`.

**Data shapes:**

```js
// palette item
{ id: "action:new-note", kind: "action"|"note"|"recent"|"setting", label: "New note",
  hint: "Ctrl+N", run: () => {} }
```

**Implementation notes:**
- **// DECISION:** Subsequence matcher in ~60 lines — for each character in query, find next occurrence in target, count gaps. Score = -sum(gaps). Tie-break: shorter target first, then alphabetical. Avoids a fuzzy library.
- Palette is a `<dialog>` element (native modal, focus trap built-in).
- On open, prefetch Recent (5 items) and Notes (fuzzy-limited to 100) before rendering the full list — perceived latency < 16ms.
- Stubs are visibly stubbed: grayed out, tooltip "Not yet wired," but still listed. Users learn the palette from day one.

**Out of scope:** Full keyboard bindings (M12). Deep-linking into settings sections (basic section list is fine — deepen in M12). Search over vault content (only titles + aliases here — full-text is M7's modal, separate).

**Acceptance:**
1. `Alt+K` opens palette on any platform.
2. `Cmd+K` opens palette only when focus is not in editor. When focus is in editor, only `Alt+K` works.
3. Typing "new" shows "New note" and "New folder" at top.
4. Typing "project" fuzzy-matches notes named "Project Notes" and "Q3 Projections".
5. Enter runs the highlighted action. Escape closes. ArrowUp/Down navigates.
6. Recent list shows last 5 notes with folder path.
7. Stubs (sync, publish, unlock credentials) appear, do nothing on Enter, tooltip explains.

**STOP.**

---

## M12 — Keyboard shortcuts

**Read first:** §20 in full, §2.11 (editor-active exemption), §12 (why `event.code`).
**Prereq:** M11 done. **Milestone-gated: `event.code` audit before shipping.**

**Deliverables:**
- `src/shortcuts/registry.js` — binding table
- `src/shortcuts/dispatch.js` — event listener
- `src/ui/ShortcutReference.js` — settings panel showing bindings
- `scripts/audit-shortcuts.mjs` — CI script verifying no `event.key` usage

**Scope:**
- Editor-active table (`Cmd/Ctrl+S`, `F`, `K`, `B`, `I`, `U`, `Shift+K`, `Escape`): fire **only when focus is in `[contenteditable]` or `textarea`** (and CodeMirror surface).
- Global table (`Alt+K`, `Alt+N`, `Alt+Shift+N`, `Alt+F`, `Alt+Shift+F`, `Alt+P`, `Alt+G`, `Alt+S`, `Alt+,`, `Alt+1`–`Alt+9`, `Escape`): fire anywhere.
- **Every binding compares `event.code`, never `event.key`.** `Alt+1` → `event.code === 'Digit1'`. `Alt+]` → `'BracketRight'`.
- `Alt+F` / `Alt+T` bindings hidden from the reference on Windows/Linux (browser menu collision) — §20 cross-platform caveat. Detect via `navigator.userAgentData.platform` (with fallback).
- Reference panel: shows active bindings only. Failing bindings are removed from the reference; action remains in palette.
- Audit script: greps for `event.key` in `src/shortcuts/**` and `src/ui/**`; CI fails if any match. This is the enforcement for §CONSTRAINTS #6.

**Data shapes:**

```js
// binding
{ code: "Digit1", alt: true, meta: false, ctrl: false, shift: false,
  scope: "global", action: "recent-1", platforms: "all" }
```

**Implementation notes:**
- **// DECISION:** `Escape` fires in both scopes — it's the universal dismiss. A binding with `code: 'Escape'` and `scope: 'both'` fires everywhere.
- Platform detection: `navigator.userAgentData?.platform ?? navigator.platform`. Windows/Linux → hide `Alt+F`/`Alt+T` from reference. macOS/iPadOS → show all.
- The reference panel auto-generates from the registry — no duplicate hand-maintained list. If a binding is missing from the registry, it can't appear in the reference.
- CodeMirror has its own keymap. Use `Prec.high` to intercept editor-active bindings before CodeMirror sees them, so `Cmd+B` for bold is our handler, not CodeMirror's default.
- **// DECISION:** Bind on `document`, not `window` — some webviews eat window-level events.
- Do not `preventDefault()` unless the binding fires. Otherwise you break browser defaults on refusals.

**Out of scope:** Custom Mode keybinding editor (M31). Leader-key scheme (deferred — §20 mentions it as future option). Platform-specific binding overrides beyond what's listed.

**Acceptance:**
1. Every binding fires in a Safari tab using `event.code` — manually verify each one on target device.
2. `Alt+1`–`Alt+9` navigate to recent notes 1–9 (or no-op if fewer than 9 recent).
3. Editor-active table fires only in editor. Type text into a plain input outside the editor → `Cmd+B` does nothing.
4. Global table fires from the editor too (`Alt+K` opens palette while typing).
5. On Windows/Linux, `Alt+F` and `Alt+T` are not shown in the reference. (Grep the built HTML — no match.)
6. `scripts/audit-shortcuts.mjs` returns 0 matches for `event.key`.
7. Bindings that fail on hardware are removed from the reference — verify by deliberately breaking one, confirming it disappears, action still reachable via palette.

**STOP.**

---

## M13 — Sync engine (no provider yet)

**Read first:** Part 13 in full, Part 14 §14.2 (interface shape), §13.6 (conflict), §13.7 (bootstrap), §13.8 (commit coalescing).
**Prereq:** M12 done. **Milestone-gated: commit coalescing rules, conflict resolution contract, and sync state schema finalized before starting.**

**Deliverables:**
- `src/sync/SyncEngine.js` — state machine
- `src/sync/provider.js` — abstract `SyncProvider` + `GitProvider` interfaces
- `src/sync/mockProvider.js` — test-only in-memory provider (used for M13 acceptance)
- `src/sync/stateMachine.js` — DETECT/DIFF/RESOLVE/COMMIT transitions
- `src/sync/conflict.js` — keep-both resolver
- `src/sync/bootstrap.js` — first-sync flow
- `src/sync/syncState.js` — IndexedDB wrapper for `[vaultId, path]` store

**Scope:**
- Four-phase state machine (§13.2): DETECT → DIFF → RESOLVE → COMMIT. Idempotent — a partial failure re-enters at DETECT.
- `SyncProvider` abstract interface (do not implement any concrete provider — M14+ do).
- `syncState` IndexedDB store: `[vaultId, path] → { lastSyncedRemoteHash, lastSyncedLocalHash, lastSyncedAt }`. This is the **only** home for sync hashes (§3.4).
- Bootstrap (§13.7): if `syncState` is empty for the vault, enter bootstrap flow. Show one-time confirmation: "This will download N files. Continue?"
- Conflict resolution (§13.6): keep-both. `<basename>.conflict-<timestamp>.md`. Never auto-resolve.
- Commit coalescing (§13.8): 30s edit debounce, 60s post-commit skip, 5min forced push. Manual sync bypasses.
- Sync triggers (§13.9): manual, on-open (3s after interactive), `visibilitychange → visible`, periodic (`autoSyncIntervalMs`, default 5min). **Never in background.**
- Auth-error handling: 401 → pause, prompt re-auth, do not retry.
- Emit `sync-started`, `sync-progress`, `sync-completed`, `sync-conflict`, `sync-error`, `sync-status-changed`.

**Data shapes:**

```js
// SyncProvider interface (abstract — no implementation)
class SyncProvider {
  async validateCredentials() {}          // throws on invalid
  async getListing() {}                   // → { entries, treeToken }
  async getFileContent(entry) {}          // → Uint8Array
  async pushChanges(changes) {}           // → PushResult
  async getRateLimit() {}                 // → RateLimitInfo
}

class GitProvider extends SyncProvider {
  async getCommitSha(ref) {}
  async getTreeSha(commitSha) {}
  async createBlob(content) {}
  async createTree(baseTreeSha, entries) {}
  async createCommit(parentSha, treeSha, message) {}
  async updateRef(ref, commitSha, force = false) {}
}

// syncState record
{ vaultId, path, lastSyncedRemoteHash, lastSyncedLocalHash, lastSyncedAt }
```

**Implementation notes:**
- **// DECISION:** The state machine is a single `async function sync()` with explicit phase markers, not a class with state. Simpler, more testable. Re-entering after failure re-runs from DETECT — no partial-state recovery logic needed.
- **// DECISION:** Conflict filename format uses `YYYY-MM-DDTHH-MM-SS` (dashes, not colons) — Windows parity for later export, matches trash timestamps.
- Mock provider exposes a controllable in-memory tree — allows deterministic test of every phase transition.
- `sync-completed` payload must include `{ pushed, pulled, conflicts }` counts. UI (M22) reads them.
- Background sync impossibility: add an explicit check — if `document.visibilityState === 'hidden'`, `sync()` throws `BACKGROUND_SYNC_ATTEMPT` (dev-only assertion). This is the enforcement for §CONSTRAINTS #2.
- **// DECISION:** A single `sync()` call serializes through a mutex. Concurrent triggers (e.g., periodic fires while manual is running) coalesce into one additional run after the current finishes, not a parallel run.
- Cancel: `sync()` accepts an `AbortSignal`. On abort, finish the current file, then halt. Do not leave partial commits if avoidable — but a partial commit is recoverable next sync (idempotent).

**Out of scope:** Any concrete provider (M14+). Sync UI (M22 — status indicator stub only). Credential storage (M23). E2EE of sync state (M25). Publishing (M32).

**Acceptance:**
1. Mock provider with a fixed tree → sync engine runs all four phases, generates correct commit plan.
2. Clear `syncState`, re-run sync → bootstrap flow triggered, no duplicates in remote.
3. Conflict: local and remote both modified → two files exist, no overwrite.
4. Idempotency: abort at COMMIT phase, re-run → completes correctly, no duplicates.
5. `visibilitychange → hidden` while sync running → sync completes current file, halts.
6. Attempt to call `sync()` while hidden → throws `BACKGROUND_SYNC_ATTEMPT` in dev.
7. Concurrent triggers coalesce — verify by firing 3 syncs in 100ms, log should show 1 run + 1 queued, not 3.
8. 401 → sync halts, `sync-error` emitted, no retry.
9. `sync-completed` payload has correct counts.

**STOP.**

---

## M14 — Provider: GitHub *(blocked on domain decision)*

**Read first:** §14.3, §13.4 (tree+commit+ref flow), §13.11 (auth errors), §15.1 (OAuth callback handoff), §15.3 (scope).
**Prereq:** M13 done. **Domain confirmed. OAuth app registered with GitHub, redirect URI = `https://<domain>/oauth/callback`.**

**Deliverables:**
- `src/providers/GitHubProvider.js` — implements `GitProvider`
- `src/auth/oauth.js` — PKCE flow helper (reused by all OAuth providers)
- `src/auth/callback.html` — the callback page (exchanges code, writes to IndexedDB)
- `src/ui/SignInModal.js`
- `.well-known/` — nothing needed; OAuth callback page handles it

**Scope:**
- `GitHubProvider implements GitProvider`:
  - `getCommitSha(ref)`: `GET /repos/{owner}/{repo}/commits/{branch}`
  - `getTreeSha(commitSha)`: `GET /repos/{owner}/{repo}/git/commits/{sha}`
  - `createBlob(content)`: `POST /repos/{owner}/{repo}/git/blobs` (base64)
  - `createTree(baseTreeSha, entries)`: `POST /repos/{owner}/{repo}/git/trees`
  - `createCommit(parentSha, treeSha, message)`: `POST /repos/{owner}/{repo}/git/commits`
  - `updateRef(ref, commitSha)`: `PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}`
- Full tree+commit+ref flow (§13.4). Retry from step 1 if branch moved (up to 3x, then "Another device is pushing frequently").
- OAuth 2.0 + PKCE (§15.1):
  - `code_verifier` (43–128 chars, base64url) generated in settings page, stored in `sessionStorage`.
  - Open `https://github.com/login/oauth/authorize?...` in system browser.
  - Callback page: validates `state`, exchanges `code` + `code_verifier` for token at `https://github.com/login/oauth/access_token`.
  - **The exchange runs on the callback page** (§15.1). Writes result to IndexedDB key `quire-oauth-handoff-<state>`. PWA reads on next foreground.
  - Handoff entry expires 10 minutes after write.
- SafeFetch for every outbound call (§6.13). `github.com` and `api.github.com` in CSP allowlist (v4.2 already includes them).
- Token validation on save: one `GET /user` request.

**Implementation notes:**
- **// DECISION:** Callback page is a separate HTML file (`callback.html`), not a route in the PWA. Simpler, more reliable across Safari's handling of PWA navigation. Ships in the service worker precache.
- **// DECISION:** `code_verifier` and `state` live in `sessionStorage` — scoped to the callback page's tab. iOS Safari keeps `sessionStorage` alive across the OAuth round-trip within one session.
- GitHub's token endpoint returns form-encoded by default. Set `Accept: application/json` header — much easier to parse.
- Rate limit header `X-RateLimit-Remaining` — surface in sync UI (M22). For M14, log it.
- `updateRef` must pass `force: false` — this is what makes §CONSTRAINTS #4 (never overwrite remote) enforceable. Verify GitHub rejects when branch moved.
- **// DECISION:** Base64 encoding for blob creation must be `btoa(String.fromCharCode(...new Uint8Array(buf)))` for small files, chunked for large. GitHub blob API limit is ~100MB but practical latency caps around 5MB per blob. Chunked read: 4096-byte chunks, `String.fromCharCode.apply(null, chunk)`.

**Out of scope:** Sync UI polish (M22). Credential encryption beyond device key stub (M23). Other providers (M15+). Publishing to GitHub Pages (M32).

**Acceptance:**
1. Sign in with GitHub end-to-end on iOS, installed PWA. Verify handoff: callback fires in Safari, PWA reads it on next foreground.
2. Handoff expiry: complete OAuth, wait 11 min before foregrounding → "Sign-in expired, try again."
3. First sync to empty repo → one commit. `GET /commits` shows the commit.
4. First sync to populated repo → downloads, no dupes.
5. Edit on device A, sync; device B syncs; edit propagates.
6. Token revoked → auth error state, no retry loop, prompt to re-auth.
7. 500-file sync → confirmation dialog, no timeout, all committed.
8. Branch moved during sync (simulated by pushing to the branch from another client mid-sync) → retry from step 1, succeeds on 2nd attempt.
9. Rate limit: exhaust remaining calls → backoff engages, no hammering.

**STOP.**

---

## M15 — Provider: GitLab *(blocked on domain decision)*

**Read first:** §14.4, §13.4 (bulk commit note), §15.3.
**Prereq:** M14 done. OAuth app registered with GitLab.

**Deliverables:**
- `src/providers/GitLabProvider.js`

**Scope:**
- Tree: `GET /repository/tree?recursive=true`.
- Files: `GET /repository/files/{path}/raw`.
- Push: `POST /repository/commits` with `actions: [...]` — **one call for N files**.
- OAuth: `gitlab.com` origin (already in CSP).
- Rate limit header: `RateLimit-Remaining`.

**Implementation notes:**
- **// DECISION:** GitLab's bulk commit API accepts create/update/delete/move in a single `actions` array. Use this — do not implement GitHub's blob-tree-commit pattern here. Result: N changed files = 1 API call, not 4 + N.
- Rate limit is much higher (2,000/min) but the *batch* API is the real win — 500-file sync = 1 request.
- `actions[].action` is `'create'`, `'update'`, `'delete'`, `'move'`. Do not mix — GitLab applies in order, so a delete followed by a create on the same path is a valid update.
- Content must be base64 in `actions[].content`.

**Out of scope:** GitLab Pages publishing (not in v4.2 — only GitHub Pages, Netlify, WordPress.com, self-hosted WP, custom).

**Acceptance:**
1. Sign in with GitLab, first sync, push, pull, conflict — all work.
2. Bulk commit: 20 changed files → 1 commit call (verify in DevTools network tab), not 20.
3. Rate-limit backoff engages.
4. Move file (rename): single action with `action: 'move'`, not delete+create.
5. 500-file sync: 1 API call for the commit. Should complete in < 30s.

**STOP.**

---

## M16 — Provider: Gitea *(blocked on domain; custom build required)*

**Read first:** §14.5, §2.13 (custom build note), §13.4.
**Prereq:** M15 done. Custom build with `CSP_EXTRA_ORIGINS=https://<gitea-host>`. Gitea OAuth app registered.

**Deliverables:**
- `src/providers/GiteaProvider.js`
- CORS-detection error handler
- README section on Gitea setup

**Scope:**
- Same tree model as GitHub.
- `GiteaProvider implements GitProvider` — identical method set.
- CORS detection: if the first `fetch` fails with a CORS error (no `Access-Control-Allow-Origin` header, `TypeError: Failed to fetch`), surface: *"Your Gitea instance does not allow CORS from this origin. Enable CORS in your instance settings."*
- OAuth app client ID input in settings (§15.4) — user pastes it after registering on their instance.
- Custom-build documentation in README, in the first paragraph (already stated in §2.13 — verify).

**Implementation notes:**
- **// DECISION:** Gitea instances may run older versions with subtly different API shapes. Use the `tree` + `commit` + `ref` flow from GitHub — most stable across versions. Do not rely on newer endpoints.
- **// DECISION:** CORS detection is a *one-time* check on first request, cached for the session. Re-checking every request is wasteful. Reset on settings change (client ID change).
- Custom build mechanism: `CSP_EXTRA_ORIGINS` env var read by the build script (`vite.config.js` or equivalent). Must be documented as part of the build, not just a footnote.

**Out of scope:** Forgejo-specific differences. Self-hosted GitLab (out of v4.2 scope — would be a variant of M15).

**Acceptance:**
1. Against a working Gitea instance: sign in, sync, conflict.
2. Against a Gitea instance with CORS disabled: specific error message on first request, not generic network error.
3. Custom build with `CSP_EXTRA_ORIGINS` set: origin resolves, no `ERR_BLOCKED_HOST`.
4. README paragraph documents the custom-build requirement, `CSP_EXTRA_ORIGINS` env var, and CORS note.

**STOP.**

---

## M17 — Provider: WebDAV *(blocked on domain; custom build required)*

**Read first:** §14.10, §2.13, §13.3 (per-folder D-call note), §13.9 (auto-sync off by default).
**Prereq:** M16 done. Custom build with WebDAV host origin.

**Deliverables:**
- `src/providers/WebDAVProvider.js`
- Auto-sync-off default logic
- Per-folder cost warning UI

**Scope:**
- PROPFIND (Depth 1), PUT, DELETE, GET, MKCOL.
- No tree model — change detection by `lastmodified` + `size`.
- Basic auth (username + password, stored via TokenStore per §15.5).
- **Auto-sync off by default** (§13.9). Manual sync only.
- Per-folder cost warning: when user enables auto-sync for WebDAV, modal: *"Auto-sync with WebDAV runs D PROPFIND calls per sync, where D is the number of folders. For a 100-folder vault, that's 100 calls every 5 minutes. Continue?"*

**Implementation notes:**
- **// DECISION:** PROPFIND response parsing: XML with namespaces. Use `DOMParser` — no dependency needed. Extract `d:response > d:href` and `d:propstat > d:prop > d:getlastmodified` / `d:getcontentlength`.
- **// DECISION:** Some WebDAV servers (Nextcloud, ownCloud) return 207 Multi-Status with truncated responses for large directories. Paginate with `Depth: 1` per folder — that's what the D-per-sync cost model already assumes.
- **// DECISION:** `MKCOL` returns 405 if the collection already exists. Treat 405 as success.
- **// DECISION:** `PROPFIND` on a nonexistent path returns 404. Treat 404 on a folder as "empty folder, not yet created" — do not error.
- Auto-sync-disabled state must be surfaced in the sync UI (M22): "Auto-sync off — click to enable."
- Rate limit: depends on the server. Some WebDAV servers (ownCloud) rate-limit; use `Retry-After` if present, else exponential backoff.

**Out of scope:** Delta detection (WebDAV has none). Optimizing to fewer than D calls.

**Acceptance:**
1. Against a test WebDAV server (Nextcloud or similar): sign in, first sync, incremental sync.
2. Auto-sync default is off. User must manually enable. Warning modal shows D-call cost.
3. Cost display shows D calls per sync (visible in M22 when landed — for now, log it).
4. MKCOL on existing folder → no error.
5. PROPFIND on nonexistent folder → treated as empty, not error.
6. Manual sync works after auto-sync enabled.
7. Password stored encrypted (verify in IndexedDB — not plaintext when credential protection is on — M23/M24 will land this, but stub the storage now).

**STOP.**

---

## M18 — Provider: Google Drive *(blocked on domain)*

**Read first:** §14.6, §2.5 (gapi note), §15.3.
**Prereq:** M17 done. Google Cloud project with `drive.file` scope. OAuth app registered.

**Deliverables:**
- `src/providers/GoogleDriveProvider.js`
- gapi client loader (lazy)
- Delta cursor persistence

**Scope:**
- `GoogleDriveProvider implements SyncProvider`.
- OAuth 2.0 + PKCE, scope `drive.file` only (§15.3).
- Create: `POST /upload/drive/v3/files?uploadType=multipart`.
- Update: `PATCH /upload/drive/v3/files/{id}?uploadType=media`.
- Download: `GET /drive/v3/files/{id}?alt=media`.
- Delta: `GET /drive/v3/changes?pageToken=` with `startPageToken`.
- Hash: `md5Checksum` (equality-only).
- **Upload uses gapi client** — load lazily. `script-src https://apis.google.com` (in v4.2 CSP).
- UI copy: *"Files added outside the app won't sync. Create them in the app."* Shown in the sign-in modal and settings.

**Implementation notes:**
- **// DECISION:** gapi is loaded only when the first upload is needed. `importScripts('https://apis.google.com/js/api.js')` — but wait, this runs in the main thread, not a worker. Use `document.createElement('script')` with a `Promise` wrapper.
- **// DECISION:** gapi's `gapi.client.drive` provides a nice wrapper, but the raw `fetch` works for most endpoints. Use raw `fetch` for reads (delta, download, metadata), gapi for **uploads only**. This minimizes the attack surface of the third-party script.
- The `startPageToken` is a `lastSyncedRootCursor` on `SyncConfig`. Persist after every successful delta fetch — not after every sync attempt.
- **// DECISION:** `drive.file` scope means files created by *this app* are visible, but files created in the Drive web UI are not. This is a hard limitation. Warn the user once, at sign-in, not every sync.
- MD5 equality-only: compare `md5Checksum` from Drive against locally computed MD5 of the file. If mismatch → changed. Do not attempt cryptographic verification — MD5's role here is only "did it change?"

**Out of scope:** Google Docs, Sheets, other scopes. Shared drives (not in v4.2).

**Acceptance:**
1. Sign in with Google, first sync creates folder (or uses `appDataFolder`? No — `drive.file` scope creates files in "My Drive", user picks folder). Verify folder creation.
2. All files uploaded on first sync.
3. Delta sync fetches only changed files on second sync.
4. Upload via gapi works — no CORS errors in DevTools.
5. `drive.file` scope enforced — files outside the app are invisible. Verify by adding a file in Drive web UI, confirming it doesn't sync.
6. `startPageToken` persisted correctly. Restart app, delta works.
7. MD5 comparison works — edit a file locally, delta detects it.

**STOP.**

---

## M19 — Provider: Dropbox *(blocked on domain)*

**Read first:** §14.7, §2.5 (`reject_cors_preflight` note).
**Prereq:** M18 done. Dropbox app registered.

**Deliverables:**
- `src/providers/DropboxProvider.js`
- Cursor persistence

**Scope:**
- `DropboxProvider implements SyncProvider`.
- OAuth 2.0 + PKCE. Scope: `files.content.write files.content.read files.metadata.read`.
- Upload/download: `POST content.dropboxapi.com/2/files/upload|download` with `reject_cors_preflight=true`.
- Delta: `POST api.dropboxapi.com/2/files/list_folder/continue` with `cursor`.
- **Use `rev` for change detection, not `content_hash`.**
- Rate limit: bandwidth-based. UI shows bytes transferred, not request count.

**Implementation notes:**
- **// DECISION:** `reject_cors_preflight=true` is an *argument*, not a header. Send as `Dropbox-API-Arg` header (Dropbox-specific) with JSON value containing the flag. Verify in DevTools: no OPTIONS preflight should fire.
- **// DECISION:** `rev` is a string that changes on every modification. Compare old `rev` (from `syncState.lastSyncedRemoteHash`) against current `rev`. `content_hash` is Dropbox's custom SHA-256 variant — do not use it, it will confuse anyone comparing with local SHA-256.
- Byte counting: `Content-Length` on upload requests, `Content-Length` on download responses. Sum into `sync-completed.bytesTransferred` for the UI.
- **// DECISION:** Long delta responses paginate with `has_more: true`. Loop until false. Cap loop at 100 pages to prevent infinite loops against a malformed server.
- Cursor: persist `cursor` on `SyncConfig.lastSyncedRootCursor` after every successful delta batch. Same pattern as M18's `startPageToken`.

**Out of scope:** Shared folders (not in v4.2). Dropbox Paper.

**Acceptance:**
1. Sign in, sync, delta works.
2. No OPTIONS preflight requests in DevTools network tab — verify `reject_cors_preflight=true` is honored.
3. `rev`-based detection: edit file locally, delta detects via `rev` change.
4. Bytes display matches actual transferred bytes (spot-check 3 syncs).
5. Long delta (1000+ changes) paginates correctly.
6. Restart app, delta works with persisted cursor.

**STOP.**

---

## M20 — Provider: OneDrive *(blocked on domain)*

**Read first:** §14.8, §2.5 (`downloadUrl` note), §15.3.
**Prereq:** M19 done. Azure app registration with `Files.ReadWrite.AppFolder offline_access`.

**Deliverables:**
- `src/providers/OneDriveProvider.js`
- Chunked upload session manager
- Delta link persistence

**Scope:**
- `OneDriveProvider implements SyncProvider`.
- OAuth 2.0 + PKCE. Scope: `Files.ReadWrite.AppFolder offline_access`.
- Upload: `PUT /me/drive/special/approot:/<path>:/content` for ≤4 MB. Chunked upload session for >4 MB.
- Download: use `@microsoft.graph.downloadUrl` — **never** the `/content` endpoint (302 redirect breaks CORS).
- Delta: `GET /me/drive/special/approot/delta` with `deltaLink`.
- Hash: `quickXorHash` (equality-only).
- Rate limit: 429 + `Retry-After` header — honor it.

**Implementation notes:**
- **// DECISION:** Chunked upload (files > 4MB): `POST /me/drive/special/approot:/<path>:/createUploadSession` → returns `uploadUrl` → PUT to `uploadUrl` in 320KB chunks (must be multiple of 320 KB). Final chunk may be smaller. Total chunks = `ceil(size / 320KB)`.
- **// DECISION:** `@microsoft.graph.downloadUrl` is a *short-lived, single-use* URL (valid ~1 hour). Fetch it fresh for every download — do not cache it.
- **// DECISION:** `quickXorHash` — Microsoft's custom hash. We compute it locally for equality comparison only. Algorithm is ~30 lines: XOR of 160-bit chunks. Port from Microsoft's reference.
- **// DECISION:** `deltaLink` is an opaque URL. Persist entire URL, not just a token. Same field `lastSyncedRootCursor` on `SyncConfig`.
- **// DECISION:** Delta can return the same item multiple times (intermediate states). Deduplicate by `id` before processing — the last entry wins.
- 429 handling: `Retry-After` is in seconds. Wait exactly that long, then retry once. Two consecutive 429s → backoff (double the wait).

**Out of scope:** OneNote, other Microsoft Graph scopes. Multi-account.

**Acceptance:**
1. Sign in, sync, delta.
2. > 4 MB file uploads via chunked session — succeeds.
3. No 302 CORS failures in DevTools.
4. 429 with `Retry-After: 5` → waits 5s, retries, succeeds.
5. Delta deduplicates multiple entries for the same file.
6. Download URL fetched fresh each time — verify no stale `downloadUrl` reuse.
7. `quickXorHash` matches a known-value test vector.

**STOP.**

---

## M21 — Provider: Box *(blocked on domain)*

**Read first:** §14.9, §2.5 (redirect handling).
**Prereq:** M20 done. Box app registration.

**Deliverables:**
- `src/providers/BoxProvider.js`
- Manual 302 handling

**Scope:**
- `BoxProvider implements SyncProvider`.
- OAuth 2.0 + PKCE. Scope: `root_readwrite` (app-folder scoped).
- Create: `POST upload.box.com/api/2.0/files/content`.
- Download: **manual 302 redirect follow** — read `Location` header, fetch manually.
- **No delta cursor.** Per-folder `GET /folders/{id}/items` — D calls per detect. Same limitation as WebDAV. Auto-sync off by default, same warning as M17.
- Hash: SHA-1 (equality-only).

**Implementation notes:**
- **// DECISION:** Box's `/content` returns 302 with `Location` header. Fetch with `redirect: 'manual'` → response is `opaque` (CORS hides the Location header in some browsers). Workaround: fetch the metadata endpoint first (`GET /2.0/files/{id}?fields=...`), get the `download_url` field, fetch that. Uses 2 requests per download but works cross-origin.
- **// DECISION:** App-folder scoped (`root_readwrite` with folder binding) means all operations are relative to a specific folder. `POST /2.0/folders` with `parent: { id: '0' }` (root of app folder) creates subfolders.
- SHA-1: computed locally via `crypto.subtle.digest('SHA-1', ...)`. Equality-only against Box's `sha1` field.
- Auto-sync default off, same warning modal as M17.
- Per-folder cost warning: D calls per sync (same as WebDAV).

**Out of scope:** Box Zones, other enterprise features. Box for Teams multi-user.

**Acceptance:**
1. Sign in, sync, download.
2. 302 redirect followed correctly via `download_url` — no CORS failure.
3. Auto-sync default off, warning shown when enabled.
4. D-call count logged per sync.
5. SHA-1 matches between local file and Box's `sha1` field.
6. Subfolder creation works (nested paths).

**STOP.**

---

## M22 — Sync UI

**Read first:** §13.10 (states), §13.11 (auth errors), §7.7 (Simple Mode friendly language), §7.8 (conflict modal).
**Prereq:** M21 done (all providers wired).

**Deliverables:**
- `src/ui/SyncStatus.js` — top-bar indicator
- `src/ui/SyncLogPanel.js` — dev-visible log
- `src/ui/ConflictModal.js` — friendly wrapper
- `src/ui/RetryPrompt.js`
- `src/ui/BudgetDisplay.js` — requests or bytes

**Scope:**
- Sync status indicator (§13.10): all nine states — Synced, Locked (amber lock), Preparing, Pending, Syncing, Conflict, Offline, Auth error, Error.
- Cancel button in Preparing and Syncing states.
- Sync log (dev-visible). Conflict modal (Simple Mode wrapper §7.8).
- Retry button on error states.
- Budget display: git providers show requests used, cloud providers show bytes transferred.
- Power Mode: sync log panel, conflict history.

**Implementation notes:**
- **// DECISION:** Status dot is a `<span>` with an `aria-live="polite"` region for screen readers. Color is *never* the only signal — every state has an icon + text (§7.13).
- **// DECISION:** Locked state is added in M22 but only *appears* once M23/M24 land. Build the state now — it's free. Verify with a mock that sets `secretWrapScheme: 'passphrase'` and `locked: true`.
- **// DECISION:** Budget display source: git providers read `X-RateLimit-Remaining` (or `RateLimit-Remaining`) from the last response header, cached in `SyncConfig`. Cloud providers read `sync-completed.bytesTransferred` accumulated per session (reset on app restart — not persisted).
- Conflict modal: friendly language per §7.8. Three actions: Keep this device's, Keep the other's, Keep both. All three map to the same underlying keep-both logic with different file-naming outcomes.
- Retry: only shown for Error and Auth-error states. Auth-error retry = re-auth flow. Error retry = re-run sync.

**Out of scope:** Credential unlock flow (M24). Publishing UI (M32).

**Acceptance:**
1. Trigger each of the nine states manually, verify UI. (Locked state: mock as above.)
2. Conflict produces modal, user chooses, correct action fires.
3. Retry on error works. Retry on auth-error triggers re-auth flow.
4. Cancel button halts sync within 1 second.
5. Budget display updates after each sync.
6. Screen reader announces state changes (voice test on iOS VoiceOver).
7. No forbidden words (§7.7): "commit," "push," "token," "OAuth," "CORS," "rate limit" do not appear in Simple Mode sync UI.

**STOP.**

---

## M23 — Credential storage (device-key default)

**Read first:** §4.2 (`secretWrapScheme`), §6.16, §15.5, §15.6, §21 (DEK lost rows).
**Prereq:** M22 done. **Milestone-gated: `secretWrapScheme` schema finalized.**
**Note:** M23 lands the *storage layer and device-key default only*. M24 lands the passphrase flow.

**Deliverables:**
- `src/auth/TokenStore.js` — wrapped payload storage
- `src/auth/CredentialProtector.js` — device key path
- `src/auth/deviceKey.js` — non-extractable key generation
- Migration script for tokens written in M14–M21

**Scope:**
- **TokenStore**: single wrapped payload per config. Never write individual token fields outside the wrapped blob.
- **CredentialProtector** API (partial — stubs for passphrase methods):
  - `getState()`, `init()`, `getCredentials(syncConfigId)`, `getDeviceKey()`
  - `unlock()`, `lock()`, `enablePassphraseProtection()`, `disablePassphraseProtection()` — stubs that throw `NotImplemented` until M24
- Device key: AES-GCM-256, `extractable: false`, stored as `CryptoKey` handle in IndexedDB `cryptoKeys` store, key `'device'`.
- Default `secretWrapScheme` is `'device'`.
- **Plaintext opt-out**: allowed for PATs and WebDAV passwords. **Refresh tokens always wrapped by device key, even on opt-out.**
- Migration from tokens written in M14–M21 (which may have been plaintext or ad-hoc encrypted): re-wrap under device key on first load. Automatic, no user prompt.
- Error states: device key lost (storage eviction) → detect on unwrap failure, prompt re-sign-in, auto-delete unwrappable config after user confirms.

**Data shapes:**

```js
// encryptedSecret payload (what gets wrapped)
{
  accessToken: "gho_...",
  refreshToken: "ghr_...",       // null for PAT/WebDAV
  expiresAt: 1761436800000,
  username: "alice",             // for WebDAV
  password: "..."                // for WebDAV
}

// syncConfigs record (relevant fields)
{
  id, provider, ...,
  encryptedSecret: ArrayBuffer, // null if plaintext
  secretIv: ArrayBuffer,        // null if plaintext
  secretWrapScheme: 'device' | 'passphrase' | 'plaintext',
  secretPayloadPlaintext: {...}, // only if plaintext
  tokenWrapScheme: 'device'      // refresh-token-specific (always 'device' unless passphrase)
}
```

**Implementation notes:**
- **// DECISION:** `crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])` — the `false` is `extractable`. Verify with `crypto.subtle.exportKey()` throwing.
- **// DECISION:** IV is 12 bytes (96 bits) — standard for AES-GCM. Fresh IV per encryption. Never reuse IV with the same key.
- Device key handle stored as `CryptoKey` — IndexedDB can store it directly (structured clone supports `CryptoKey`). Do not export-and-store-as-bytes.
- **// DECISION:** Plaintext opt-out for PATs/WebDAV: still wrap *refresh tokens* by device key even when the user opted out. Store both fields — `secretPayloadPlaintext` (access creds) and `encryptedSecret` (refresh token). Schema accommodates this via `tokenWrapScheme: 'device'`.
- Migration: on `CredentialProtector.init()`, iterate all `syncConfigs`. If `secretWrapScheme` is missing (v4.0-style), read plaintext, re-wrap under device key, set `secretWrapScheme: 'device'`. Atomic per-config — failure leaves that config's plaintext intact (recoverable).
- **// DECISION:** `getDeviceKey()` is idempotent — returns the same handle on every call, generates once on first call. Cache in memory but not as an exported key.

**Out of scope:** Passphrase wrapping (M24). E2EE integration (M25 — none).

**Acceptance:**
1. Sign in to any provider → token stored as `secretWrapScheme: 'device'` blob. Verify in DevTools.
2. `crypto.subtle.exportKey` on device key throws.
3. Plaintext opt-out: PAT/WebDAV plaintext in `secretPayloadPlaintext`; refresh token still wrapped in `encryptedSecret`.
4. Simulated storage eviction (delete `cryptoKeys` store): config fails to unwrap on next access, prompts re-sign-in, does not crash. After user confirms, config is removed.
5. Migration from M14–M21 tokens: after first load, all configs have `secretWrapScheme: 'device'`.
6. TokenStore writes never expose individual fields (grep `src/providers/**` for direct `oauthAccessToken` writes → none).
7. `getDeviceKey()` called twice → same handle (verify via `CryptoKey` identity).

**STOP.**

---

## M24 — Credential protection passphrase (fully independent from E2EE)

**Read first:** §15.7 in full, §4.2 (`secretWrapScheme: 'passphrase'`), §13.10 (Locked state), §CONSTRAINTS #14.
**Prereq:** M23 done.

**Deliverables:**
- Complete `CredentialProtector` methods
- `src/ui/CredentialUnlockPrompt.js`
- `src/ui/CredentialProtectionSettings.js` — Simple Mode + Power Mode
- Argon2id WASM library integration (reused by M25)

**Scope:**
- `enablePassphraseProtection(passphrase)`: Argon2id (64 MB, t=3, p=1), generate credential DEK, re-wrap all credentials under KEK.
- `disablePassphraseProtection()`: requires currently unlocked. Re-wrap under device key.
- `unlock(passphrase)`: derive KEK, unwrap DEK, cache in memory.
- `lock()`: clear DEK from memory. Fire `credentials-locked`.
- Auto-lock on `visibilitychange → hidden` for >5 min.
- Unlock prompt on app foreground (if locked). Prompt renders above keyboard on iOS.
- Simple Mode settings (§7.10 v4.1): "Sync sign-in protection" toggle in Advanced. **Independent from "Note encryption" toggle.**
- **No recovery key.** Warning: *"There is no recovery key. Forgetting this password means re-signing-in to your cloud providers."*

**Implementation notes:**
- **// DECISION:** Argon2id via `argon2-browser` (WASM). Same library used in M25. Do not ship two Argon2 implementations.
- **// DECISION:** Salt for the KEK is per-user, stored in `app-settings` (localStorage), not per-vault. This means credential protection is a *global* setting, not per-vault — correct, because tokens are global (M23 note in §3.2).
- **// DECISION:** "Auto-lock on hidden >5min" uses a timestamp check on `visibilitychange → visible`. Do not use a `setInterval` — those get throttled to death on iOS.
- **// DECISION:** The lock state is checked *before* every `getCredentials()` call. If locked, throws `CREDENTIALS_LOCKED`. SyncEngine (M13) catches and transitions to Locked state without a network call.
- **// DECISION:** `enablePassphraseProtection` is *atomic across all configs*. If any config fails to re-wrap (e.g., corrupted), abort and revert — do not leave a mixed state. Rollback by re-wrapping with device key (which was the prior state).
- **// DECISION:** The two passwords (E2EE + credential) may be the same string. Derive with *different salts* (both per-user, but different purpose-tagged salts: `salt-e2ee` vs `salt-credential`). Document this — it's the mechanism that makes CONSTRAINTS #14 enforceable.
- Unlock prompt UI: modal, password field, no "forgot password" link (there is none — that would be misleading). Show: *"Forgot it? You'll need to sign in to your cloud providers again. Your notes are not affected."*

**Out of scope:** Note encryption (M25). Any coupling between the two systems. "Recover credential password" (never — no recovery path exists).

**Acceptance:**
1. Enable passphrase → all configs re-wrapped to `'passphrase'` → prompt on next foreground.
2. Wrong password → clean fail ("Wrong password"), no partial decrypt, retry allowed.
3. Right password → unlock, sync resumes.
4. Lock now → sync fails fast with Locked state (amber lock in UI, no network call).
5. Disable (while unlocked) → back to device key, no prompt.
6. Enable E2EE only (M25 partially wired to test): credentials unaffected, no prompt.
7. Enable both: two independent prompts on foreground, either unlock works without the other.
8. Same passphrase string for both: KEKs differ (verify via dump — different KEK bytes), no cross-recovery.
9. Auto-lock: foreground → unlocked, background → wait 6 min → foreground → locked.
10. Unlock prompt renders above keyboard on iPhone.
11. No "forgot password" link or reset mechanism exists.

**STOP.**

---

## M25 — E2EE (note content only)

**Read first:** Part 16 in full, §2.10 (plaintext warning), §CONSTRAINTS #14, §22 (E2EE rows).
**Prereq:** M24 done.

**Deliverables:**
- `src/crypto/envelope.js` — DEK wrap/unwrap
- `src/crypto/argon2id.js` — parameter wrappers (reuses M24's library)
- `src/crypto/bip39.js` — 24-word mnemonic
- `src/crypto/contentCipher.js` — AES-GCM for note content
- `src/vault/vaultEncryption.js` — vault-level enable/disable
- `src/ui/RecoveryKeyDisplay.js`

**Scope:**
- Envelope encryption (§16.2): DEK encrypts note content, attachments, search index, sync state. KEK_passphrase (Argon2id, §16.3) and KEK_recovery (24-word BIP39) both wrap DEK.
- Vault creation flow: passphrase + recovery key generation + **warning shown once** (§16.4). Copy / Print / "I've written it down" actions.
- Unlock flow (§16.5): passphrase OR recovery key. Wrong → clean fail.
- Encrypt at write, decrypt at read. DEK in memory only, never persisted.
- **Independence from M24.** Never touch CredentialProtector. Never share a passphrase cache. If both are enabled and the user enters one passphrase, it does *not* unlock the other (§16.5).
- What's encrypted / not (§16.6) — paths, filenames, settings stay plaintext. State this in UI.

**Implementation notes:**
- **// DECISION:** DEK is 32 bytes, AES-GCM, IV per file. Each note's content is encrypted as `{ iv, ciphertext, tag }` — three fields, or one concatenated blob (`iv || ciphertext || tag`). Concatenated is simpler for storage; use that.
- **// DECISION:** The wrapped DEK is stored in `.quire/vaults/<id>/.quire/vault.json` as `wrappedDek: { passphrase: {...}, recovery: {...} }`. Two wraps of the same DEK — unlocking with either KEK yields the same DEK.
- **// DECISION:** BIP39 — use the standard wordlist. `bip39` npm library or hand-rolled with the wordlist. Entropy is 256 bits (matches §16.4 "256 bits entropy" — 24 words × 11 bits = 264 bits, standard BIP39 mapping to 256 bits entropy).
- **// DECISION:** Salt for E2EE KEK is per-vault, stored in `vault.json` (`salt` field). This differs from M24's per-user salt — E2EE is vault-scoped, credential protection is user-scoped. Document this distinction; it's what makes independence concrete.
- **// DECISION:** Vault unlock prompt remembers the KEK-derivation cost. First derivation on iOS may take 1–2s. Show a spinner: "Unlocking…"
- Sync state encryption: `syncState` store is encrypted at rest when E2EE is on. This means sync cannot run without unlock — consistent with E2EE being a note-content protection. Emit a UI hint: "Unlock to sync."
- The `search.idx` file in OPFS is encrypted when E2EE is on. This is why search cannot work before unlock (matches §16.7).

**Out of scope:** Credential wrapping (M23/M24 already done). Search-before-unlock (never — §16.7). Any coupling with credential protection.

**Acceptance:**
1. Enable E2EE, sync to GitHub → remote note content is ciphertext (verify raw file bytes in repo).
2. Forget passphrase, use recovery key → vault unlocks.
3. Forget both → data unrecoverable (documented, not "fixed").
4. E2EE on, credential protection off → credentials unaffected (device key still active, no prompt).
5. E2EE on, credential protection on → two prompts on foreground; either alone suffices for its own scope.
6. Same passphrase string for both → KEKs differ (different salts: vault-salt vs user-salt), no cross-recovery.
7. Paths, filenames, settings remain plaintext (verify by inspecting OPFS).
8. Recovery key display shows 24 words, copy/print/"written down" actions, warning shown.
9. Search does not work before unlock — clear message shown ("Unlock vault to search").
10. Sync fails to run before unlock — clear message shown.

**STOP.**

---

## M26 — Import / export

**Read first:** Part 17 in full.
**Prereq:** M25 done.

**Deliverables:**
- `src/io/importers/{markdown,obsidian,html,textbundle,notion-html,evernote,bear,roam,keep,tomboy,csv,apple-notes,onenote,pdf,docx,plaintext}.js`
- `src/io/exporters/{markdown,static-html,pdf,docx,html,json-backup,textbundle}.js`
- `src/io/formatConverter.js`
- `src/ui/ImportModal.js`
- `src/ui/ExportModal.js`

**Scope:**
- Import: 16 formats (§17.1). Tier 1: Markdown, Obsidian vault, plain text. Tier 2: HTML, TextBundle, Notion HTML export, Evernote, Bear, Roam, Keep, Tomboy, CSV. Tier 3: Apple Notes (desktop), OneNote (desktop), PDF (text-only, no OCR), DOCX.
- Platform gating: desktop-only formats hidden on iOS with clear message.
- **Notion API removed** (§17.1) — do not implement.
- Conflict policy per import: keep / overwrite / merge. Prompt.
- Export: 7 formats (§17.2). Markdown, Static HTML site, PDF, DOCX, HTML, JSON backup (`"format": "quire-vault"` tagged), TextBundle.
- Format converter (§17.3): opt-in, preview + confirm. `[[note]]` preserved, `==highlight==`, `__bold__`, setext → ATX, indented → fenced.

**Implementation notes:**
- **// DECISION:** Evernote `.enex` is XML with `<en-note>` HTML content. Parse with DOMParser, extract content, sanitize through DOMPurify, convert to markdown via `turndown`. Do not use a dedicated `.enex` parser library — the format is simple enough.
- **// DECISION:** Notion HTML export has a specific `Page Title <hash>.html` structure with sibling folders. Walk the file tree, reconstruct. Do not attempt to parse databases (only pages import — that's what "pages imported" means in the QA matrix; a full database import is out of scope).
- **// DECISION:** Apple Notes and OneNote are *desktop-only* because their file formats require native parsers or automation. On desktop, offer file-picker-based import; on iOS, hide with "This format requires a desktop browser." Do not attempt to shell out — this is a browser PWA.
- **// DECISION:** PDF import is text-extraction-only via `pdfjs-dist`. No OCR. If extraction fails (scanned PDF), return a clear error per file. Do not silently produce empty notes.
- **// DECISION:** DOCX import via `mammoth` (~80 KB) — parses to HTML, sanitize, convert to markdown. Do not attempt raw DOCX parsing.
- Export JSON backup: full vault, redacts credentials (replace with `{ redacted: true }`). Format tag `quire-vault` is what import checks first.
- **// DECISION:** Static HTML export (§17.2) resolves wiki-links, includes attachments, static search JSON, backlinks panel. This is the same build pipeline as GitHub Pages publishing (M32). Reuse the code — M26 ships the pipeline for local zip export, M32 ships it for remote push.
- Format converter: preview shows before/after diff, "Apply" button. Recommend backup first (already stated in §17.3).

**Out of scope:** OCR, Apple Notes automation (no browser API), additional formats beyond the 16.

**Acceptance:**
1. Import Obsidian vault → links, embeds, tags preserved. Verify 3 sample notes.
2. Import Notion HTML export → pages imported (databases ignored, documented).
3. Import Evernote `.enex` → notes imported with formatting preserved.
4. Export as zip → open in Obsidian → no modification needed.
5. JSON backup: `"format": "quire-vault"` present. Malformed JSON rejected cleanly. Credentials redacted.
6. Platform gating hides Apple Notes / OneNote on iOS.
7. Static HTML export opens locally, links work, offline.
8. Format converter preview shows diff, apply works, cancel preserves original.
9. DOCX import round-trips formatting (bold, italic, headings, lists).
10. PDF import extracts text; scanned PDF returns per-file error, not silent empty note.

**STOP.**

---

## M27a — Plugins Tier 1 (declarative)

**Read first:** §12.1, §12.4, §12.5.
**Prereq:** M26 done.

**Deliverables:**
- `src/plugins/PluginHost.js` — first pass, Tier 1 only
- `src/plugins/manifest.js` — schema validation
- `src/ui/PluginInstallModal.js`
- `src/ui/PluginsSettings.js`

**Scope:**
- Plugin manifest schema (§12.4): `id`, `name`, `version`, `tier`, `minAppVersion: "4.2.0"`, `description`, `author`, `isDesktopOnly`.
- Install from URL (JSON manifest, no code).
- Confirmation modal shows tier, permissions, author.
- Enable/disable per vault.
- **Tier 1 capabilities only**: themes, regex→HTML extensions, command sequences. No code execution.
- Update detection: manifest version, check source URL on load.

**Implementation notes:**
- **// DECISION:** Tier 1 plugin is pure JSON. No files to load beyond the manifest. The manifest embeds the capabilities:
  ```json
  {
    "id": "my-plugin", "tier": 1, ...
    "capabilities": {
      "themes": [{ "id": "theme-1", "name": "Theme 1", "vars": {...} }],
      "markdownExtensions": [{ "name": "spoiler", "pattern": "||(.+?)||", "replacement": "<span class=\"spoiler\">$1</span>" }],
      "commands": [{ "id": "cmd-1", "label": "...", "sequence": ["action:new-note"] }]
    }
  }
  ```
- **// DECISION:** Regex extensions are applied *after* marked's default rendering but *before* DOMPurify. This means sanitization runs on the result — no plugin can bypass it. Any `<script>` a plugin injects gets stripped.
- **// DECISION:** Command sequences are arrays of action IDs. On trigger, the host runs them in order via the command palette's action registry (M11). No arbitrary code.
- Manifest validation: `ajv` or hand-rolled. Hand-rolled is fine — the schema is small.
- Update check: `fetch` the source URL, compare `version` semver. If newer, badge in plugins settings. **// DECISION:** Do not auto-update. Manual only, confirmation modal each time.

**Out of scope:** Tier 2 (WASM), Tier 3 (host API) — M27b, M27c. Marketplace (never in v4.2).

**Acceptance:**
1. Install a Tier 1 plugin from URL, enable, verify a regex→HTML extension fires.
2. Disable → effect removed immediately.
3. Confirmation modal correctly lists tier and author.
4. Malicious regex `<script>alert(1)</script>` in replacement → sanitized by DOMPurify, no execution.
5. `minAppVersion: "5.0.0"` → refused with clear message.
6. Update badge appears when source URL version is newer.
7. Per-vault enable: plugin enabled in vault A, disabled in vault B. Verify switch.

**STOP.**

---

## M27b — Plugins Tier 2 (WASM sandbox)

**Read first:** §12.1, §12.2.
**Prereq:** M27a done.

**Deliverables:**
- `src/plugins/wasmSandbox.js` — QuickJS-VM wrapper
- `src/plugins/tier2Loader.js`
- Manifest schema additions for `wasm` and `interface`

**Scope:**
- QuickJS-WASM VM (~1 MB). No `document`, `window`, `fetch`, filesystem inside the VM.
- Inputs and outputs are `Uint8Array`. Host-defined API only.
- Deterministic (host seeds RNG if needed).
- Use case: importers, exporters, data transforms.
- Manifest adds `wasm` (URL to `.wasm` file) and `interface` (function signature).

**Implementation notes:**
- **// DECISION:** Use `quickjs-emscripten` (npm) — the maintained fork with sensible defaults. Bundle size ~1 MB compressed.
- **// DECISION:** WASM module is loaded and instantiated per-execution, not cached across calls. Fresh VM state per invocation = deterministic. Trade-off: ~50ms startup cost per call. Acceptable for importers.
- **// DECISION:** Host provides a minimal API inside the VM:
  - `input(bytes: Uint8Array) → void` (called by plugin to set input)
  - `output(bytes: Uint8Array) → void` (called by plugin to set output)
  - `log(string) → void` (routed to host console in dev only)
  - `getRandom(seed) → number` — seeded PRNG, deterministic
- No `eval`, no `import()`, no `Function` constructor accessible. QuickJS-VM sandbox enforces this at the VM boundary.
- **// DECISION:** Timeout per invocation: 30 seconds. On timeout, terminate the VM, surface error, do not crash the app.
- Memory cap: 64 MB per invocation. QuickJS supports this — set on VM init.

**Out of scope:** Tier 3 (M27c). Any DOM access.

**Acceptance:**
1. Install a Tier 2 plugin, execute a transform (e.g., CSV→JSON), get `Uint8Array` back.
2. Inside the VM: `typeof fetch === 'undefined'`, `typeof window === 'undefined'`, `typeof document === 'undefined'`, no filesystem API.
3. Attempt to escape sandbox (`Function("return this")()` inside VM) → returns VM's global, not host's.
4. Non-deterministic calls: same seed → same output. Different seed → different output. Never truly random.
5. Timeout: infinite loop in plugin → killed at 30s, error surfaced, app responsive.
6. Memory cap: allocation of 100MB inside VM → terminated, error surfaced.

**STOP.**

---

## M27c — Plugins Tier 3 (host API)

**Read first:** §12.1, §12.3, §12.6.
**Prereq:** M27b done.

**Deliverables:**
- `src/plugins/hostApi.js` — the exposed surface
- `src/plugins/tier3Loader.js`
- `src/ui/TrustAuthorModal.js`
- Audited `writeNote` wrapper (separate from FileModel's)

**Scope:**
- ES module loaded in app realm, **only** through narrow `PluginHost` interface (§12.3).
- Exposed: `listNotes`, `readNote`, `searchNotes`, `getBacklinks`, `getGraph`, `registerCommand`, `registerSidebarPanel`, `registerMarkdownRenderer`. Writes via audited `writeNote` (sanitized).
- **Not exposed:** SyncEngine, SafeFetch, TokenStore, CredentialProtector, E2EE key, `eval`, `import()`.
- Manifest adds `permissions` (host API methods required).
- Install requires explicit "I trust this author" acknowledgment.
- **Tier 3 cannot unlock credentials** or trigger sync while locked.

**Implementation notes:**
- **// DECISION:** `hostApi.js` is a frozen object literal, not a class. `Object.freeze()` on the API object. Prevents plugin from reassigning methods.
- **// DECISION:** The `getGraph()` return is a *read-only snapshot*, not a live reference. Plugin cannot mutate the graph.
- **// DECISION:** `writeNote` from a plugin runs through an *additional* DOMPurify pass on any HTML content, plus a markdown-strip-check for `<script>` blocks. Do not trust Tier 3 plugins to be well-behaved.
- **// DECISION:** Permissions are checked at *each call*, not just at install. A plugin that declares `listNotes` cannot call `readNote` — even if it's installed.
- Register API surfaces (`registerCommand`, `registerSidebarPanel`, `registerMarkdownRenderer`) generate an opaque handle. Plugin can call `handle.dispose()` to clean up.
- **// DECISION:** Tier 3 plugin ES module is loaded via `import()` with a `blob:` URL constructed from the fetched source. CSP must allow `script-src 'self' blob:` for this. Verify in the CSP manifest.
- Attempts by a Tier 3 plugin to `fetch()` directly → blocked by CSP `connect-src` (no origin allowlisted for plugins). This is the second line of defense beyond the API surface.
- Plugin error → caught, logged, no crash. Panel/command unregisters on error until plugin restart.

**Out of scope:** Marketplace. Any access to secrets. Auto-update of plugins (manual only, per M27a).

**Acceptance:**
1. Install a Tier 3 plugin, register a sidebar panel → renders.
2. Attempt to reach TokenStore → `undefined`.
3. Attempt to reach CredentialProtector → `undefined`.
4. Attempt to reach E2EE key → `undefined`.
5. Attempt to reach SafeFetch → `undefined`.
6. Attempt to call `fetch` directly → CSP blocks (verify in DevTools network tab, no request fires).
7. Attempt to unlock credentials → no API exists. Verify by inspecting `hostApi` keys.
8. Malicious `writeNote('<script>alert(1)</script>')` → sanitized, no execution.
9. Undeclared permission call → `Error: Permission not granted: <method>`.
10. Plugin crash → app responsive, panel unregisters, no console spam beyond one error.

**STOP.**

---

## M28 — Graph view

**Read first:** §8.6, §10.4, §22 (2,000-note graph row).
**Prereq:** M27c done.

**Deliverables:**
- `src/ui/GraphView.js`
- `src/ui/GraphFilters.js`
- Force simulation (d3-force ~30 KB or custom ~200 lines)

**Scope:**
- Canvas-based force-directed graph. ~200 lines custom or `d3-force` (§8.6 allows either).
- Nodes: notes. Size = backlink count. Color = tag or folder (configurable).
- Edges: wiki-links, bidirectional.
- Interaction: pan, zoom, click to navigate, hover highlights neighbors.
- Filter by tag, folder, orphaned.
- **2,000+ notes: default filter is "active in last 90 days" — user can toggle off** (§8.6, M2 fix — never silent).
- Performance target: < 2s render for 1,000 notes.

**Implementation notes:**
- **// DECISION:** Custom force simulation, not d3-force. ~200 lines: `alpha` decay, `charge` (repulsion), `link` (spring), `center` (gravity), `collide` (radius). Well-understood algorithm. Saves 30 KB and is easier to profile.
- **// DECISION:** Nodes rendered to a single `<canvas>`, not SVG. 1,000 nodes as SVG = 1,000 DOM elements, unusable on iOS. Canvas with hit-testing via bounding-box on click/hover.
- Simulation runs for 300 ticks or until `alpha < 0.001`, then freezes. Interaction (drag node) can reheat locally.
- Pan/zoom: canvas transform matrix. Do not re-layout on zoom — just scale the render.
- **// DECISION:** 2,000+ filter is "active in last 90 days" by default. "Active" = opened OR modified in the window. Filter is a checkbox in the graph settings panel, remembered per-vault in `app-settings`.
- **// DECISION:** Hover highlights neighbors by setting a `dimmed` flag on non-neighbors and drawing them at 20% opacity. Do not rebuild the graph — just redraw.
- **// DECISION:** Click navigates via `note-opened` event. Right-click (or long-press) opens a small context menu (open in new pane, copy path, show backlinks).
- Precompute node positions once on first render per session, persist in memory. Reuse across open/close of graph within the same session. Discard on vault switch.

**Out of scope:** Publishing graph to static sites (never — §18.2). Graph customization beyond filter and color-by.

**Acceptance:**
1. 1,000-note vault renders in < 2s on target device.
2. 2,000+ vault shows age filter active; user can toggle off. Verify toggle persists.
3. Click navigates, hover highlights neighbors.
4. Pan, zoom responsive. No jank at 60fps target.
5. No memory leak after 30 open/close cycles (verify heap snapshot delta).
6. Filter by tag: only tagged notes shown, links preserved where both endpoints visible.
7. Filter by folder: subtree only.
8. Orphan filter: only unconnected notes.
9. Color-by-tag and color-by-folder both work.

**STOP.**

---

## M29 — Attachments

**Read first:** §6.4 (embeds + blob URL lifetime), §8.4, §21 (missing embed row).
**Prereq:** M28 done.

**Deliverables:**
- `src/attachments/AttachmentStore.js` — upload, retrieval
- `src/attachments/embedResolver.js` — path → blob URL
- `src/attachments/largeFileFlag.js` — >50MB sync-skip logic
- Wire into Milkdown + CodeMirror drag/paste handlers

**Scope:**
- Upload: file picker → `attachments/` folder in vault.
- Embed render: `![[image.png]]` → `<img>` with `blob:` URL, per-render `Set<blobUrl>` lifetime (M5 verified).
- `![[file.pdf]]` → download chip.
- Missing embed → red broken state, upload offer on iOS, locate + upload on desktop (`webkitdirectory`).
- **> 50 MB attachments**: local-only fallback — skip sync, warn user, still downloadable from the app. Flag in `syncState` record.

**Implementation notes:**
- **// DECISION:** Attachment uploads trigger *immediate* blob URL creation for preview, *and* queue an OPFS write. On successful write, replace the temp URL with the durable one. Simpler: just write first, then create URL. Do that.
- **// DECISION:** Filename collision on upload → `name (1).ext`, `name (2).ext`. Never overwrite silently.
- **// DECISION:** Paste from clipboard (image) → capture as `Blob`, upload as `attachments/pasted-<timestamp>.png`. Drag-drop from Finder → same flow.
- **// DECISION:** The 50 MB flag is set on the `syncState` record for the attachment path: `{ syncState: { skipReason: 'large', size: 62000000 } }`. SyncEngine (M13) reads this and skips. User sees a warning badge on the attachment in the file tree.
- **// DECISION:** Attachment path resolution: `![[image.png]]` resolves to `attachments/image.png` if the file exists there, else searches for the basename anywhere in the vault (§10.2 resolution order applied to attachments). Ambiguous basename → show a picker (rare).
- DOMPurify's `img-src blob:` allowance is already there (M5). Verify.
- **// DECISION:** Download chip for `![[file.pdf]]` triggers `<a download>` with `URL.createObjectURL(blob)`. Same per-render Set lifetime — revoke when the render container is torn down.

**Out of scope:** Image editing. PDF annotation (§1.5). Cloud storage of attachments beyond sync provider. Image optimization / compression.

**Acceptance:**
1. Drag image into editor → uploaded to `attachments/`, embedded, renders.
2. Close and reopen note → renders correctly (blob URL recreated).
3. 20 open/close cycles on note with 3 images → `createObjectURL` − `revokeObjectURL` = 0 at rest.
4. > 50 MB file uploaded → warning shown, sync skipped, file usable locally.
5. Filename collision → `name (1).ext`, both accessible.
6. Paste from clipboard → uploaded as `pasted-<timestamp>.png`.
7. Missing embed → red broken, upload offer works on iOS.
8. Ambiguous basename → picker shown.
9. Download chip for PDF → file downloads with correct name.

**STOP.**

---

## M30a — Simple Mode: shell, file tree, editor

**Read first:** §7.1, §7.2, §7.3, §7.4, §7.12, §7.13.
**Prereq:** M29 done.

**Deliverables:**
- `src/simple/SimpleShell.js`
- `src/simple/FileTreeExplorer.js` — replaces M4's `FileTree.js`
- `src/simple/MilkdownEditor.js`
- `src/simple/Toolbar.js`
- `src/simple/TitleBar.js`
- Milkdown plugins: wikilink, embed, tag

**Scope:**
- Simple Mode shell (default mode for new installs).
- File tree sidebar (§7.2): Windows-Explorer-like. Folders first, natural sort, extension hidden by default. Context menu (new note, new folder, rename, duplicate, move, delete, publish stub). Drag to move. Multi-select (Ctrl/Cmd+click, Shift+click) with bulk action bar.
- Header: search box (live filter), "+ New", "⋯" menu (New Folder, Import, Sort By, Show Extensions).
- Editor: Milkdown (ProseMirror-based WYSIWYG). All customizations from §7.3 — wiki-link plugin, embed plugin, tag plugin, frontmatter stripped, stable heading IDs.
- **Non-negotiable**: every keystroke produces markdown in the file. Verify by checking the file on disk, not the rendered DOM.
- Title bar: editable title (renames file on edit), sync status dot (green/yellow/red/amber-lock per §7.4).
- Toolbar (§7.4) above body. Reflects cursor state.

**Implementation notes:**
- **// DECISION:** Milkdown's ProseMirror serializer produces markdown on every transaction. Hook the `docChanged` transaction and call `FileModel.writeNote` (debounced). This is the *only* path to persistence in Simple Mode. There is no separate "save" button.
- **// DECISION:** Wiki-link plugin — the ProseMirror node is an inline atom with attributes `{ target, display, anchor }`. Serializer outputs `[[target|display]]` or `[[target]]`. Clicking navigates via LinkIndex resolution (M6). Broken links have `broken: true` attribute → muted/dashed styling.
- **// DECISION:** Frontmatter stripping in Milkdown: parse frontmatter on load (M8's parser), hold separately, render only the body. On save, re-prepend frontmatter. This means the frontmatter block is *never visible* in Simple Mode — matches §7.1 principle 3.
- **// DECISION:** Stable heading IDs in Milkdown — custom `heading` node view with `id` attribute generated at load time, persisted in the node's attrs. Do not regenerate on edit (that would break `[[note#heading]]` anchors).
- File tree multi-select: track selection in a `Set<path>`. Ctrl/Cmd+click toggles, Shift+click selects range (flattened tree order). Bulk action bar shows count: "3 selected — Move, Delete, Export, Publish."
- Show Extensions setting (default off): toggles `.md` display in tree. Persist in `app-settings.showExtensions`.
- **// DECISION:** "Publish" context menu item is disabled with tooltip "Not yet wired" until M32. Same for any other stub actions. Do not hide them — users learn from visible-but-disabled items.

**Out of scope:** Properties panel (M30b). Onboarding (M30b). Conflict modal (M30b). Mode switching (M30c). Mobile-specific layout (M30c). Full sync UX (M30b).

**Acceptance:**
1. Type bolded text → `**text**` in file. Italic → `*text*`. Headings → `# H1` etc. Verify by inspecting OPFS.
2. File tree: create folder, drag file, expand/collapse persists across restart.
3. Multi-select: Ctrl+click 3 files → bulk bar shows "3 selected." Shift+click range works.
4. No visible markdown syntax (`**` or `#` are rendered as bold/heading, not shown).
5. No visible file extensions (default — toggle in ⋯ menu).
6. No visible "commit" language anywhere (audit screenshot).
7. Title bar edit renames file — verify on disk.
8. Toolbar reflects cursor state (bold highlights inside bold text).
9. Milkdown round-trips markdown exactly (open a markdown file, close, verify byte-identical — for well-formed files; edge-case markdown may normalize).
10. Broken wikilinks render muted/dashed, clicking shows "Create this note" affordance.

**STOP.**

---

## M30b — Simple Mode: Properties, sync UX, onboarding

**Read first:** §7.5, §7.6, §7.7, §7.8, §7.9, §7.10, §7.11.
**Prereq:** M30a done.

**Deliverables:**
- `src/simple/PropertiesPanel.js`
- `src/simple/LinkPicker.js` — @ picker
- `src/simple/SyncUX.js` — friendly language wrapper
- `src/simple/ConflictModalSimple.js`
- `src/simple/VersionHistory.js`
- `src/simple/SettingsSimple.js`
- `src/simple/Onboarding.js`

**Scope:**
- Properties panel (§7.6): right drawer / bottom sheet. Fields per §7.6 table. Frontmatter edited via panel, never visible as YAML.
- Link insertion: `@` picker, `[[` picker, toolbar button. All produce `[[Note]]` or `[[Note|Display]]`.
- Sync UX (§7.7): friendly language only. "Saved to cloud," "Saved 2 minutes ago." No "commit/push/token." Locked state shows "Signed in — tap to unlock."
- Conflict modal (§7.8) — friendly wrapper over M22's conflict modal.
- Version history (§7.9) — git-backed providers only. Cloud-only shows the disclaimer.
- Settings (§7.10): four sections — Documents, Cloud Sync, Appearance, Advanced. **"Note encryption" and "Sync sign-in protection" as two separate toggles** (§7.10 v4.1 update).
- Onboarding (§7.11): 5 screens. Under 30 seconds to first edit. No mention of markdown, git, OPFS, plugin, encryption, credential protection.

**Implementation notes:**
- **// DECISION:** Properties panel reads `frontmatter` from FileModel, allows edits via type-inferred editors (string → text input, array → chip input, boolean → toggle, date → date picker). Writes go through FileModel, re-serialize YAML, re-prepend to body, write file. No visible YAML ever.
- **// DECISION:** "Removing the last property removes the frontmatter block entirely" (§7.6). If a user deletes the last property, the `---...---` block disappears. This is a UX choice — it prevents empty `---\n---` blocks accumulating.
- **// DECISION:** The @ picker is a fuzzy-matched note list. `@` opens it; typing narrows; Enter inserts. `[[` picker is the same component with different trigger.
- Sync UX audit: forbidden words list — commit, push, pull, branch, ref, OAuth, PAT, token, scope, CORS, rate limit, OPFS, IndexedDB, repo, repository (except for GitHub users in provider-specific copy — see §7.7 table). Add a CI check: grep built Simple Mode bundle for these terms.
- **// DECISION:** Onboarding timing < 30s to first edit is measured from app launch to cursor-in-editor. Use `performance.mark` / `performance.measure`. Log in dev.
- Onboarding screens (§7.11):
  1. Welcome → "Get Started"
  2. Blank doc / Import (default blank)
  3. Sync (Connect / Maybe later)
  4. First doc "Welcome to Quire" with interactive tutorial as inline callouts
  5. Done
- Version history for cloud-only: friendly card with GitHub/GitLab/Gitea recommendation. Do not hide entirely — user learns the feature exists.
- **// DECISION:** Two Advanced toggles ("Note encryption" and "Sync sign-in protection") visually separated by a divider and a one-line explanation: *"These are independent. You can use either, both, or neither."* Prevents the natural assumption they're coupled.
- **// DECISION:** Recovery key display (from M25) in Simple Mode: full-screen modal, 24 words in a grid, Copy / Print / "I've written it down" buttons. The "I've written it down" button *enables* the Continue button — no way to skip past without explicit acknowledgment. This is one of the few blocking modals in the app, and justified by §16.4.

**Out of scope:** Custom Mode (M31). iOS-specific layout polish (M33). Accessibility pass (M34). Full mobile layout (M30c).

**Acceptance:**
1. Properties panel edits frontmatter without showing YAML. Verify by inspecting file on disk (frontmatter is there) and UI (YAML not shown).
2. Add tag via chip input → appended to `tags:` frontmatter.
3. Remove last property → frontmatter block removed entirely.
4. `@` picker opens, inserts wikilink.
5. Sync status shows friendly language only — CI grep returns 0 matches for forbidden words in Simple Mode bundle.
6. Conflict modal matches §7.8 copy exactly (word-for-word).
7. Version history for GitHub shows timeline, preview, restore. For cloud-only, shows the disclaimer card.
8. Onboarding completes < 60s (measured). No forbidden words appear. Verify via screenshot review.
9. Two Advanced toggles work independently (verify by enabling each combination).
10. Recovery key display: Continue button disabled until "I've written it down" clicked.

**STOP.**

---

## M30c — Simple Mode: mode switching, mobile

**Read first:** §7.12, §7.13, §7.14.
**Prereq:** M30b done.

**Deliverables:**
- `src/simple/MobileLayout.js`
- `src/settings/ModeSwitcher.js`
- Wire Safe-area insets throughout

**Scope:**
- Mobile layout (§7.12): file tree full-screen on first launch → drawer on note open. Toolbar above keyboard. Title tap-to-edit. Menu ⋯ → Properties, Version history, Export, Delete, Publish. Properties bottom sheet. Version history full-screen. Word count / reading time in title bar trailing edge.
- Safe-area insets on every top-level container. `100dvh` everywhere.
- Mode switching (§7.14): Simple → Power/Custom, and back. Settings preserved. Toast on switch.
- Simple Mode hides but does not disable: plugins (invisible effects), graph (built but not shown), custom themes (Light/Dark/System only), passphrase management (toggle reveals state but no management button).

**Implementation notes:**
- **// DECISION:** File tree is a full-screen drawer on iOS. On iPad (> 900px), it's a split view. Breakpoint at 900px matches §8.1.
- **// DECISION:** Keyboard handling on iOS: use `visualViewport.height` to detect keyboard state. When keyboard visible, toolbar slides up above it. Do not rely on `window.innerHeight` — it does not shrink reliably.
- **// DECISION:** Properties bottom sheet uses `<dialog>` with `::backdrop`. Slides up from bottom, max-height 60dvh, drag handle. Native `<dialog>` handles focus trap.
- **// DECISION:** Mode switch hides UI, does not destroy data. Search index, backlink index, credentials state — all preserved. Only the shell is torn down. Toast: *"Power Mode on. Settings → Advanced to switch back."*
- Simple Mode hiding (not disabling):
  - Plugins: enabled plugins still run (regex extensions, WASM transforms fire), but no Plugin Settings UI visible. **// DECISION:** Add a note in Advanced: "3 plugins active (hidden in Simple Mode)."
  - Graph: data built, no Graph button visible.
  - Custom themes: only Light/Dark/System offered — custom themes invisible but persisted.
  - Passphrase management: toggle shows state, no "Manage" button. User has to switch to Power Mode to change passphrase.
- **// DECISION:** Word count in title bar: trailing edge, subtle. Reading time calculated at 200 wpm — standard.

**Out of scope:** Custom Mode (M31). Full iOS polish (M33). Accessibility (M34).

**Acceptance:**
1. iPhone, installed PWA: file tree full-screen on launch. Open note → drawer closes. Toolbar above keyboard.
2. Safe-area insets clear notch and home indicator on every screen (screenshot audit).
3. `100dvh` on every full-viewport container. No `--vh` fallback anywhere (grep codebase).
4. Switch Simple → Power → Simple: no data loss, no settings lost.
5. Simple Mode hides plugins — verify regex extension still fires but no plugin UI visible. Advanced note shows active plugin count.
6. Simple Mode hides graph — no Graph button, data still built (verify via `getGraph` console call).
7. Simple Mode hides custom themes — theme picker shows only Light/Dark/System.
8. Simple Mode hides passphrase management — toggle shows state, no Manage button.
9. Word count updates live. Reading time correct at 200 wpm.
10. Properties bottom sheet slides up, drag handle works, focus traps.

**STOP.**

---

## M31 — Custom Mode

**Read first:** Part 9 in full.
**Prereq:** M30c done.

**Deliverables:**
- `src/custom/CustomShell.js`
- `src/custom/LayoutEditor.js`
- `src/custom/ThemeEditor.js`
- `src/custom/KeybindingEditor.js`
- `src/custom/BehaviorCustomizer.js`
- Layout/theme/keybinding JSON schemas + validators

**Scope:**
- Layout editor (§9.1): drag panels (left/right/bottom/floating), resize, show/hide every region. Named layouts. Export as JSON.
- Theme editor (§9.2): live CSS variable editor for every documented variable (§11.2). Save as new theme. Export/import themes.
- Behavior customization (§9.3): every Simple/Power setting plus extras — default editor mode, default folder, auto-expand file tree, word count format, status bar contents, sidebar width.
- Custom keybindings (§9.4): full rebindable set. Conflict detection. Reset per action. Export/import profiles.
- Acknowledgment footer (§9.5): *"Custom Mode is for users who want to design their own interface. Most users should stay in Simple or Power Mode. If something breaks, reset to defaults."* No popups.
- Mode switching (§9.6): Custom layouts/themes persist across switches. Suspended (not deleted) when returning to Simple.

**Implementation notes:**
- **// DECISION:** Layout editor uses pointer events for drag. Panels are absolutely positioned within a CSS grid defined by the layout JSON. Resizing via CSS `resize` handles styled to match app chrome.
- **// DECISION:** Layout JSON schema:
  ```json
  {
    "version": 1,
    "grid": { "columns": ["sidebar", "main", "right"], "rows": ["topbar", "content", "statusbar"] },
    "regions": {
      "sidebar": { "visible": true, "width": 260, "position": "left" },
      "topbar": { "visible": true, "height": 48 },
      ...
    },
    "panels": { "backlinks": { "visible": true, "region": "right" } }
  }
  ```
- **// DECISION:** Theme editor writes to CSS variables on `:root` live. On save, serialize the current computed values into a new theme CSS file (stored in `app-settings.customThemes[]` — not written to `.quire/` because that's device-specific). Export as JSON.
- **// DECISION:** Keybinding editor: any action from M11's registry is rebindable. Conflict detection at binding time: if the new binding matches an existing one, prompt to reassign or abort. Store in `app-settings.customKeybindings` — overrides merge with M12's default registry.
- **// DECISION:** "Reset to defaults" per section (layout, theme, keybindings) — not one giant reset. Users may break layout but keep keybindings.
- **// DECISION:** Acknowledgment footer sits at the bottom of the Custom Mode settings page. Not a modal. One line, dim text.
- Mode switch to Simple: Custom layouts/themes suspended (removed from DOM), preserved in `app-settings`. Switch back → reapplied. Verify no data loss.
- **// DECISION:** Custom Mode validation: layout JSON, theme JSON, keybinding JSON all validated against schemas on load. Invalid → fall back to default with a toast: "Custom [layout/theme/keybindings] was invalid. Reset to default."

**Out of scope:** Anything Custom Mode changes that isn't in §9.1–§9.6. Marketplace for layouts/themes (not in v4.2).

**Acceptance:**
1. Drag panel, layout updates. Save as named layout. Reload preserves.
2. Edit a CSS variable, preview updates live. Save as new theme, export, re-import.
3. Rebind a shortcut, new binding works. Conflict detection fires when two actions share a key.
4. Switch Custom → Simple → Custom: layouts and theme preserved.
5. Acknowledgment footer present, no popup.
6. Reset to defaults per section works — reset layout only, keybindings preserved.
7. Invalid layout JSON → fall back to default, toast shown, no crash.
8. Export layout as JSON, import in a fresh vault → layout applies.
9. Export theme as JSON, import → theme available in picker.
10. Export keybinding profile, import → bindings override defaults.

**STOP.**

---

## M32 — Publishing

**Read first:** Part 18 in full. Ghost removed (§18.1 v4.1). Notion API removed.
**Prereq:** M31 done. Domain confirmed for OAuth reuse in GitHub Pages.

**Deliverables:**
- `src/publish/Publisher.js`
- `src/publish/targets/{github-pages,netlify,wordpress,wordpress-selfhosted,custom-endpoint}.js`
- `src/publish/siteBuilder.js` — shared static-site build (also used by M26 export)
- `src/ui/PublishModal.js`
- `src/ui/PublishSettings.js`

**Scope:**
- **GitHub Pages** (§18.2): static site build, push to `gh-pages` branch, `CNAME` for custom domain. Manual trigger only. Publish scope: vault / `publish: true` / single note. Build includes: HTML per note, resolved wiki-links, attachments, `index.html`, static search JSON, backlinks precomputed. **No graph view** in static sites.
- **Netlify** (§18.3): deploy hook. 100 MB limit — warn.
- **WordPress.com** (§18.4): Application Password. Post or page per note. Tags, categories, attachments, slug, status. Update via stored post ID. Unpublish = draft.
- **WordPress (self-hosted)** (§18.5): requires custom build. `ERR_BLOCKED_HOST` → show custom-build guidance.
- **Custom endpoint** (§18.6): user POST URL, method, headers, body format. 1/sec rate limit. Requires custom build.
- **Ghost not implemented** — removed in v4.1. Custom Endpoint covers Ghost with a custom build if a user wants it.
- Publish UI in Simple Mode (§18.7) and Power Mode (§18.8).
- Security (§18.9): publish opt-in per note. Vault-wide publish confirms. E2EE vaults warn: publishing defeats encryption for published content. `private: true` never published.

**Implementation notes:**
- **// DECISION:** `siteBuilder.js` is extracted from M26's static HTML export. It produces a `Map<path, { content: Uint8Array, mimeType }>` — an in-memory file tree. GitHub Pages and Netlify consume this. This is the single pipeline for "static site from vault."
- **// DECISION:** GitHub Pages push: reuse M14's `GitHubProvider` tree+commit+ref flow, but on the `gh-pages` branch. **Separate `SyncConfig` per publish target** — do not merge with sync config. Publishing has its own commit cadence and its own rate-limit consumption.
- **// DECISION:** Publish history stored in `.quire/vaults/<id>/.quire/publish.json`:
  ```json
  {
    "targets": {
      "github-pages": { "lastPublishedAt": 1761436800000, "lastPublishedHashes": { "/note.md": "abc123..." } },
      "wordpress": { "posts": { "/note.md": 12345 } }
    }
  }
  ```
  This is what detects "no changes since last publish."
- **// DECISION:** `publish: true` frontmatter inclusion: only for vault publish. Single-note publish includes that note regardless. Vault publish with `publishAllSelected` explicitly set includes all.
- **// DECISION:** `private: true` frontmatter is a *hard block*. Even if the user explicitly selects a note for single-note publish, `private: true` prevents publishing. Show: "This note is marked private. Remove `private: true` from frontmatter to publish."
- **// DECISION:** E2EE vault publish: decrypt in memory, build HTML, push. **Warn once per publish**: "Publishing makes the content publicly readable. Encryption only protects synced copies." The warning is not dismissible — it appears on every publish.
- **// DECISION:** WordPress self-hosted without custom build: `SafeFetch` returns `ERR_BLOCKED_HOST`. Intercept and show: "Your WordPress site's origin is not in the app's allowlist. You need a custom build with `CSP_EXTRA_ORIGINS=https://your-site.com`. See README." Do not show a generic error.
- **// DECISION:** Netlify > 100 MB vault: warn before build. If user proceeds, show specific error on POST: "Netlify deploy failed — zip is 142 MB, exceeds the 100 MB limit. Publish a subset of notes or use a different target."
- **// DECISION:** Custom endpoint rate limit is 1/sec. If user tries to publish 50 notes rapidly, queue with 1s spacing. Show progress: "Publishing 12/50…"
- **// DECISION:** Publish button disabled when credentials locked (M24). Tooltip: "Unlock sign-in to publish."

**Out of scope:** Auto-publish on save (never — §18.2). GitLab Pages (not in v4.2). Any target beyond those listed. Ghost (removed in v4.1 — no Ghost option anywhere).

**Acceptance:**
1. Publish vault to GitHub Pages → live at `username.github.io/repo`. Custom domain CNAME works.
2. Publish single note → `notes/slug.html` created, `index.html` updated.
3. `publish: true` included. `private: true` excluded. Verify `private: true` blocks even explicit single-note publish.
4. Update published note → existing post updated (WordPress), not duplicated. GitHub Pages shows new commit.
5. E2EE vault publish → warning shown on every publish, content decrypted in memory, plaintext HTML written.
6. Self-hosted WP without custom build → `ERR_BLOCKED_HOST` + specific custom-build guidance shown.
7. **No Ghost option appears anywhere in the UI** (grep built bundle for "ghost").
8. Netlify > 100 MB vault → specific error, no silent failure.
9. Custom endpoint rate limits to 1/sec — 50 notes publish in 50s.
10. Credentials locked → publish button disabled, tooltip shows.
11. Publish history: no changes since last publish → "Nothing to publish" toast, no API call.

**STOP.**

---

## M33 — iOS polish

**Read first:** §2.1, §2.2, §2.12, §21, §22 (mobile rows).
**Prereq:** M32 done.

**Deliverables:**
- Safe-area audit report — every view verified
- `100dvh` audit — no `--vh` fallback
- Keyboard behavior — every input above keyboard
- Error toast styling
- Service worker update toast
- Storage-eviction resilience pass

**Scope:**
- Safe-area insets verified on every view: file tree, editor, properties, sync log, settings, credential unlock prompt, publish modal, graph, command palette, conflict modal.
- `100dvh` on every full-viewport container. No `--vh` fallback anywhere.
- Keyboard behavior: toolbar above keyboard, credential unlock prompt above keyboard, title tap-to-edit doesn't scroll under keyboard.
- Status bar: `black-translucent`, content under status bar with correct padding.
- Error toasts: non-blocking, above keyboard, dismissable.
- Service worker update toast: non-intrusive, "Update available — reload."
- Storage-eviction resilience: silent recovery or clear prompt on every store.
- `apple-mobile-web-app-title = "Quire"` in `<head>`.

**Implementation notes:**
- **// DECISION:** Test matrix for safe-area: iPhone 15 Pro Max (notch + Dynamic Island), iPhone SE (no notch but home indicator), iPad Pro (no notch, larger safe area). Every screen must be verified on all three.
- **// DECISION:** `visualViewport.height` for keyboard detection, not `window.innerHeight`. Cache the baseline height when keyboard is hidden, compute delta when visible.
- **// DECISION:** Error toast component: fixed bottom, `env(safe-area-inset-bottom)` padding, `aria-live="polite"`, action button (if applicable), auto-dismiss in 6s or on tap. Above keyboard using the same visualViewport offset.
- **// DECISION:** Storage eviction resilience — every IndexedDB store access has a try/catch that recovers by re-initializing the store. OPFS operations recover by prompting re-selection or re-creating files. Test by clearing IndexedDB in DevTools on every store.
- **// DECISION:** Service worker update toast: appears when `update-available` event fires. Reload on click. Auto-dismiss in 10s if ignored. Never force-reload — the user may have unsaved work.
- Status bar test: verify content extends under status bar but status bar background is not overwritten. `apple-mobile-web-app-status-bar-style` is `black-translucent` — this *is* the desired behavior; verify it works.

**Out of scope:** Accessibility (M34). New features. Performance tuning beyond target metrics.

**Acceptance:**
1. Every screen on iPhone 15 Pro Max clears notch and home indicator.
2. Every screen on iPhone SE clears home indicator.
3. Every screen on iPad Pro renders correctly.
4. No layout jump on keyboard show/hide across all views.
5. No `100vh` anywhere — grep codebase returns 0 matches.
6. Credential unlock prompt renders above keyboard.
7. Error toast above keyboard, dismissable.
8. Storage eviction simulated (clear each store independently): silent recovery or clear prompt, no crash.
9. Service worker update toast appears on new version, no auto-reload.
10. No console errors on any transition (verify DevTools console during full user flow).

**STOP.**

---

## M34 — Accessibility

**Read first:** §7.13, Part 20 (shortcuts reference), Part 11 (contrast).
**Prereq:** M33 done.

**Deliverables:**
- Accessibility audit report
- Fixes across every view
- Contrast verification for all five themes
- Focus management pass
- Screen reader flow documentation

**Scope:**
- Every interactive element has an accessible label and (where applicable) shortcut tooltip.
- Focus order verified: title → toolbar → body → footer. Modals trap focus and restore on close.
- Screen reader announcements: format changes, sync status (icon + text, not color alone), navigation events.
- `prefers-reduced-motion`: no animations on toolbar presses, no transitions on panel opens.
- `prefers-contrast`, `prefers-color-scheme` respected.
- WCAG AA contrast in all five themes, light and dark.
- Focus outlines visible, using theme accent.

**Implementation notes:**
- **// DECISION:** Run a Lighthouse accessibility audit on every major view. Target ≥ 95, not 100 (some automated checks flag false positives that don't apply).
- **// DECISION:** VoiceOver test on iOS for the following flows:
  1. Onboarding from launch to first note
  2. Create a note, format text
  3. Open properties panel, edit a field
  4. Search across vault
  5. Sync state transitions (informational)
  6. Credential unlock prompt (input + submit)
  7. Publish a note (multi-step)
- **// DECISION:** Contrast checker: use `axe-core` via a dev-only build, or manual check with a color contrast tool. Verify every text/background pair in all five themes at WCAG AA (4.5:1 for body text, 3:1 for large text).
- **// DECISION:** `prefers-reduced-motion` — every animation gated. Verify: toolbar press, panel open, modal open, sync pulse. No exceptions.
- **// DECISION:** Focus management: modals (`<dialog>`) handle focus trap natively. Custom components (sidebar tree, command palette) implement manual focus trap. Verify by tabbing through the entire app without a mouse.
- **// DECISION:** Screen reader announcements for sync status: wrap in `aria-live="polite"` with role `status`. Format changes: use `aria-label` on format buttons that reflects current state ("Bold, active").

**Out of scope:** Full WCAG AAA (not targeted). Automated accessibility scanning in CI (nice-to-have, not required).

**Acceptance:**
1. VoiceOver on iOS: navigate file tree, editor, properties, settings — all reachable and announced.
2. Keyboard-only navigation: full app reachable without mouse/touch.
3. Reduced-motion: no animations when `prefers-reduced-motion` is set.
4. Contrast checker on all five themes: AA pass for all text/background pairs.
5. Focus outlines visible on every focusable element, using theme accent.
6. Modals trap focus, restore focus to trigger on close.
7. Every toolbar button has an accessible label.
8. Every shortcut in the reference panel has a tooltip.
9. Sync status has icon + text, not color alone.
10. Lighthouse accessibility ≥ 95 on each major view.

**STOP.**

---

## M35 — Full QA pass

**Read first:** Part 22 in full.
**Prereq:** All prior milestones done.

**Deliverables:**
- Executed QA matrix with pass/fail/repro per row
- Bug fixes for any failures in-scope
- Escalation document for structural failures

**Scope:**
- Run every row in the Part 22 QA matrix on real iOS hardware, installed as Home Screen PWA.
- Second-device setups for sync, credential protection, E2EE.
- Misconfigured servers for CORS, CSP, custom-build paths.
- Document failures. Fix within scope; escalate structural failures before proceeding.
- **This is a human checklist, not an AI build gate.** Passing M35 means a human has executed it on hardware.

**Implementation notes:**
- **// DECISION:** Second device: iPhone + iPad minimum, or iPhone + Mac Safari. Both with same vault, sync, credentials, E2EE.
- **// DECISION:** Misconfigured servers: Gitea instance with CORS disabled, WebDAV server with wrong credentials, GitHub repo with revoked token, WordPress site not in CSP.
- **// DECISION:** Every failure gets a screenshot, a repro, and a "blocking / important / minor" severity. Blocking failures halt shipment.
- **// DECISION:** Two weeks minimum for the QA pass — the matrix has ~80 rows and many require multi-minute observation (e.g., "background audio 5+ min" style tests don't apply here, but "sync across 500 files" does).
- **// DECISION:** Historical patterns from the media-player spec: any test involving blob URL creation/revocation, background sync impossibility, or credential independence has historically surfaced edge cases. Prioritize those.

**Out of scope:** New features. Performance tuning beyond target metrics. Anything not in Part 22.

**Acceptance:**
1. Every row in Part 22 executed on hardware. Each row has a result and a screenshot.
2. Failures documented with reproduction steps.
3. All blocking failures resolved.
4. No regressions in previously-passing rows after fixes.
5. **Quire ships.**

**STOP.** End of build series.

---

## Notes on feedability

- **Longest single milestone:** M32 (Publishing) — five targets. If it's too dense for one session, split by target (GitHub Pages first, then Netlify, then WordPress.com, etc.).
- **Most technically risky:** M14 (GitHub OAuth callback handoff), M18 (Google gapi), M24 (credential protection independence). Budget extra time.
- **Most likely to reveal spec gaps:** M30b (friendly language audit), M24 (credential protection independence verification), M32 (publishing targets).
- **Blocked on domain:** M14–M21. Everything else unblocked.
- **Dependency chains that matter:** M13 must be done before M14. M23 before M24. M24 before M25. M30c before M31. M26 before M32 (site builder reused).

Feed one at a time. Each ends where the next begins.
