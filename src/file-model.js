// FileModel (§6.2). Per-vault, in-memory cache. Writes are debounced and flushed on
// navigation or background; a failed write leaves the previous file untouched.
import * as opfs from './storage/opfs.js'

const SAVE_DELAY_MS = 500

export class FileModel {
  constructor(vaultId) {
    this.vaultId = vaultId
    this.cache = new Map()
    this.timers = new Map()
  }

  listNotes() {
    return opfs.listNotes(this.vaultId)
  }

  listFolders() {
    return opfs.listFolders(this.vaultId)
  }

  createFolder(path) {
    return opfs.createFolder(this.vaultId, path)
  }

  async readNote(path) {
    const cached = this.cache.get(path)
    if (cached) return cached.content
    const content = await opfs.readNote(this.vaultId, path)
    this.cache.set(path, { content, dirty: false })
    return content
  }

  readBlob(path) {
    return opfs.readBlob(this.vaultId, path)
  }

  writeNote(path, content) {
    const entry = this.cache.get(path) ?? { content: '', dirty: false }
    entry.content = content
    entry.dirty = true
    this.cache.set(path, entry)
    clearTimeout(this.timers.get(path))
    this.timers.set(
      path,
      setTimeout(() => this.flushNote(path), SAVE_DELAY_MS),
    )
  }

  async flushNote(path) {
    const entry = this.cache.get(path)
    if (!entry?.dirty) return
    clearTimeout(this.timers.get(path))
    this.timers.delete(path)

    const writing = entry.content
    await opfs.writeNote(this.vaultId, path, writing)
    // Edits that arrived during the await stay dirty and get their own flush.
    if (entry.content === writing) entry.dirty = false
    document.dispatchEvent(new CustomEvent('note-saved', { detail: { path, mtime: Date.now() } }))
  }

  async flush() {
    await Promise.all([...this.cache.keys()].map((path) => this.flushNote(path)))
  }

  async createNote(path, content = '') {
    await opfs.writeNote(this.vaultId, path, content)
    this.cache.set(path, { content, dirty: false })
    document.dispatchEvent(new CustomEvent('note-created', { detail: { path } }))
  }

  async deleteNote(path) {
    await this.flushNote(path)
    await opfs.trashNote(this.vaultId, path)
    this.cache.delete(path)
    document.dispatchEvent(new CustomEvent('note-deleted', { detail: { path } }))
  }

  getDirtyNotes() {
    return [...this.cache.keys()].filter((path) => this.cache.get(path).dirty)
  }

  async renameNote(from, to) {
    await this.flushNote(from)
    const content = await this.readNote(from)

    await opfs.writeNote(this.vaultId, to, content)
    await opfs.removeNote(this.vaultId, from)
    this.cache.delete(from)
    this.cache.set(to, { content, dirty: false })

    await this.rewriteLinks(from, to)
    document.dispatchEvent(new CustomEvent('note-renamed', { detail: { from, to } }))
  }

  // shortcut: full scan of every note per rename. LinkIndex (M6) replaces this with
  // getIncoming(path). Fine up to the 2,000-note soft cap.
  async rewriteLinks(from, to) {
    const titleOf = (path) => path.split('/').pop().replace(/\.md$/, '')
    const oldTitle = titleOf(from)
    const newTitle = titleOf(to)
    const oldRef = from.replace(/\.md$/, '')
    const newRef = to.replace(/\.md$/, '')
    const targets = new Set([oldTitle.toLowerCase(), oldRef.toLowerCase()])
    const wikilink = /(!?\[\[)([^\]|#]+)((?:[|#])[^\]]*)?\]\]/g

    const pending = []
    for (const note of await this.listNotes()) {
      if (note.path === to) continue
      const content = await this.readNote(note.path)
      const updated = content.replace(wikilink, (match, open, target, rest = '') => {
        if (!targets.has(target.trim().toLowerCase())) return match
        return `${open}${target.includes('/') ? newRef : newTitle}${rest}]]`
      })
      if (updated !== content) pending.push({ path: note.path, content: updated })
    }
    if (pending.length === 0) return
    if (pending.length > 50 && !confirm(`Update links in ${pending.length} notes?`)) return

    for (const change of pending) this.writeNote(change.path, change.content)
    await this.flush()
  }
}
