import { listFiles, readFile, statFile, vaultPath, writeFile } from '../storage/opfs.js'
import { moveToTrash } from '../storage/trash.js'
import { createAutosave, installFlushHooks } from '../editor/autosave.js'

const byteLength = (text) => new TextEncoder().encode(text).length
const titleOf = (path) => path.split('/').pop().replace(/\.md$/i, '')

function newRecord(path) {
  return {
    path,
    title: titleOf(path),
    content: null,
    frontmatter: null,
    tags: [],
    aliases: [],
    outgoingLinks: [],
    mtime: 0,
    size: 0,
    dirty: false,
  }
}

// Note CRUD for one vault. Content is lazy: listNotes() never reads file bodies.
export class FileModel {
  constructor(vaultId) {
    this.vaultId = vaultId
    this.notes = new Map()
    this.autosave = createAutosave(
      // shortcut: non-atomic write; a crash mid-write can truncate. Atomic rename was deferred
      // from M2 and is still pending a caller that flushes on crash-sensitive paths.
      (path, content) => writeFile(vaultPath(this.vaultId, path), content),
      {
        onWritten: (path) => {
          const note = this.notes.get(path)
          if (!note) return
          note.dirty = false
          note.mtime = Date.now()
        },
      },
    )
    installFlushHooks(() => this.flush())
  }

  async listNotes() {
    const entries = await listFiles(vaultPath(this.vaultId), { recursive: true })
    const notes = []
    for (const entry of entries) {
      if (entry.kind !== 'file' || !/\.md$/i.test(entry.path)) continue
      const rel = entry.path.slice(vaultPath(this.vaultId).length + 1)
      if (rel.startsWith('.quire/') || rel.startsWith('.trash/')) continue
      // shortcut: one stat per file; fine for a few hundred notes, index it when search lands.
      const stat = await statFile(entry.path)
      const record = this.notes.get(rel) ?? newRecord(rel)
      record.mtime = stat?.lastModified ?? 0
      record.size = stat?.size ?? 0
      if (!record.dirty) record.content = null
      notes.push(record)
    }
    return notes
  }

  async readNote(path) {
    // A queued edit is newer than the file, so land it before reading (§M3: never trust cache).
    await this.flush()
    const [content, stat] = await Promise.all([
      readFile(vaultPath(this.vaultId, path)),
      statFile(vaultPath(this.vaultId, path)),
    ])
    if (content === null) {
      this.notes.delete(path)
      return null
    }
    const record = this.notes.get(path) ?? newRecord(path)
    Object.assign(record, {
      content,
      mtime: stat.lastModified,
      size: stat.size,
      dirty: false,
    })
    this.notes.set(path, record)
    return record
  }

  // Leading-edge-with-trailing-commit: nothing hits disk until the timer fires or flush().
  writeNote(path, content) {
    const record = this.notes.get(path) ?? newRecord(path)
    Object.assign(record, { content, mtime: Date.now(), size: byteLength(content), dirty: true })
    this.notes.set(path, record)
    this.autosave.schedule(path, content)
    return record
  }

  async createNote(path, content = '') {
    if ((await statFile(vaultPath(this.vaultId, path))) !== null) {
      throw new Error(`note already exists: ${path}`)
    }
    this.autosave.cancel(path)
    await writeFile(vaultPath(this.vaultId, path), content)
    const record = {
      ...newRecord(path),
      content,
      mtime: Date.now(),
      size: byteLength(content),
      dirty: false,
    }
    this.notes.set(path, record)
    return record
  }

  async deleteNote(path) {
    // Cancel first: a queued write would recreate a note the user just deleted.
    this.autosave.cancel(path)
    await moveToTrash(this.vaultId, path)
    this.notes.delete(path)
  }

  async flush() {
    await this.autosave.flush()
  }
}
