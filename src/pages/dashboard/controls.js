/**
 * Small form controls shared by dashboard views.
 */
import { h, toast } from '../../shared/dom.js';
import { errorMessage } from '../../shared/ui.js';

/**
 * @param {string} label
 * @param {HTMLElement} control
 * @param {string} [hint]
 */
export function settingRow(label, control, hint) {
  return h(
    'label',
    { class: 'setting-row' },
    h('span', { class: 'setting-row__text' }, h('span', null, label), hint && h('span', { class: 'muted small' }, hint)),
    control,
  );
}

/**
 * @param {boolean} checked
 * @param {(v: boolean) => Promise<unknown>} onChange
 */
export function toggle(checked, onChange) {
  const input = /** @type {HTMLInputElement} */ (
    h('input', {
      type: 'checkbox',
      class: 'switch',
      role: 'switch',
      checked,
      onChange: () => onChange(input.checked).catch((err) => toast(errorMessage(err), 'error')),
    })
  );
  return input;
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @param {number} step
 * @param {(v: number) => Promise<unknown>} onChange
 * @param {string} [label]
 */
export function numberInput(value, min, max, step, onChange, label) {
  const input = /** @type {HTMLInputElement} */ (
    h('input', {
      class: 'input input--num',
      type: 'number',
      value: String(value),
      min: String(min),
      max: String(max),
      step: String(step),
      'aria-label': label,
      onChange: () => {
        const v = Number(input.value);
        if (!Number.isFinite(v) || v < min || v > max) {
          toast(`Enter a value between ${min} and ${max}.`, 'error');
          return;
        }
        onChange(v).catch((err) => toast(errorMessage(err), 'error'));
      },
    })
  );
  return input;
}

/**
 * @param {{ value: string, label: string }[]} options
 * @param {string} value
 * @param {(v: string) => Promise<unknown>} onChange
 * @param {string} label
 */
export function selectControl(options, value, onChange, label) {
  const select = /** @type {HTMLSelectElement} */ (
    h(
      'select',
      { class: 'btn select', 'aria-label': label, onChange: () => onChange(select.value).catch((err) => toast(errorMessage(err), 'error')) },
      options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)),
    )
  );
  return select;
}
