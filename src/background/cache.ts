interface Entry { key: string; text: string; createdAt: number }
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
let database: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('kotonoha-translations', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('translations', { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
}

export async function readCache(key: string): Promise<string | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('translations').objectStore('translations').get(key);
    request.onsuccess = () => {
      const entry = request.result as Entry | undefined;
      resolve(entry && Date.now() - entry.createdAt < TTL_MS ? entry.text : undefined);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function writeCache(key: string, text: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('translations', 'readwrite');
    const store = transaction.objectStore('translations');
    store.put({ key, text, createdAt: Date.now() } satisfies Entry);
    const request = store.getAll();
    request.onsuccess = () => {
      const entries = (request.result as Entry[]).sort((a, b) => b.createdAt - a.createdAt);
      for (const [index, entry] of entries.entries()) {
        if (index >= 2000 || Date.now() - entry.createdAt > TTL_MS) store.delete(entry.key);
      }
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function clearCache(): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('translations', 'readwrite');
    transaction.objectStore('translations').clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}
