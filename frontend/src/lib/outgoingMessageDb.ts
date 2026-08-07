const DB_NAME = 'miscord-outgoing-v1'
const STORE_NAME = 'messages'

export interface PersistedOutgoingRecord {
  clientNonce: string
  userId: number
  createdAt: string
  [key: string]: unknown
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'clientNonce' })
        store.createIndex('userId', 'userId', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function transaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void,
): Promise<T> {
  const db = await openDatabase()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode)
    run(tx.objectStore(STORE_NAME), resolve, reject)
    tx.onerror = () => reject(tx.error)
    tx.oncomplete = () => db.close()
  })
}

export async function saveOutgoingRecord(record: PersistedOutgoingRecord): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  await transaction<void>('readwrite', (store, resolve, reject) => {
    const request = store.put(record)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

export async function deleteOutgoingRecord(clientNonce: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  await transaction<void>('readwrite', (store, resolve, reject) => {
    const request = store.delete(clientNonce)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

export async function loadOutgoingRecords(userId: number): Promise<PersistedOutgoingRecord[]> {
  if (typeof indexedDB === 'undefined') return []
  return transaction<PersistedOutgoingRecord[]>('readonly', (store, resolve, reject) => {
    const request = store.index('userId').getAll(IDBKeyRange.only(userId))
    request.onsuccess = () => resolve(request.result as PersistedOutgoingRecord[])
    request.onerror = () => reject(request.error)
  })
}

export async function clearOutgoingRecords(userId: number): Promise<void> {
  const records = await loadOutgoingRecords(userId)
  await Promise.all(records.map((record) => deleteOutgoingRecord(record.clientNonce)))
}
