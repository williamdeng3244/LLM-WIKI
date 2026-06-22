import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { MESSAGES, useLanguage } from '@/lib/i18n';

describe('MESSAGES (translation table)', () => {
  it('en and zh expose identical key sets (no missing/extra translations)', () => {
    const en = Object.keys(MESSAGES.en).sort();
    const zh = Object.keys(MESSAGES.zh).sort();
    expect(zh).toEqual(en);
  });

  it('no translation value is empty', () => {
    for (const [k, v] of Object.entries(MESSAGES.en)) {
      expect(v, `en.${k}`).toBeTruthy();
    }
    for (const [k, v] of Object.entries(MESSAGES.zh)) {
      expect(v, `zh.${k}`).toBeTruthy();
    }
  });
});

describe('useLanguage', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to zh and t() returns a string for a known key', () => {
    const { result } = renderHook(() => useLanguage());
    expect(result.current.lang).toBe('zh');
    const key = Object.keys(MESSAGES.en)[0] as Parameters<typeof result.current.t>[0];
    expect(typeof result.current.t(key)).toBe('string');
  });

  it('setLang switches the active language', () => {
    const { result } = renderHook(() => useLanguage());
    act(() => result.current.setLang('zh'));
    expect(result.current.lang).toBe('zh');
  });
});
