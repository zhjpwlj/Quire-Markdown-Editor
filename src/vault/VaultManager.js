import { del, get, getAll, openDb, put } from '../storage/idb.js'
import { createFolder, moveDirectory, readFile, vaultPath, writeFile } from '../storage/opfs.js'
import { trashStamp } from '../storage/trash.js'

const ACTIVE_VAULT_KEY = 'activeVaultId'
const VAULT_ORDER_KEY = 'vaultOrder'

let active = null

async function requestPersistence() {
  try {
    console.log('storage persist:', await navigator.storage.persist())
  } catch (error) {
    console.warn('storage persist failed', error)
  }
}

function readOrder() {
  try {
    return JSON.parse(localStorage.getItem(VAULT_ORDER_KEY) ?? '[]')
  } catch {
    // A corrupt order is not worth a crash; rebuild it from whatever exists.
    return []
  }
}

// IndexedDB returns records in key (UUID) order, not creation order, so the stored order is
// the only source. Keep known ids in place and append the rest.
function saveOrder(records) {
  const stored = readOrder()
  const ids = records.map((record) => record.id)
  const order = [
    ...stored.filter((id) => ids.includes(id)),
    ...ids.filter((id) => !stored.includes(id)),
  ]
  localStorage.setItem(VAULT_ORDER_KEY, JSON.stringify(order))
}

async function markOpened(record) {
  record.lastOpenedAt = Date.now()
  await put('vaults', record)
  localStorage.setItem(ACTIVE_VAULT_KEY, record.id)
  active = record
  void requestPersistence()
}

export async function init() {
  await openDb()
  const records = await getAll('vaults')
  const alive = []
  for (const record of records) {
    // Eviction recovery: the IndexedDB row survives a storage wipe, the OPFS folder does not.
    if ((await readFile(vaultPath(record.id, '.quire/vault.json'))) === null) {
      await del('vaults', record.id)
      continue
    }
    alive.push(record)
  }

  const wanted = localStorage.getItem(ACTIVE_VAULT_KEY)
  active = alive.find((record) => record.id === wanted) ?? alive[0] ?? null
  if (active) await markOpened(active)
  else localStorage.removeItem(ACTIVE_VAULT_KEY)
  await saveOrder(alive)
  return alive
}

export function getActiveVault() {
  return active
}

export async function listVaults() {
  const order = readOrder()
  const rank = (id) => (order.includes(id) ? order.indexOf(id) : order.length)
  return (await getAll('vaults')).sort((a, b) => rank(a.id) - rank(b.id))
}

export async function createVault({ name = 'My Notes' } = {}) {
  const id = crypto.randomUUID()
  const createdAt = Date.now()
  const record = {
    id,
    name,
    createdAt,
    lastOpenedAt: createdAt,
    syncConfigId: null,
    publishConfigId: null,
    e2eeEnabled: false,
  }

  await createFolder(vaultPath(id, '.quire'))
  await createFolder(vaultPath(id, '.trash'))
  await writeFile(
    vaultPath(id, '.quire/vault.json'),
    JSON.stringify({ id, name, createdAt, schemaVersion: 1 }, null, 2),
  )
  await put('vaults', record)
  await saveOrder([...(await getAll('vaults'))])
  await markOpened(record)
  return record
}

export async function switchTo(id) {
  const record = await get('vaults', id)
  if (!record) throw new Error(`vault not found: ${id}`)
  await markOpened(record)
  return record
}

export async function renameVault(id, name) {
  const record = await get('vaults', id)
  if (!record) throw new Error(`vault not found: ${id}`)
  record.name = name
  await put('vaults', record)

  const configPath = vaultPath(id, '.quire/vault.json')
  const config = JSON.parse(await readFile(configPath))
  await writeFile(configPath, JSON.stringify({ ...config, name }, null, 2))

  if (active?.id === id) active = record
  return record
}

export async function deleteVault(id) {
  // §6.1: the vault folder moves to trash, never a hard delete.
  await moveDirectory(vaultPath(id), vaultPath('.trash', `${id}-${trashStamp()}`))
  await del('vaults', id)

  const rest = await getAll('vaults')
  await saveOrder(rest)
  if (active?.id === id) {
    active = rest[0] ?? null
    if (active) await markOpened(active)
    else localStorage.removeItem(ACTIVE_VAULT_KEY)
  }
}
