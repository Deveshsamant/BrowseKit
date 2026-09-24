/**
 * Accessible modal dialogs built on <dialog> (replacing window.confirm/prompt),
 * plus small shared UI pieces.
 */
import { h } from './dom.js';

/**
 * @param {{ title: string, body?: any, confirmLabel?: string, cancelLabel?: string, danger?: boolean, input?: { label: string, value?: string, placeholder?: string, required?: boolean }, content?: HTMLElement }} options
 * @returns {Promise<string | boolean | null>} input value / true when confirmed, null when cancelled
 */
function openDialog({ title, body, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false, input, content }) {
  return new Promise((resolve) => {
    const field = input
      ? h('input', {
          class: 'input',
          type: 'text',
          value: input.value ?? '',
          placeholder: input.placeholder ?? '',
          'aria-label': input.label,
          required: input.required ?? true,
          maxLength: 300,
        })
      : null;
    const confirmBtn = h(
      'button',
      { class: `btn ${danger ? 'btn--danger-solid' : 'btn--primary'}`, type: 'submit', value: 'ok' },
      confirmLabel,
    );
    const form = h(
      'form',
      { method: 'dialog', class: 'dialog__form' },
      h('h2', { class: 'dialog__title' }, title),
      body && h('div', { class: 'dialog__body' }, body),
      field && h('label', { class: 'field' }, h('span', { class: 'field__label' }, input.label), field),
      content,
      h(
        'div',
        { class: 'dialog__actions' },
        h('button', { class: 'btn', type: 'submit', value: 'cancel', formNoValidate: true }, cancelLabel),
        confirmBtn,
      ),
    );
    const dialog = h('dialog', { class: 'dialog', 'aria-label': title }, form);
    document.body.append(dialog);
    dialog.addEventListener('close', () => {
      const ok = dialog.returnValue === 'ok';
      dialog.remove();
      if (!ok) resolve(null);
      else resolve(field ? field.value.trim() : true);
    });
    dialog.showModal();
    (field ?? confirmBtn).focus();
    if (field) field.select();
  });
}

/**
 * @param {{ title: string, body?: any, confirmLabel?: string, danger?: boolean }} options
 * @returns {Promise<boolean>}
 */
export async function confirmDialog(options) {
  return (await openDialog(options)) === true;
}

/**
 * @param {{ title: string, label: string, value?: string, placeholder?: string, confirmLabel?: string }} options
 * @returns {Promise<string | null>} trimmed non-empty value, or null
 */
export async function promptDialog({ title, label, value, placeholder, confirmLabel = 'Save' }) {
  const result = await openDialog({ title, confirmLabel, input: { label, value, placeholder } });
  return typeof result === 'string' && result ? result : null;
}

/**
 * Let the user pick one option from a list.
 * @param {{ title: string, label: string, options: { value: string, label: string }[], value?: string, confirmLabel?: string }} options
 * @returns {Promise<string | null>}
 */
export async function selectDialog({ title, label, options, value, confirmLabel = 'OK' }) {
  const select = h(
    'select',
    { class: 'btn select', 'aria-label': label },
    options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)),
  );
  const ok = await openDialog({
    title,
    confirmLabel,
    content: h('label', { class: 'field' }, h('span', { class: 'field__label' }, label), select),
  });
  return ok ? select.value : null;
}

/**
 * Empty-state block.
 * @param {string} title
 * @param {string} [hint]
 * @param {any} [action]
 */
export function emptyState(title, hint, action) {
  return h(
    'div',
    { class: 'empty' },
    h('p', { class: 'empty__title' }, title),
    hint && h('p', { class: 'muted' }, hint),
    action,
  );
}

/**
 * Favicon from Chrome's local cache (requires the "favicon" permission).
 * Never loads icons from websites.
 * @param {string} pageUrl
 * @param {number} [size]
 */
export function favicon(pageUrl, size = 16) {
  const src = chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=${size * 2}`);
  return h('img', { class: 'favicon', src, alt: '', width: size, height: size, loading: 'lazy', decoding: 'async' });
}

/**
 * Debounce a function.
 * @template {(...args: any[]) => void} F
 * @param {F} fn
 * @param {number} ms
 * @returns {F}
 */
export function debounce(fn, ms) {
  let timer = 0;
  return /** @type {F} */ (
    (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    }
  );
}

/**
 * Human-friendly error text.
 * @param {unknown} err
 */
export function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}
