import { describe, it, expect } from 'vitest';

import { getTheme, DEFAULT_THEME_ID } from '@/lib/themes';

describe('getTheme', () => {
  it('falls back to the default theme for unknown / null / undefined ids', () => {
    expect(getTheme('does-not-exist').id).toBe(DEFAULT_THEME_ID);
    expect(getTheme(null).id).toBe(DEFAULT_THEME_ID);
    expect(getTheme(undefined).id).toBe(DEFAULT_THEME_ID);
  });

  it('returns the matching theme for a known id', () => {
    expect(getTheme(DEFAULT_THEME_ID).id).toBe(DEFAULT_THEME_ID);
  });
});
