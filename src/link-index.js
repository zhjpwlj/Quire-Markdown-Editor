// LinkIndex (§6.5). Rebuilt on vault open and on structural changes; a saved note is
// reindexed in memory only. Resolution order is §10.2 via the shared resolver.
import { createResolverDetailed } from './links.js'

const LINK = /!?\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/g
const extOf = (target) => (/\.([a-z0-9]+)$/i.exec(target)?.[1] ?? '').toLowerCase()

function parse(path, content) {
  const links = []
  content.split('\n').forEach((line) => {
    for (const match of line.matchAll(LINK)) {
      const target = match[1].trim()
      const ext = extOf(target)
      // Attachments are not note edges; ![[Note]] counts as a link (v4.1).
      if (ext && ext !== 'md') continue
      links.push({ target, anchor: match[2]?.slice(1).trim() ?? '', context: line.trim().slice(0, 160), path: null })
    }
  })
  return { path, links }
}

export class LinkIndex {
  constructor({ listNotes, readNote }) {
    this.listNotes = listNotes
    this.readNote = readNote
    this.notes = new Map()
    this.incoming = new Map()
  }

  async rebuild() {
    const notes = (await this.listNotes()).filter((note) => note.path.endsWith('.md'))
    const entries = await Promise.all(notes.map(async (note) => parse(note.path, await this.readNote(note.path))))
    this.notes = new Map(entries.map((entry) => [entry.path, entry]))
    this.reindex()
  }

  // Re-resolving every link is O(notes); cheap in memory and keeps case-insensitive
  // resolution correct when a note is added or removed.
  reindex() {
    this.incoming = new Map()
    const paths = [...this.notes.keys()]
    for (const entry of this.notes.values()) {
      const resolve = createResolverDetailed(paths, entry.path, 'note')
      for (const link of entry.links) {
        const info = resolve(link.target)
        link.path = info.path
        link.ambiguous = info.ambiguous
        if (!link.path) continue
        if (!this.incoming.has(link.path)) this.incoming.set(link.path, new Map())
        const sources = this.incoming.get(link.path)
        if (!sources.has(entry.path)) sources.set(entry.path, [])
        sources.get(entry.path).push(link.context)
      }
    }
  }

  async update(path, content) {
    if (!path.endsWith('.md') || typeof content !== 'string') return
    this.notes.set(path, parse(path, content))
    this.reindex()
  }

  remove(path) {
    this.notes.delete(path)
    this.reindex()
  }

  resolveLinkInfo(target, fromPath) {
    return createResolverDetailed([...this.notes.keys()], fromPath, 'note')(target)
  }

  resolveLink(target, fromPath) {
    return this.resolveLinkInfo(target, fromPath).path
  }

  getBacklinks(path) {
    return [...(this.incoming.get(path) ?? new Map())].map(([source, contexts]) => ({ path: source, contexts }))
  }

  getOutgoing(path) {
    return this.notes.get(path)?.links ?? []
  }

  getAllLinks() {
    return [...this.notes.values()].flatMap((entry) =>
      entry.links.filter((link) => link.path).map((link) => ({ from: entry.path, to: link.path, target: link.target, anchor: link.anchor })),
    )
  }
}
