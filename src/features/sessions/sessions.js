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
/** @typedef {{ id: string, name: string, kind?: 'manual' | 'autosave', createdAt: number, updatedAt: number, windows: { tabs: SessionTab[] }[] }} Session */

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
 * Stable fingerprint of a set of windows (URLs + pinned state), used to skip
 * autosaves when nothing changed.
 * @param {{ tabs: SessionTab[] }[]} windows
 */
export function sessionFingerprint(windows) {
  return windows.map((w) => w.tabs.map((t) => `${t.pinned ? '*' : ''}${t.url}`).join('\n')).join('\n--\n');
}

/** Current open windows as session windows. */
async function currentWindows() {
  const tabs = await chrome.tabs.query({ windowType: 'normal' });
  return windowsFromTabs(tabs.map((t) => ({ ...toTabInfo(t), index: t.index, windowId: t.windowId })), ownOrigin());
}

/**
 * Snapshot all normal windows.
 * @param {string} name
 * @param {'manual' | 'autosave'} [kind]
 * @returns {Promise<Session>}
 */
export async function saveCurrentSession(name, kind = 'manual') {
  const windows = await currentWindows();
  if (!windows.length) throw new Error('No saveable tabs are open.');
  const now = Date.now();
  /** @type {Session} */
  const session = {
    id: crypto.randomUUID(),
    name: String(name).trim().slice(0, 120) || 'Session',
    kind,
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

/**
 * Autosave if the open tabs changed since the last autosave; keep the newest
 * `keep` autosaves. Returns the new session, or null when nothing changed.
 * @param {number} keep
 */
export async function autosaveSession(keep) {
  const windows = await currentWindows();
  if (!windows.length) return null;
  const all = await listSessions();
  const autosaves = all.filter((x) => x.kind === 'autosave');
  if (autosaves[0] && sessionFingerprint(autosaves[0].windows) === sessionFingerprint(windows)) return null;
  const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
  const session = await saveCurrentSession(`Autosave · ${when}`, 'autosave');
  const stale = [session, ...autosaves].slice(keep);
  if (stale.length) {
    await transaction(S, 'readwrite', (tx) => {
      for (const old of stale) tx.objectStore(S).delete(old.id);
    });
    changed('prune');
  }
  return session;
}

/**
 * Workspace switch: autosave what is open, open the target session in new
 * windows, then close the windows that were open before. Nothing is lost —
 * the previous state is in the autosave list.
 * @param {Session} session
 * @param {number} keep autosaves to keep
 */
export async function switchToSession(session, keep) {
  const before = await chrome.windows.getAll({ windowTypes: ['normal'] });
  const snapshotName = `Before switching to “${session.name}”`;
  const windows = await currentWindows();
  if (windows.length) {
    await saveCurrentSession(snapshotName, 'autosave');
    const autosaves = (await listSessions()).filter((x) => x.kind === 'autosave');
    const stale = autosaves.slice(keep);
    if (stale.length) {
      await transaction(S, 'readwrite', (tx) => stale.forEach((old) => tx.objectStore(S).delete(old.id)));
    }
  }
  const result = await restoreSession(session);
  if (result.opened === 0) throw new Error('Nothing could be opened; your current windows were left as they are.');
  for (const win of before) {
    if (win.id !== undefined) await chrome.windows.remove(win.id).catch(() => {});
  }
  changed('switch');
  return result;
}
