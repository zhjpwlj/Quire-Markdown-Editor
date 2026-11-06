import { createFolder, deleteFile, listFiles, moveFile, vaultPath } from './opfs.js'

// DECISION: dashes instead of colons — legal in OPFS, but colons break some export paths.
export function trashStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-')
}

// shortcut: two deletes within the same millisecond overwrite. Move to a counter suffix if
// bulk delete lands before M11.
export async function moveToTrash(vaultId, path) {
  const target = `.trash/${trashStamp()}/${path}`
  await moveFile(vaultPath(vaultId, path), vaultPath(vaultId, target))
  return target
}

export async function emptyTrash(vaultId) {
  await deleteFile(vaultPath(vaultId, '.trash'), { recursive: true }).catch(() => {})
  await createFolder(vaultPath(vaultId, '.trash'))
}

export async function listTrash(vaultId) {
  try {
    return await listFiles(vaultPath(vaultId, '.trash'), { recursive: true })
  } catch {
    return []
  }
}
