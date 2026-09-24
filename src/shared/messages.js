/**
 * Request/response messaging between extension contexts.
 *
 *   request:  { type: 'domain/action', payload }
 *   response: { ok: true, data } | { ok: false, error: { code, message } }
 */

/**
 * @param {unknown} err
 * @returns {{ code: string, message: string }}
 */
export function serializeError(err) {
  if (err && typeof err === 'object') {
    const e = /** @type {{ code?: unknown, name?: unknown, message?: unknown }} */ (err);
    return {
      code: typeof e.code === 'string' ? e.code : typeof e.name === 'string' ? e.name : 'ERROR',
      message: typeof e.message === 'string' ? e.message : String(err),
    };
  }
  return { code: 'ERROR', message: String(err) };
}

/**
 * Create a `chrome.runtime.onMessage` listener that dispatches by `message.type`.
 * Messages without a registered handler are ignored so other listeners may answer.
 *
 * @param {Record<string, (payload: any, sender: chrome.runtime.MessageSender) => any>} handlers
 * @param {{ extensionId?: string }} [options] reject senders from other extensions
 */
export function createRouter(handlers, { extensionId } = {}) {
  return function onMessage(message, sender, sendResponse) {
    if (!message || typeof message.type !== 'string') return false;
    if (!Object.hasOwn(handlers, message.type)) return false;
    if (extensionId && sender?.id !== extensionId) {
      sendResponse({ ok: false, error: { code: 'FORBIDDEN', message: 'Unknown sender' } });
      return false;
    }
    Promise.resolve()
      .then(() => handlers[message.type](message.payload, sender))
      .then(
        (data) => sendResponse({ ok: true, data }),
        (err) => sendResponse({ ok: false, error: serializeError(err) }),
      );
    return true; // keep the channel open for the async response
  };
}

/**
 * Send a request to the service worker and unwrap the response.
 * @template T
 * @param {string} type
 * @param {unknown} [payload]
 * @returns {Promise<T>}
 */
export async function send(type, payload) {
  const response = await chrome.runtime.sendMessage({ type, payload });
  if (!response) throw new Error(`No handler responded to "${type}"`);
  if (!response.ok) {
    const error = new Error(response.error?.message ?? 'Unknown error');
    error.code = response.error?.code ?? 'ERROR';
    throw error;
  }
  return response.data;
}
