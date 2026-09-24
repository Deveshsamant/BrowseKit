/**
 * Pure snooze-time presets (local time).
 */

/** @typedef {'later' | 'evening' | 'tomorrow' | 'weekend' | 'next-week' | 'next-month'} SnoozePreset */

export const SNOOZE_PRESETS = Object.freeze([
  { id: 'later', label: 'Later today', hint: '+3 hours' },
  { id: 'evening', label: 'This evening', hint: '7:00 PM' },
  { id: 'tomorrow', label: 'Tomorrow', hint: '9:00 AM' },
  { id: 'weekend', label: 'This weekend', hint: 'Sat 9:00 AM' },
  { id: 'next-week', label: 'Next week', hint: 'Mon 9:00 AM' },
  { id: 'next-month', label: 'Next month', hint: '1st, 9:00 AM' },
]);

/**
 * @param {Date} base
 * @param {number} addDays
 * @param {number} hour
 */
function at(base, addDays, hour) {
  const d = new Date(base);
  d.setDate(d.getDate() + addDays);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/**
 * Wake time for a preset. "This evening" after 6 PM becomes tomorrow evening;
 * "This weekend" on a weekend becomes next Saturday.
 * @param {SnoozePreset} preset
 * @param {Date} [now]
 * @returns {number} epoch ms
 */
export function wakeTimeFor(preset, now = new Date()) {
  switch (preset) {
    case 'later':
      return now.getTime() + 3 * 60 * 60 * 1000;
    case 'evening':
      return at(now, now.getHours() >= 18 ? 1 : 0, 19).getTime();
    case 'tomorrow':
      return at(now, 1, 9).getTime();
    case 'weekend': {
      const day = now.getDay(); // 0 Sun … 6 Sat
      const toSat = (6 - day + 7) % 7 || 7;
      return at(now, toSat, 9).getTime();
    }
    case 'next-week': {
      const toMon = (1 - now.getDay() + 7) % 7 || 7;
      return at(now, toMon, 9).getTime();
    }
    case 'next-month': {
      const d = new Date(now.getFullYear(), now.getMonth() + 1, 1, 9, 0, 0, 0);
      return d.getTime();
    }
    default:
      throw new Error(`Unknown snooze preset ${preset}`);
  }
}
