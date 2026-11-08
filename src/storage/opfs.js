// OPFS wrapper. Paths are relative to the OPFS root, e.g. quire/vaults/<id>/note.md.
const split = (path) => String(path).split('/').filter(Boolean)

export const vaultPath = (vaultId, path = '') => ['quire', 'vaults', vaultId, path].filter(Boolean).join('/')

async function getDirectoryHandle(path, { create = false } = {}) {
  let handle = await navigator.storage.getDirectory()
  for (const part of split(path)) handle = await handle.getDirectoryHandle(part, { create })
  return handle
}

async function getFileHandle(path, { create = false } = {}) {
  const parts = split(path)
  const name = parts.pop()
  const parent = await getDirectoryHandle(parts.join('/'), { create })
  return parent.getFileHandle(name, { create })
}

export async function getDirectory(path = '', options) {
  return getDirectoryHandle(path, options)
}

export async function readFile(path) {
  try {
    const file = await (await getFileHandle(path)).getFile()
    return await file.text()
  } catch (error) {
    if (error.name === 'NotFoundError') return null
    throw error
  }
}

// shortcut: not atomic — a failed write can truncate the target. Atomic rename lands with
// FileModel's flush (M3), which is the only caller that survives a crash mid-write.
export async function writeFile(path, content) {
  const handle = await getFileHandle(path, { create: true })
  const stream = await handle.createWritable()
  await stream.write(content instanceof Blob || typeof content === 'string' ? content : new Blob([content]))
  await stream.close()
}

export async function statFile(path) {
  try {
    const file = await (await getFileHandle(path)).getFile()
    return { size: file.size, lastModified: file.lastModified }
  } catch (error) {
    if (error.name === 'NotFoundError') return null
    throw error
  }
}

export async function listFiles(path = '', { recursive = false } = {}) {  const directory = await getDirectoryHandle(path)
  const entries = []
  for await (const [name, handle] of directory.entries()) {
    const childPath = [path, name].filter(Boolean).join('/')
    entries.push({ path: childPath, name, kind: handle.kind })
    if (recursive && handle.kind === 'directory') entries.push(...(await listFiles(childPath, { recursive })))
  }
  return entries
}

export async function deleteFile(path, { recursive = false } = {}) {
  const parts = split(path)
  const name = parts.pop()
  const parent = await getDirectoryHandle(parts.join('/'))
  await parent.removeEntry(name, { recursive })
}

export async function createFolder(path) {
  await getDirectoryHandle(path, { create: true })
}

export async function moveFile(from, to) {
  const file = await (await getFileHandle(from)).getFile()
  await writeFile(to, file)
  await deleteFile(from)
}

export async function moveDirectory(from, to) {
  await createFolder(to)
  for (const entry of await listFiles(from)) {
    const target = `${to}/${entry.name}`
    if (entry.kind === 'directory') await moveDirectory(entry.path, target)
    else await moveFile(entry.path, target)
  }
  await deleteFile(from)
}
