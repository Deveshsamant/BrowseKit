/**
 * Offline developer & text utilities (pure, unit-tested). Randomness comes
 * from crypto.getRandomValues; hashing from crypto.subtle.
 */

/**
 * @param {string} text
 * @param {number} [indent] 0 = minify
 * @returns {{ ok: true, text: string } | { ok: false, error: string }}
 */
export function formatJson(text, indent = 2) {
  try {
    return { ok: true, text: JSON.stringify(JSON.parse(text), null, indent || undefined) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** UTF-8 safe Base64. @param {string} text */
export function base64Encode(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** @param {string} b64 accepts URL-safe alphabet and missing padding */
export function base64Decode(b64) {
  const clean = b64.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** @param {string} text */
export const urlEncode = (text) => encodeURIComponent(text);
/** @param {string} text */
export const urlDecode = (text) => decodeURIComponent(text.replace(/\+/g, ' '));

/**
 * @param {'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512'} algorithm
 * @param {string} text
 * @returns {Promise<string>} lower-case hex
 */
export async function hashText(algorithm, text) {
  const digest = await crypto.subtle.digest(algorithm, new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** @returns {string} RFC 4122 v4 UUID */
export function uuid() {
  return crypto.randomUUID();
}

const SETS = {
  lower: 'abcdefghijkmnopqrstuvwxyz',
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  digits: '23456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?/',
};

/** Unbiased random integer in [0, max). @param {number} max */
function randomInt(max) {
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return buf[0] % max;
}

/**
 * Random password with at least one character from each chosen set.
 * Look-alike characters (0/O, 1/l/I) are excluded.
 * @param {{ length?: number, lower?: boolean, upper?: boolean, digits?: boolean, symbols?: boolean }} [options]
 */
export function generatePassword({ length = 20, lower = true, upper = true, digits = true, symbols = true } = {}) {
  const sets = Object.entries({ lower, upper, digits, symbols })
    .filter(([, on]) => on)
    .map(([k]) => SETS[/** @type {keyof typeof SETS} */ (k)]);
  if (!sets.length) throw new Error('Choose at least one character type.');
  const len = Math.max(sets.length, Math.min(128, Math.round(length)));
  const all = sets.join('');
  const chars = sets.map((set) => set[randomInt(set.length)]);
  while (chars.length < len) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** @param {string} text */
function words(text) {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * @param {string} text
 * @param {'upper' | 'lower' | 'title' | 'sentence' | 'camel' | 'snake' | 'kebab'} mode
 */
export function convertCase(text, mode) {
  switch (mode) {
    case 'upper':
      return text.toUpperCase();
    case 'lower':
      return text.toLowerCase();
    case 'title':
      return text.toLowerCase().replace(/(^|[\s\-_(["'])(\p{L})/gu, (_, p, c) => p + c.toUpperCase());
    case 'sentence':
      return text.toLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_, p, c) => p + c.toUpperCase());
    case 'camel':
      return words(text)
        .map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()))
        .join('');
    case 'snake':
      return words(text).map((w) => w.toLowerCase()).join('_');
    case 'kebab':
      return words(text).map((w) => w.toLowerCase()).join('-');
    default:
      throw new Error(`Unknown case ${mode}`);
  }
}

/**
 * Interpret a timestamp: epoch seconds, epoch milliseconds, or a date string.
 * @param {string} input
 * @returns {{ ok: true, ms: number, iso: string, seconds: number } | { ok: false, error: string }}
 */
export function parseTimestamp(input) {
  const v = input.trim();
  if (!v) return { ok: false, error: 'Enter a timestamp or date.' };
  let ms;
  if (/^-?\d+(\.\d+)?$/.test(v)) {
    const n = Number(v);
    ms = Math.abs(n) < 1e11 ? n * 1000 : n; // < ~year 5138 in seconds → treat as seconds
  } else {
    ms = Date.parse(v);
  }
  if (!Number.isFinite(ms)) return { ok: false, error: 'Unrecognised date.' };
  return { ok: true, ms, iso: new Date(ms).toISOString(), seconds: Math.floor(ms / 1000) };
}
