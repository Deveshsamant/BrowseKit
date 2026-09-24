/**
 * Backup reminder: BrowseKit data lives only in this browser profile, so
 * users are nudged to export a backup every N days (Settings → Backup).
 */
import { countAll, getMeta, setMeta } from '../../shared/db/repository.js';
import { getSettings } from '../../shared/settings.js';
import { STORE_NAMES } from '../../shared/db/schema.js';

export const LAST_BACKUP_KEY = 'lastBackupAt';

/**
 * Pure: is a reminder due?
 * @param {{ now: number, lastBackupAt: number | null, installedAt: number | null, remindDays: number, hasData: boolean }} input
 */
export function backupReminderDue({ now, lastBackupAt, installedAt, remindDays, hasData }) {
  if (!remindDays || !hasData) return false;
  const since = lastBackupAt ?? installedAt ?? now;
  return now - since >= remindDays * 86_400_000;
}

/** Record that a backup was just exported. */
export function markBackedUp() {
  return setMeta(LAST_BACKUP_KEY, Date.now());
}

/** @returns {Promise<{ due: boolean, lastBackupAt: number | null }>} */
export async function backupStatus() {
  const [settings, lastBackupAt, installedAt, counts] = await Promise.all([
    getSettings(),
    getMeta(LAST_BACKUP_KEY),
    getMeta('installedAt'),
    countAll(),
  ]);

  const hasData = STORE_NAMES.some((s) => s !== 'meta' && counts[s] > 0);
  return {
    due: backupReminderDue({ now: Date.now(), lastBackupAt: lastBackupAt ?? null, installedAt: installedAt ?? null, remindDays: settings.backup.remindDays, hasData }),
    lastBackupAt: lastBackupAt ?? null,
  };
}
