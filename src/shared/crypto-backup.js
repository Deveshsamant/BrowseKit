/**
 * Password-encrypted backups using the browser's built-in WebCrypto:
 * PBKDF2-SHA-256 (310,000 iterations) derives an AES-256-GCM key. Everything
 * happens locally; the password is never stored. If it is lost, the backup
 * cannot be recovered — the UI says so.
 */

export const ENCRYPTED_FORMAT = 'browsekit-backup-encrypted';
export const DEFAULT_ITERATIONS = 310_000;

/** @param {Uint8Array} bytes */
export function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** @param {string} b64 */
export function fromBase64(b64) {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * @param {string} password
 * @param {Uint8Array} salt
 * @param {number} iterations
 */
async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** @param {unknown} value */
export function isEncryptedBackup(value) {
  return !!value && typeof value === 'object' && /** @type {any} */ (value).format === ENCRYPTED_FORMAT;
}

/**
 * @param {unknown} data JSON-serialisable
 * @param {string} password
 * @param {{ iterations?: number }} [options]
 */
export async function encryptJson(data, password, { iterations = DEFAULT_ITERATIONS } = {}) {
  if (!password || password.length < 8) throw new Error('Use a password of at least 8 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations);
  const plain = new TextEncoder().encode(JSON.stringify(data));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  return {
    format: ENCRYPTED_FORMAT,
    formatVersion: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
    data: toBase64(cipher),
  };
}

/**
 * @param {any} envelope
 * @param {string} password
 * @returns {Promise<unknown>}
 */
export async function decryptJson(envelope, password) {
  if (!isEncryptedBackup(envelope) || envelope.formatVersion !== 1) throw new Error('Not a BrowseKit encrypted backup.');
  const iterations = Number(envelope.kdf?.iterations);
  if (!Number.isInteger(iterations) || iterations < 10_000 || iterations > 10_000_000) throw new Error('Backup has invalid key settings.');
  try {
    const key = await deriveKey(password, fromBase64(envelope.kdf.salt), iterations);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(envelope.cipher.iv) }, key, fromBase64(envelope.data));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new Error('Wrong password, or the file is damaged.');
  }
}
