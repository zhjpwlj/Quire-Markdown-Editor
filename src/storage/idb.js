// IndexedDB schema. Stores are created here once; owners fill them from M3 onward.
const DB_NAME = 'quire'
const DB_VERSION = 1

const STORES = {
  vaults: { keyPath: 'id' },
  syncConfigs: { keyPath: 'id' },
  publishConfigs: { keyPath: 'id' },
  syncState: { keyPath: ['vaultId', 'path'] },
  cryptoKeys: { keyPath: 'key' },
  searchIndex: { keyPath: 'vaultId' },
  linkIndex: { keyPath: 'vaultId' },
  appState: { keyPath: 'key' },
}

let dbPromise = null

export function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      for (const [name, options] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, options)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}

async function run(store, mode, action) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode)
    const request = action(tx.objectStore(store))
    tx.onerror = () => reject(tx.error)
    request.onsuccess = () => resolve(request.result)
  })
}

export const get = (store, key) => run(store, 'readonly', (s) => s.get(key))
export const getAll = (store) => run(store, 'readonly', (s) => s.getAll())
export const put = (store, value) => run(store, 'readwrite', (s) => s.put(value))
export const del = (store, key) => run(store, 'readwrite', (s) => s.delete(key))
export const clear = (store) => run(store, 'readwrite', (s) => s.clear())
