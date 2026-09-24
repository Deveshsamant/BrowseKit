/**
 * Saved sessions: snapshots of every open window's tabs, stored in IndexedDB.
 * Record: { id, name, createdAt, updatedAt, windows: [{ tabs: [{ url, title, pinned }] }] }
 */
import { notifyChange, promisify, transaction } from '../../shared/db/database.js';
import { STORES } from '../../shared/db/schema.js';
import { openTabs, ownOrigin, toTabInfo } from '../../shared/tabs.js';
import { isSaveableUrl } from '../../shared/urls.js';

const S = STORES.SESSIONS;
const changed = (/** @type {string} */ op) => notifyChange({ stores: [S], op });

/** @typedef {{ url: string, title: string, pinned: boolean }} SessionTab */
/** @typedef {{ id: string, name: string, createdAt: number, updatedAt: number, windows: { tabs: SessionTab[] }[] }} Session */

/**
 * Build session windows from chrome.tabs.Tab-like objects (pure).
 * @param {{ windowId: number, index: number, url?: string, pendingUrl?: string, title?: string, pinned?: boolean }[]} tabs
 * @param {string} [skipOrigin]
 * @returns {{ tabs: SessionTab[] }[]}
 */
export function windowsFromTabs(tabs, skipOrigin) {
  /** @type {Map<number, SessionTab[]>} */
  const byWindow = new Map();
  for (const tab of [...tabs].sort((a, b) => a.windowId - b.windowId || a.index - b.index)) {
    const url = tab.url || tab.pendingUrl || '';
    if (!isSaveableUrl(url, skipOrigin)) continue;
    const list = byWindow.get(tab.windowId) ?? [];
    list.push({ url, title: (tab.title || url).slice(0, 500), pinned: !!tab.pinned });
    byWindow.set(tab.windowId, list);
  }
  return [...byWindow.values()].map((list) => ({ tabs: list }));
}

/** @param {Session} session */
export function sessionTabCount(session) {
  return session.windows.reduce((n, w) => n + w.tabs.length, 0);
}

/**
 * Snapshot all normal windows.
 * @param {string} name
 * @returns {Promise<Session>}
 */
export async function saveCurrentSession(name) {
  const tabs = await chrome.tabs.query({ windowType: 'normal' });
  const windows = windowsFromTabs(tabs.map((t) => ({ ...toTabInfo(t), index: t.index, windowId: t.windowId })), ownOrigin());
  if (!windows.length) throw new Error('No saveable tabs are open.');
  const now = Date.now();
  /** @type {Session} */
  const session = {
    id: crypto.randomUUID(),
    name: String(name).trim().slice(0, 120) || 'Session',
    createdAt: now,
    updatedAt: now,
    windows,
  };
  await transaction(S, 'readwrite', (tx) => promisify(tx.objectStore(S).put(session)));
  changed('save');
  return session;
}

/** @returns {Promise<Session[]>} newest first */
export async function listSessions() {
  const all = await transaction(S, 'readonly', (tx) => promisify(tx.objectStore(S).getAll()));
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

/** @param {string} id @param {string} name */
export async function renameSession(id, name) {
  await transaction(S, 'readwrite', async (tx) => {
    const store = tx.objectStore(S);
    const record = await promisify(store.get(id));
    if (!record) throw new Error('Session not found.');
    store.put({ ...record, name: String(name).trim().slice(0, 120) || record.name, updatedAt: Date.now() });
  });
  changed('rename');
}

/** @param {string} id */
export async function deleteSession(id) {
  await transaction(S, 'readwrite', (tx) => promisify(tx.objectStore(S).delete(id)));
  changed('delete');
}

/**
 * Reopen a session: one new window per saved window, pinned state restored.
 * @param {Session} session
 * @returns {Promise<{ opened: number, failed: string[] }>}
 */
export async function restoreSession(session) {
  let opened = 0;
  const failed = [];
  for (const win of session.windows) {
    const r = await openTabs(win.tabs, { newWindow: true });
    opened += r.opened;
    failed.push(...r.failed);
  }
  return { opened, failed };
}
