import type { Annotation } from './model';
export type Draft = { image: Blob; name: string; annotations: Annotation[]; savedAt: number };
let database: Promise<IDBDatabase> | undefined;
function db() {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('snapback', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function loadDraft(): Promise<Draft | undefined> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction('drafts').objectStore('drafts').get('current');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function saveDraft(draft: Draft) {
  const database = await db();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('drafts', 'readwrite');
    transaction.objectStore('drafts').put(draft, 'current');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
