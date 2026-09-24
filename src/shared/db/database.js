/**
 * IndexedDB connection, migrations and transaction helper.
 * Works in the service worker and in extension pages (same origin).
 */
import { DB_CHANGE_CHANNEL } from '../constants.js';
import { DB_NAME, DB_VERSION, MIGRATIONS } from './schema.js';

/** @type {Promise<IDBDatabase> | null} */
let dbPromise = null;

/**
 * Open (and upgrade if needed) the database. The connection is cached per
 * context and dropped if another context upgrades the schema.
 * @returns {Promise<IDBDatabase>}
 */
export function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = /** @type {IDBTransaction} */ (request.transaction);
      for (let v = event.oldVersion + 1; v <= DB_VERSION; v += 1) {
        const migrate = MIGRATIONS[v];
        if (!migrate) throw new Error(`Missing IndexedDB migration for version ${v}`);
        migrate(db, tx);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another context wants a newer schema: step aside so it isn't blocked.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

/**
 * Wrap an IDBRequest in a promise.
 * @template T
 * @param {IDBRequest<T>} request
 * @returns {Promise<T>}
 */
export function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Run `work` inside one transaction and resolve with its return value once the
 * transaction commits. `work` may be async but must only await IDB requests
 * (awaiting anything else lets the transaction auto-commit early).
 *
 * @template T
 * @param {string | string[]} storeNames
 * @param {IDBTransactionMode} mode
 * @param {(tx: IDBTransaction) => T | Promise<T>} work
 * @returns {Promise<T>}
 */
export async function transaction(storeNames, mode, work) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    /** @type {T} */
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
    Promise.resolve()
      .then(() => work(tx))
      .then(
        (value) => {
          result = value;
        },
        (err) => {
          try {
            tx.abort();
          } catch {
            // already finished
          }
          reject(err);
        },
      );
  });
}

/**
 * Announce a write so other open pages can refresh.
 * @param {{ stores: string[], op: string }} detail
 */
export function notifyChange(detail) {
  const channel = new BroadcastChannel(DB_CHANGE_CHANNEL);
  channel.postMessage(detail);
  channel.close();
}

/**
 * Listen for writes made by any extension context (including this one).
 * @param {(detail: { stores: string[], op: string }) => void} callback
 * @returns {() => void} unsubscribe
 */
export function onDatabaseChange(callback) {
  const channel = new BroadcastChannel(DB_CHANGE_CHANNEL);
  channel.onmessage = (event) => callback(event.data);
  return () => channel.close();
}
