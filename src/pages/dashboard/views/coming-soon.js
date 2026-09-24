import { h, mount } from '../../../shared/dom.js';

/**
 * @typedef {{
 *   title: string,
 *   summary: string,
 *   phase: string,
 *   features: string[],
 *   permissions: string[],
 *   limits: string[],
 * }} PlannedSection
 */

/**
 * View factory for sections that are designed but not built yet. States plainly
 * that the feature is not available, what it will do, and its known limits.
 * @param {PlannedSection} section
 */
export function comingSoon(section) {
  return {
    title: section.title,
    /** @param {HTMLElement} root */
    render(root) {
      mount(
        root,
        h(
          'header',
          { class: 'page-header' },
          h('div', null, h('h1', null, section.title), h('p', { class: 'muted' }, section.summary)),
        ),
        h(
          'div',
          { class: 'stack' },
          h(
            'p',
            { class: 'phase-note' },
            h('span', { class: 'badge' }, 'Not built yet'),
            h('span', { class: 'muted' }, `Planned for ${section.phase}.`),
          ),
          h(
            'div',
            { class: 'two-col' },
            h(
              'section',
              { class: 'card' },
              h('h2', { class: 'card__title' }, 'Planned features'),
              h('ul', { class: 'plain-list' }, section.features.map((f) => h('li', null, f))),
            ),
            h(
              'section',
              { class: 'card' },
              h('h2', { class: 'card__title' }, 'Permissions it will need'),
              h('ul', { class: 'plain-list' }, section.permissions.map((p) => h('li', null, p))),
              section.limits.length > 0 && h('h3', { class: 'card__title' }, 'Known browser limits'),
              section.limits.length > 0 &&
                h('ul', { class: 'plain-list muted' }, section.limits.map((l) => h('li', null, l))),
            ),
          ),
        ),
      );
    },
  };
}
