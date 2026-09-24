/**
 * Small formatting helpers (locale-aware, no dependencies).
 */

/**
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 || value >= 10 ? 0 : 1)} ${units[unit]}`;
}

/**
 * @param {number} n
 * @returns {string}
 */
export function formatNumber(n) {
  return new Intl.NumberFormat().format(n);
}

/**
 * @param {number | string | Date} date
 * @returns {string}
 */
export function formatDateTime(date) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(date),
  );
}

/**
 * YYYY-MM-DD in local time, for file names.
 * @param {Date} [date]
 */
export function isoDay(date = new Date()) {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
