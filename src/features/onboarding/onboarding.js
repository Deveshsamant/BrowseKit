/**
 * "Get started" checklist on Home. Steps complete themselves from real data,
 * so there is nothing to tick by hand.
 */

export const ONBOARDING_KEY = 'onboarding';

/** @typedef {{ pinned: boolean, vaultTabs: number, watchLater: number, usedSearch: boolean, viewedShortcuts: boolean, backedUp: boolean }} OnboardingState */

/**
 * Pure.
 * @param {OnboardingState} s
 */
export function onboardingSteps(s) {
  return [
    { id: 'pin', title: 'Pin BrowseKit to the toolbar', hint: 'Puzzle-piece menu → pin icon, for one-click access.', done: s.pinned },
    { id: 'vault', title: 'Save a tab to TabVault', hint: 'Popup → Save → This tab / This window.', done: s.vaultTabs > 0 },
    { id: 'watch', title: 'Queue something in Watch Later', hint: 'Right-click a page or link → Save to Watch Later.', done: s.watchLater > 0 },
    { id: 'search', title: 'Search everything', hint: 'Press Ctrl+K here, or type in the popup’s search box.', done: s.usedSearch },
    { id: 'shortcuts', title: 'Review keyboard shortcuts', hint: 'Press ? on the dashboard.', done: s.viewedShortcuts },
    { id: 'backup', title: 'Export your first backup', hint: 'Settings → Backup & data. Your data lives only in this browser.', done: s.backedUp },
  ];
}

/** @returns {Promise<{ usedSearch?: boolean, viewedShortcuts?: boolean }>} */
export async function getOnboardingFlags() {
  return (await chrome.storage.local.get(ONBOARDING_KEY))[ONBOARDING_KEY] ?? {};
}

/** @param {'usedSearch' | 'viewedShortcuts'} flag */
export async function markOnboarding(flag) {
  const flags = await getOnboardingFlags();
  if (flags[flag]) return;
  await chrome.storage.local.set({ [ONBOARDING_KEY]: { ...flags, [flag]: true } });
}

/** Is the extension pinned to the toolbar? (Chrome 91+; false if unknown.) */
export async function isPinned() {
  try {
    return !!(await chrome.action.getUserSettings()).isOnToolbar;
  } catch {
    return false;
  }
}
