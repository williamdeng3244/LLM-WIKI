import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useTheme } from '@/lib/theme';

describe('useTheme', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to dark mode', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
  });

  it('setTheme switches the mode and toggle flips it back', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme('light'));
    expect(result.current.theme).toBe('light');
    act(() => result.current.toggle());
    expect(result.current.theme).toBe('dark');
  });

  it('setThemeId changes the palette id', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setThemeId('nebula'));
    expect(result.current.themeId).toBe('nebula');
  });
});
