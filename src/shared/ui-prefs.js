/**
 * Accent colour and density preferences → data attributes on <html>.
 * Shared by the dashboard, popup/side panel and other extension pages.
 */
import { getSettings, onSettingsChanged } from './settings.js';

/** @param {{ ui: { accent: string, density: string } }} s */
function apply(s) {
  const root = document.documentElement;
  root.dataset.accent = s.ui.accent;
  root.dataset.density = s.ui.density;
}

export async function applyUiPrefs() {
  apply(await getSettings());
  onSettingsChanged(apply);
}
