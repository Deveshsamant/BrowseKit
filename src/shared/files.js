/**
 * Local file helpers for extension pages. Downloads use a blob: URL, so no
 * "downloads" permission is needed and nothing leaves the device.
 */
import { h } from './dom.js';

export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

/**
 * @param {string} filename
 * @param {string | Blob} content
 * @param {string} [type]
 */
export function downloadFile(filename, content, type = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * @param {File} file
 * @returns {Promise<string>}
 */
export async function readFileAsText(file) {
  if (file.size > MAX_IMPORT_BYTES) throw new Error('File is too large (limit 50 MB).');
  return file.text();
}
