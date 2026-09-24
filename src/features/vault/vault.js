/**
 * TabVault persistence: collections and saved tabs in IndexedDB.
 * Usable from extension pages and the service worker.
 */
import { notifyChange, promisify, transaction } from '../../shared/db/database.js';
import { STORES } from '../../shared/db/schema.js';
import { cleanUrl } from '../../shared/urls.js';
import { COLLECTION_COLORS, cleanName, groupTabs, nextSortOrder, planAddTabs, sortByOrder } from './vault-model.js';

const C = STORES.COLLECTIONS;
const T = STORES.VAULT_TABS;

/** @typedef {import('./vault-model.js').Collection} Collection */
/** @typedef {import('./vault-model.js').VaultTab} VaultTab */

const changed = (/** @type {string} */ op) => notifyChange({ stores: [C, T], op });

/**
 * Everything the TabVault UI needs in one read.
 * @returns {Promise<{ collections: Collection[], tabs: VaultTab[], tabsByCollection: Map<string, VaultTab[]> }>}
 */
export async function loadVault() {
  const [collections, tabs] = await transaction([C, T], 'readonly', (tx) =>
    Promise.all([promisify(tx.objectStore(C).getAll()), promisify(tx.objectStore(T).getAll())]),
  );
  return { collections: sortByOrder(collections), tabs, tabsByCollection: groupTabs(tabs) };
}

/** @returns {Promise<Collection[]>} */
export async function listCollections() {
  return sortByOrder(await transaction(C, 'readonly', (tx) => promisify(tx.objectStore(C).getAll())));
}

/**
 * @param {{ name: string, color?: string }} input
 * @returns {Promise<Collection>}
 */
export async function createCollection({ name, color }) {
  const clean = cleanName(name);
  if (!clean) throw new Error('Collection name cannot be empty.');
  const now = Date.now();
  const collection = await transaction(C, 'readwrite', async (tx) => {
    const store = tx.objectStore(C);
    const all = await promisify(store.getAll());
    const record = {
      id: crypto.randomUUID(),
      name: clean,
      color: COLLECTION_COLORS.includes(color ?? '') ? color : COLLECTION_COLORS[all.length % COLLECTION_COLORS.length],
      sortOrder: nextSortOrder(all),
      createdAt: now,
      updatedAt: now,
    };
    store.put(record);
    return record;
  });
  changed('create-collection');
  return collection;
}

/**
 * @param {string} id
 * @param {{ name?: string, color?: string }} patch
 */
export async function updateCollection(id, patch) {
  await transaction(C, 'readwrite', async (tx) => {
    const store = tx.objectStore(C);
    const record = await promisify(store.get(id));
    if (!record) throw new Error('Collection not found.');
    if (patch.name !== undefined) {
      const clean = cleanName(patch.name);
      if (!clean) throw new Error('Collection name cannot be empty.');
      record.name = clean;
    }
    if (patch.color !== undefined && COLLECTION_COLORS.includes(patch.color)) record.color = patch.color;
    record.updatedAt = Date.now();
    store.put(record);
  });
  changed('update-collection');
}

/**
 * Delete a collection and all of its tabs atomically.
 * @param {string} id
 */
export async function deleteCollection(id) {
  await transaction([C, T], 'readwrite', async (tx) => {
    tx.objectStore(C).delete(id);
    const keys = await promisify(tx.objectStore(T).index('collectionId').getAllKeys(id));
    for (const key of keys) tx.objectStore(T).delete(key);
  });
  changed('delete-collection');
}

/**
 * Persist a new collection order.
 * @param {string[]} orderedIds
 */
export async function reorderCollections(orderedIds) {
  await transaction(C, 'readwrite', async (tx) => {
    const store = tx.objectStore(C);
    const all = await promisify(store.getAll());
    const byId = new Map(all.map((c) => [c.id, c]));
    orderedIds.forEach((id, index) => {
      const record = byId.get(id);
      if (record && record.sortOrder !== index) store.put({ ...record, sortOrder: index });
    });
  });
  changed('reorder-collections');
}

/**
 * Add tabs to the end of a collection.
 * @param {string} collectionId
 * @param {{ url: string, title?: string }[]} items
 * @param {{ skipDuplicates?: boolean, cleanUrls?: boolean }} [options]
 * @returns {Promise<{ added: number, duplicates: number, invalid: number }>}
 */
export async function addTabs(collectionId, items, { skipDuplicates = true, cleanUrls = false } = {}) {
  const incoming = cleanUrls ? items.map((i) => ({ ...i, url: cleanUrl(i.url).url })) : items;
  const result = await transaction([C, T], 'readwrite', async (tx) => {
    const collection = await promisify(tx.objectStore(C).get(collectionId));
    if (!collection) throw new Error('Collection not found.');
    const store = tx.objectStore(T);
    const existing = await promisify(store.index('collectionId').getAll(collectionId));
    const plan = planAddTabs(existing, incoming, { skipDuplicates });
    const now = Date.now();
    let order = nextSortOrder(existing);
    for (const item of plan.toAdd) {
      store.put({ id: crypto.randomUUID(), collectionId, ...item, sortOrder: order++, createdAt: now, updatedAt: now });
    }
    if (plan.toAdd.length) tx.objectStore(C).put({ ...collection, updatedAt: now });
    return { added: plan.toAdd.length, duplicates: plan.duplicates, invalid: plan.invalid };
  });
  changed('add-tabs');
  return result;
}

/**
 * @param {string} id
 * @param {{ title?: string, url?: string }} patch
 */
export async function updateTab(id, patch) {
  await transaction(T, 'readwrite', async (tx) => {
    const store = tx.objectStore(T);
    const record = await promisify(store.get(id));
    if (!record) throw new Error('Saved tab not found.');
    if (patch.title !== undefined) record.title = String(patch.title).trim().slice(0, 500) || record.url;
    if (patch.url !== undefined) {
      const plan = planAddTabs([], [{ url: patch.url, title: record.title }], { skipDuplicates: false });
      if (!plan.toAdd.length) throw new Error('That is not a valid URL.');
      record.url = plan.toAdd[0].url;
    }
    record.updatedAt = Date.now();
    store.put(record);
  });
  changed('update-tab');
}

/**
 * Move tabs to the end of another collection.
 * @param {string[]} ids
 * @param {string} targetCollectionId
 */
export async function moveTabs(ids, targetCollectionId) {
  await transaction([C, T], 'readwrite', async (tx) => {
    if (!(await promisify(tx.objectStore(C).get(targetCollectionId)))) throw new Error('Collection not found.');
    const store = tx.objectStore(T);
    const existing = await promisify(store.index('collectionId').getAll(targetCollectionId));
    let order = nextSortOrder(existing);
    const now = Date.now();
    for (const id of ids) {
      const record = await promisify(store.get(id));
      if (!record || record.collectionId === targetCollectionId) continue;
      store.put({ ...record, collectionId: targetCollectionId, sortOrder: order++, updatedAt: now });
    }
  });
  changed('move-tabs');
}

/** @param {string[]} ids */
export async function deleteTabs(ids) {
  await transaction(T, 'readwrite', (tx) => {
    for (const id of ids) tx.objectStore(T).delete(id);
  });
  changed('delete-tabs');
}

/**
 * Persist a new tab order within a collection.
 * @param {string} collectionId
 * @param {string[]} orderedIds
 */
export async function reorderTabs(collectionId, orderedIds) {
  await transaction(T, 'readwrite', async (tx) => {
    const store = tx.objectStore(T);
    const existing = await promisify(store.index('collectionId').getAll(collectionId));
    const byId = new Map(existing.map((t) => [t.id, t]));
    orderedIds.forEach((id, index) => {
      const record = byId.get(id);
      if (record && record.sortOrder !== index) store.put({ ...record, sortOrder: index });
    });
  });
  changed('reorder-tabs');
}

/**
 * Create collections from parsed import data.
 * @param {import('./vault-model.js').ImportedCollection[]} imported
 * @returns {Promise<{ collections: number, tabs: number }>}
 */
export async function importCollections(imported) {
  const now = Date.now();
  const result = await transaction([C, T], 'readwrite', async (tx) => {
    const cStore = tx.objectStore(C);
    const tStore = tx.objectStore(T);
    let order = nextSortOrder(await promisify(cStore.getAll()));
    let tabCount = 0;
    for (const col of imported) {
      const id = crypto.randomUUID();
      cStore.put({ id, name: col.name, color: col.color, sortOrder: order++, createdAt: now, updatedAt: now });
      col.tabs.forEach((tab, i) => {
        tStore.put({ id: crypto.randomUUID(), collectionId: id, url: tab.url, title: tab.title, sortOrder: i, createdAt: now, updatedAt: now });
      });
      tabCount += col.tabs.length;
    }
    return { collections: imported.length, tabs: tabCount };
  });
  changed('import');
  return result;
}

/** Default name for a collection created while saving tabs. */
export function defaultCollectionName(scope, date = new Date()) {
  const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  return scope === 'all' ? `All windows · ${when}` : scope === 'window' ? `Window · ${when}` : `Saved · ${when}`;
}
