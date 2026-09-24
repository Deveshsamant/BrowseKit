/**
 * Generic CRUD over IndexedDB stores. Feature modules (TabVault, Watch Later…)
 * build their domain logic on top of these helpers.
 */
import { notifyChange, promisify, transaction } from './database.js';
import { STORE_NAMES } from './schema.js';

/**
 * @param {string} store
 * @returns {Promise<any[]>}
 */
export function getAll(store) {
  return transaction(store, 'readonly', (tx) => promisify(tx.objectStore(store).getAll()));
}

/**
 * @param {string} store
 * @param {IDBValidKey} key
 */
export function get(store, key) {
  return transaction(store, 'readonly', (tx) => promisify(tx.objectStore(store).get(key)));
}

/**
 * @param {string} store
 * @param {string} indexName
 * @param {IDBValidKey | IDBKeyRange} [query]
 * @returns {Promise<any[]>}
 */
export function getAllFromIndex(store, indexName, query) {
  return transaction(store, 'readonly', (tx) =>
    promisify(tx.objectStore(store).index(indexName).getAll(query)),
  );
}

/**
 * @param {string} store
 * @returns {Promise<number>}
 */
export function count(store) {
  return transaction(store, 'readonly', (tx) => promisify(tx.objectStore(store).count()));
}

/**
 * Count every store in one transaction.
 * @returns {Promise<Record<string, number>>}
 */
export function countAll() {
  return transaction([...STORE_NAMES], 'readonly', async (tx) => {
    const counts = await Promise.all(STORE_NAMES.map((s) => promisify(tx.objectStore(s).count())));
    return Object.fromEntries(STORE_NAMES.map((s, i) => [s, counts[i]]));
  });
}

/**
 * Insert or replace one record.
 * @template T
 * @param {string} store
 * @param {T} value
 * @returns {Promise<T>}
 */
export async function put(store, value) {
  await transaction(store, 'readwrite', (tx) => promisify(tx.objectStore(store).put(value)));
  notifyChange({ stores: [store], op: 'put' });
  return value;
}

/**
 * Insert or replace many records atomically.
 * @param {string} store
 * @param {any[]} values
 */
export async function putMany(store, values) {
  await transaction(store, 'readwrite', (tx) => {
    const os = tx.objectStore(store);
    for (const value of values) os.put(value);
  });
  notifyChange({ stores: [store], op: 'put' });
}

/**
 * @param {string} store
 * @param {IDBValidKey} key
 */
export async function remove(store, key) {
  await transaction(store, 'readwrite', (tx) => promisify(tx.objectStore(store).delete(key)));
  notifyChange({ stores: [store], op: 'delete' });
}

/**
 * Remove every record from every store.
 */
export async function clearAll() {
  await transaction([...STORE_NAMES], 'readwrite', (tx) => {
    for (const store of STORE_NAMES) tx.objectStore(store).clear();
  });
  notifyChange({ stores: [...STORE_NAMES], op: 'clear' });
}

/**
 * @param {string} key
 */
export async function getMeta(key) {
  const record = await get('meta', key);
  return record?.value;
}

/**
 * @param {string} key
 * @param {unknown} value
 */
export function setMeta(key, value) {
  return put('meta', { key, value });
}

/**
 * Read every store in one consistent snapshot.
 * @returns {Promise<Record<string, any[]>>}
 */
export function snapshot() {
  return transaction([...STORE_NAMES], 'readonly', async (tx) => {
    const rows = await Promise.all(STORE_NAMES.map((s) => promisify(tx.objectStore(s).getAll())));
    return Object.fromEntries(STORE_NAMES.map((s, i) => [s, rows[i]]));
  });
}

/**
 * Write a validated snapshot. `replace` clears every store first; `merge`
 * upserts by key. Runs in a single transaction: all or nothing.
 * @param {Record<string, any[]>} stores
 * @param {'merge' | 'replace'} mode
 */
export async function restore(stores, mode) {
  await transaction([...STORE_NAMES], 'readwrite', (tx) => {
    for (const name of STORE_NAMES) {
      const os = tx.objectStore(name);
      if (mode === 'replace') os.clear();
      for (const record of stores[name] ?? []) os.put(record);
    }
  });
  notifyChange({ stores: [...STORE_NAMES], op: 'restore' });
}
