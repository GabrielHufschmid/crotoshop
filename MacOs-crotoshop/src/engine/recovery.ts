const DB_NAME = 'crotoshop-workspace';
const STORE_NAME = 'recovery';
const RECORD_KEY = 'latest';

export interface RecoveryWorkspace {
  version: 1 | 2;
  savedAt: number;
  activeIndex: number;
  tabs: Array<{ name: string; project: string | Blob; dirty: boolean; sourceName?: string }>;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('No se pudo abrir IndexedDB'));
  });
}

function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const request = action(tx.objectStore(STORE_NAME));
    let result: T;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error ?? new Error('Falló la recuperación local'));
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Falló la recuperación local')); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Se canceló la recuperación local')); };
  }));
}

export async function loadRecoveryWorkspace(): Promise<RecoveryWorkspace | null> {
  const value = await transaction<RecoveryWorkspace | undefined>('readonly', (store) => store.get(RECORD_KEY));
  return (value?.version === 1 || value?.version === 2) && Array.isArray(value.tabs) ? value : null;
}

export function saveRecoveryWorkspace(workspace: RecoveryWorkspace): Promise<IDBValidKey> {
  return transaction('readwrite', (store) => store.put(workspace, RECORD_KEY));
}

export function clearRecoveryWorkspace(): Promise<undefined> {
  return transaction('readwrite', (store) => store.delete(RECORD_KEY));
}
