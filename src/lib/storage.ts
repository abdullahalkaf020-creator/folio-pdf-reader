import type { LibraryDocument } from '../types';

const DB_NAME = 'folio-library';
const DB_VERSION = 1;
const STORE = 'documents';

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('Penyimpanan lokal tidak tersedia pada perangkat ini.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('lastOpened', 'lastOpened');
        store.createIndex('name', 'name');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Gagal membuka database lokal.'));
    request.onblocked = () => reject(new Error('Database sedang digunakan tab lain. Tutup tab Folio yang lain lalu coba lagi.'));
  }).catch((error: unknown) => {
    // Allow a later retry after a transient IndexedDB startup or quota error.
    databasePromise = null;
    throw error;
  });
  return databasePromise;
}

export async function getAllDocuments(): Promise<LibraryDocument[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    request.onsuccess = () => resolve((request.result as LibraryDocument[]).sort((a, b) => b.lastOpened - a.lastOpened));
    request.onerror = () => reject(request.error ?? new Error('Gagal membaca koleksi.'));
  });
}

export async function getDocument(id: string): Promise<LibraryDocument | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    request.onsuccess = () => resolve(request.result as LibraryDocument | undefined);
    request.onerror = () => reject(request.error ?? new Error('Dokumen tidak ditemukan.'));
  });
}

export async function saveDocument(document: LibraryDocument): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(document);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Gagal menyimpan dokumen.'));
    tx.onabort = () => reject(tx.error ?? new Error('Penyimpanan dibatalkan.'));
  });
}

export async function removeDocument(id: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Gagal menghapus dokumen.'));
  });
}

export function makeDocumentId(file: File): string {
  return `${file.name.toLowerCase()}-${file.size}-${file.lastModified}`;
}
