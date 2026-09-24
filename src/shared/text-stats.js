/**
 * Word/character counts and reading time. Pure; uses Intl.Segmenter so
 * languages without spaces (Chinese, Japanese, Thai…) count sensibly.
 */

/** Average adult silent reading speed for English prose (words per minute). */
export const WORDS_PER_MINUTE = 238;

/**
 * @param {string} text
 * @returns {{ words: number, characters: number, charactersNoSpaces: number, lines: number, readingMinutes: number }}
 */
export function textStats(text) {
  const value = typeof text === 'string' ? text : '';
  let words = 0;
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    for (const segment of segmenter.segment(value)) if (segment.isWordLike) words += 1;
  } else {
    words = value.split(/\s+/).filter(Boolean).length;
  }
  const graphemes = (/** @type {string} */ s) => {
    if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
      let n = 0;
      for (const _ of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)) n += 1;
      return n;
    }
    return [...s].length;
  };
  return {
    words,
    characters: graphemes(value),
    charactersNoSpaces: graphemes(value.replace(/\s+/g, '')),
    lines: value.length ? value.split(/\r\n|\r|\n/).length : 0,
    readingMinutes: words / WORDS_PER_MINUTE,
  };
}

/**
 * @param {number} minutes
 * @returns {string} e.g. "< 1 min", "4 min", "1 h 12 min"
 */
export function formatReadingTime(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0 min';
  if (minutes < 1) return '< 1 min';
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
