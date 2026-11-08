import { LinkIndex } from '../index/LinkIndex.js'

// Filename rules are Windows-parity on purpose: the vault must be exportable everywhere.
// Reject and show the reason; never sanitize silently (§M4).
const CONTROL = /[\u0000-\u001f\u007f]/

export function validateName(name) {
  if (!name) return 'Name is required.'
  if (name === '.' || name === '..') return 'That name is reserved.'
  if (/[/\\:]/.test(name)) return 'Name cannot contain / \\ or :'
  if (CONTROL.test(name)) return 'Name cannot contain control characters.'
  if (/[ .]$/.test(name)) return 'Name cannot end with a space or a dot.'
  if (name.length > 200) return 'Name is too long.'
  return null
}

export function noteFileName(name) {
  return /\.md$/i.test(name) ? name : `${name}.md`
}

// §6.2 order: check incoming links, prompt when large, then write-new-then-delete-old.
export async function renameEntry(fileModel, from, to, { kind = 'file', confirm } = {}) {
  if (from === to) return { renamed: false, links: 0 }

  if (kind === 'folder') {
    await fileModel.moveFolder(from, to)
    return { renamed: true, links: 0 }
  }

  const incoming = LinkIndex.getIncoming(from)
  if (incoming.length > 50) {
    // Cancel aborts before step 1, so nothing is written.
    if (!confirm || !(await confirm(incoming.length))) {
      return { renamed: false, cancelled: true, links: incoming.length }
    }
  }

  // DECISION: Link rewriting lands M6.
  await fileModel.moveNote(from, to)
  return { renamed: true, links: incoming.length }
}
