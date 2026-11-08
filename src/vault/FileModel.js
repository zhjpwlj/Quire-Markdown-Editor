import { createFolder, deleteFile, listFiles, moveDirectory, readFile, statFile, vaultPath, writeFile } from '../storage/opfs.js'
import { moveToTrash, trashStamp } from '../storage/trash.js'
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

  // Rename is not a delete (§6.2): write the new file with identical content, then remove the old
  // one outright. A failed delete leaves both files, which the user can clean up.
  async moveNote(from, to) {
    if (from === to) return this.notes.get(to) ?? null
    if ((await statFile(vaultPath(this.vaultId, to))) !== null) {
      throw new Error(`note already exists: ${to}`)
    }
    await this.flush()
    const content = await readFile(vaultPath(this.vaultId, from))
    if (content === null) throw new Error(`note not found: ${from}`)
    await writeFile(vaultPath(this.vaultId, to), content)
    await deleteFile(vaultPath(this.vaultId, from))
    this.notes.delete(from)
    const record = {
      ...newRecord(to),
      content,
      mtime: Date.now(),
      size: byteLength(content),
      dirty: false,
    }
    this.notes.set(to, record)
    return record
  }

  async createFolder(path) {
    if ((await statFile(vaultPath(this.vaultId, path))) !== null) {
      throw new Error(`item already exists: ${path}`)
    }
    await createFolder(vaultPath(this.vaultId, path))
  }

  async moveFolder(path, to) {
    if (path === to) return
    if ((await statFile(vaultPath(this.vaultId, to))) !== null) {
      throw new Error(`item already exists: ${to}`)
    }
    await this.flush()
    await moveDirectory(vaultPath(this.vaultId, path), vaultPath(this.vaultId, to))
    for (const [notePath, record] of [...this.notes]) {
      if (notePath !== path && !notePath.startsWith(`${path}/`)) continue
      this.notes.delete(notePath)
      const moved = notePath.slice(path.length).replace(/^\//, '')
      this.notes.set([to, moved].filter(Boolean).join('/'), record)
    }
  }

  // §6.1 again: deleting a folder moves it to trash, never a hard delete.
  async deleteFolder(path) {
    this.notes.delete(path)
    await moveDirectory(vaultPath(this.vaultId, path), vaultPath(this.vaultId, `.trash/${trashStamp()}/${path}`))
    for (const notePath of [...this.notes.keys()]) {
      if (notePath.startsWith(`${path}/`)) this.notes.delete(notePath)
    }
  }

  async duplicateNote(path) {
    await this.flush()
    const source = await readFile(vaultPath(this.vaultId, path))
    if (source === null) throw new Error(`note not found: ${path}`)
    const dir = path.includes('/') ? `${path.slice(0, path.lastIndexOf('/'))}/` : ''
    const title = path.slice(dir.length).replace(/\.md$/i, '')
    let copy = `${dir}${title} copy.md`
    for (let n = 2; (await statFile(vaultPath(this.vaultId, copy))) !== null; n += 1) {
      copy = `${dir}${title} copy ${n}.md`
    }
    await writeFile(vaultPath(this.vaultId, copy), source)
    return this.readNote(copy)
  }

  async listTree() {
    const base = vaultPath(this.vaultId)
    const entries = await listFiles(base, { recursive: true })
    return entries
      .map((entry) => ({
        path: entry.path.slice(base.length + 1),
        name: entry.name,
        kind: entry.kind === 'directory' ? 'folder' : 'file',
      }))
      .filter((entry) => !['.quire', '.trash'].includes(entry.path))
      .filter((entry) => !entry.path.startsWith('.quire/') && !entry.path.startsWith('.trash/'))
      .filter((entry) => entry.kind === 'folder' || /\.md$/i.test(entry.path))
  }

  async flush() {
    await this.autosave.flush()
  }
}
