// OPFS note storage (Part 3.3). Note content lives here and nowhere else.
// Layout: /quire/vaults/<vault-id>/{*.md, <folder>/*.md, .quire/, .trash/}
const ROOT = 'quire'
const VAULTS = 'vaults'
const CONFIG = '.quire'
const TRASH = '.trash'

function segments(path) {
  if (typeof path !== 'string' || path === '') throw new Error('ERR_BAD_PATH')
  if (path.startsWith('/') || path.includes('\\') || path.includes('\0')) throw new Error('ERR_BAD_PATH')
  const parts = path.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) throw new Error('ERR_BAD_PATH')
  // .quire/ is device state and never note content (§CONSTRAINTS 7).
  if (parts[0] === CONFIG) throw new Error('ERR_BAD_PATH')
  return parts
}

async function vaultDir(vaultId, path = '', create = false) {
  if (typeof vaultId !== 'string' || !vaultId || vaultId === '.' || vaultId === '..' || /[/\\]/.test(vaultId)) {
    throw new Error('ERR_BAD_VAULT')
  }
  let handle = await navigator.storage.getDirectory()
  handle = await handle.getDirectoryHandle(ROOT, { create: true })
  handle = await handle.getDirectoryHandle(VAULTS, { create: true })
  handle = await handle.getDirectoryHandle(vaultId, { create: true })
  for (const part of path ? segments(path) : []) {
    handle = await handle.getDirectoryHandle(part, { create })
  }
  return handle
}

export async function writeNote(vaultId, path, text) {
  const parts = segments(path)
  const dir = await vaultDir(vaultId, parts.slice(0, -1).join('/'), true)
  const file = await dir.getFileHandle(parts.at(-1), { create: true })
  const writable = await file.createWritable()
  await writable.write(text)
  // A failed write must not truncate the note (§CONSTRAINTS 9): close() commits, abort discards.
  await writable.close()
}

export async function readNote(vaultId, path) {
  const parts = segments(path)
  const dir = await vaultDir(vaultId, parts.slice(0, -1).join('/'))
  const file = await dir.getFileHandle(parts.at(-1))
  return (await file.getFile()).text()
}

export async function listNotes(vaultId) {
  const root = await vaultDir(vaultId)
  const notes = []

  async function walk(dir, prefix) {
    for await (const [name, handle] of dir.entries()) {
      if (prefix === '' && (name === CONFIG || name === TRASH)) continue
      if (handle.kind === 'directory') {
        await walk(handle, `${prefix}${name}/`)
      } else {
        const file = await handle.getFile()
        notes.push({ path: `${prefix}${name}`, size: file.size, mtime: file.lastModified })
      }
    }
  }

  await walk(root, '')
  return notes.sort((a, b) => a.path.localeCompare(b.path))
}

// Deletes are opt-in and reversible: the file is copied into .trash first, then removed.
export async function trashNote(vaultId, path) {
  const parts = segments(path)
  const sourceDir = await vaultDir(vaultId, parts.slice(0, -1).join('/'))
  const source = await sourceDir.getFileHandle(parts.at(-1))
  const content = await source.getFile()

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const trashPath = `${TRASH}/${stamp}/${parts.join('/')}`
  const trashParts = trashPath.split('/')
  const dir = await vaultDir(vaultId, trashParts.slice(0, -1).join('/'), true)
  const copy = await dir.getFileHandle(trashParts.at(-1), { create: true })
  const writable = await copy.createWritable()
  await writable.write(content)
  await writable.close()

  await sourceDir.removeEntry(parts.at(-1))
  return trashPath
}
