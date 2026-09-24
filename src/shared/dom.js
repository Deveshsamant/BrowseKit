/**
 * Minimal, safe DOM builder. Strings become text nodes, never HTML, so
 * untrusted page titles/URLs cannot inject markup.
 */

/**
 * @param {string} tag
 * @param {Record<string, any> | null} [props]
 *   `class`, `dataset`, `on<Event>` handlers, DOM properties, or attributes.
 * @param {...any} children strings, numbers, Nodes, arrays, or null/false (skipped)
 * @returns {HTMLElement}
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'style') {
      throw new Error('Inline styles are blocked by CSP; use a class');
    } else if (key in el && typeof value !== 'string') el[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

/**
 * @param {Node} parent
 * @param {any[]} children
 */
function append(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  }
}

/**
 * Replace all children of `el`.
 * @param {Element} el
 * @param {...any} children
 */
export function mount(el, ...children) {
  el.replaceChildren();
  append(el, children);
}

let toastTimer = 0;

/**
 * Show a transient status message in the page's #toast region (aria-live).
 * @param {string} message
 * @param {'info' | 'error'} [kind]
 */
export function toast(message, kind = 'info') {
  const region = document.getElementById('toast');
  if (!region) return;
  region.textContent = message;
  region.dataset.kind = kind;
  region.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => region.classList.remove('is-visible'), 3500);
}
