/**
 * Standalone palette window (keyboard command "Search everything").
 * Closes when it loses focus or after running a result.
 */
import { initTheme } from '../../shared/theme.js';
import { applyUiPrefs } from '../../shared/ui-prefs.js';
import { mountPalette } from './palette-ui.js';

initTheme().catch(() => {});
applyUiPrefs().catch(() => {});
mountPalette(/** @type {HTMLElement} */ (document.getElementById('palette')), { onDone: () => window.close() });
window.addEventListener('blur', () => setTimeout(() => {
  if (!document.hasFocus()) window.close();
}, 150));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close();
});
