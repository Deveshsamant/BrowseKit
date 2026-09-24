/**
 * IndexedDB schema and migrations.
 *
 * To change the schema: bump DB_VERSION and add MIGRATIONS[DB_VERSION].
 * Never edit a migration that has shipped.
 */

export const DB_NAME = 'browsekit';
export const DB_VERSION = 2;

export const STORES = Object.freeze({
  COLLECTIONS: 'collections',
  VAULT_TABS: 'vaultTabs',
  WATCH_LATER: 'watchLater',
  SESSIONS: 'sessions',
  META: 'meta',
  SNOOZED: 'snoozed',
});

/** keyPath per store, used by backup validation. */
export const KEY_PATHS = Object.freeze({
  [STORES.COLLECTIONS]: 'id',
  [STORES.VAULT_TABS]: 'id',
  [STORES.WATCH_LATER]: 'id',
  [STORES.SESSIONS]: 'id',
  [STORES.META]: 'key',
  [STORES.SNOOZED]: 'id',
});

export const STORE_NAMES = Object.freeze(Object.values(STORES));

/**
 * @type {Record<number, (db: IDBDatabase, tx: IDBTransaction) => void>}
 */
export const MIGRATIONS = {
  1(db) {
    // { id, name, color, sortOrder, createdAt, updatedAt }
    const collections = db.createObjectStore(STORES.COLLECTIONS, { keyPath: 'id' });
    collections.createIndex('sortOrder', 'sortOrder');
    collections.createIndex('updatedAt', 'updatedAt');

    // { id, collectionId, url, title, sortOrder, createdAt, updatedAt }
    const vaultTabs = db.createObjectStore(STORES.VAULT_TABS, { keyPath: 'id' });
    vaultTabs.createIndex('collectionId', 'collectionId');
    vaultTabs.createIndex('url', 'url');
    vaultTabs.createIndex('byCollectionOrder', ['collectionId', 'sortOrder']);

    // { id, url, title, watched: 0|1, addedAt, watchedAt }
    const watchLater = db.createObjectStore(STORES.WATCH_LATER, { keyPath: 'id' });
    watchLater.createIndex('url', 'url');
    watchLater.createIndex('addedAt', 'addedAt');
    watchLater.createIndex('watched', 'watched');

    // { id, name, createdAt, windows: [{ tabs: [{ url, title, pinned }] }] }
    const sessions = db.createObjectStore(STORES.SESSIONS, { keyPath: 'id' });
    sessions.createIndex('createdAt', 'createdAt');

    // { key, value }
    db.createObjectStore(STORES.META, { keyPath: 'key' });
  },
  2(db) {
    // Tab snooze: { id, url, title, wakeAt, createdAt }
    const snoozed = db.createObjectStore(STORES.SNOOZED, { keyPath: 'id' });
    snoozed.createIndex('wakeAt', 'wakeAt');
    // Other v2 additions are optional fields on existing records and need no migration:
    // vaultTabs { note, tags }, collections { starred }, sessions { kind: 'manual' | 'autosave' }.
  },
};
