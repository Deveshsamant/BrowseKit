/**
 * Backup file format: building and validating. Pure functions (no IDB/chrome
 * access) so they are unit-testable in Node.
 */
import { DB_VERSION, KEY_PATHS, STORE_NAMES } from './schema.js';

export const BACKUP_FORMAT = 'browsekit-backup';
export const BACKUP_FORMAT_VERSION = 1;
/** Refuse absurd files before parsing work balloons memory. */
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

/**
 * @param {{ stores: Record<string, any[]>, settings: Record<string, any>, mediaSites?: Record<string, any>, appVersion: string, now?: Date }} input
 */
export function buildBackup({ stores, settings, mediaSites = {}, appVersion, now = new Date() }) {
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: DB_VERSION,
    appVersion,
    exportedAt: now.toISOString(),
    stores: Object.fromEntries(STORE_NAMES.map((s) => [s, stores[s] ?? []])),
    settings,
    mediaSites,
  };
}

/** @param {unknown} v */
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Validate a parsed backup. Nothing is written unless this returns ok.
 * @param {unknown} data
 * @returns {{ ok: true, backup: ReturnType<typeof buildBackup> } | { ok: false, errors: string[] }}
 */
export function validateBackup(data) {
  const errors = [];
  if (!isObject(data)) return { ok: false, errors: ['File is not a BrowseKit backup (not an object).'] };
  const d = /** @type {Record<string, any>} */ (data);

  if (d.format !== BACKUP_FORMAT) errors.push('File is not a BrowseKit backup (missing format marker).');
  if (d.formatVersion !== BACKUP_FORMAT_VERSION) {
    errors.push(`Unsupported backup format version: ${String(d.formatVersion)}.`);
  }
  if (!Number.isInteger(d.schemaVersion) || d.schemaVersion > DB_VERSION) {
    errors.push(
      `Backup was made by a newer BrowseKit (schema ${String(d.schemaVersion)}); this version supports up to ${DB_VERSION}.`,
    );
  }
  if (!isObject(d.stores)) errors.push('Backup has no "stores" object.');
  if (d.settings !== undefined && !isObject(d.settings)) errors.push('"settings" must be an object.');
  if (d.mediaSites !== undefined && !isObject(d.mediaSites)) errors.push('"mediaSites" must be an object.');
  if (errors.length) return { ok: false, errors };

  for (const name of Object.keys(d.stores)) {
    if (!STORE_NAMES.includes(name)) errors.push(`Unknown store "${name}".`);
  }
  for (const name of STORE_NAMES) {
    const rows = d.stores[name];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) {
      errors.push(`Store "${name}" must be an array.`);
      continue;
    }
    const keyPath = KEY_PATHS[name];
    const seen = new Set();
    rows.forEach((row, i) => {
      if (!isObject(row)) {
        errors.push(`${name}[${i}] is not an object.`);
        return;
      }
      const key = row[keyPath];
      if (typeof key !== 'string' || key.length === 0) {
        errors.push(`${name}[${i}] is missing a string "${keyPath}".`);
      } else if (seen.has(key)) {
        errors.push(`${name}[${i}] duplicates ${keyPath} "${key}".`);
      } else {
        seen.add(key);
      }
    });
    if (errors.length > 20) {
      errors.push('…more errors omitted.');
      break;
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, backup: /** @type {ReturnType<typeof buildBackup>} */ (d) };
}
