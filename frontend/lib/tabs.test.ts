import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useTabs } from '@/lib/tabs';

// The tab system is core interactive state (localStorage-backed). renderHook +
// jsdom's localStorage exercises it without the full app shell.
describe('useTabs', () => {
  beforeEach(() => localStorage.clear());

  it('starts with a single "new" tab', () => {
    const { result } = renderHook(() => useTabs());
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.active?.kind).toBe('new');
  });

  it('openPage replaces the active tab in place', () => {
    const { result } = renderHook(() => useTabs());
    act(() => result.current.openPage('eng/architecture.md'));
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.active).toMatchObject({ kind: 'page', path: 'eng/architecture.md' });
  });

  it('openPage(asNewTab) appends a tab and activates it', () => {
    const { result } = renderHook(() => useTabs());
    act(() => result.current.openPage('a.md'));
    act(() => result.current.openPage('b.md', true));
    expect(result.current.tabs).toHaveLength(2);
    expect(result.current.active).toMatchObject({ path: 'b.md' });
  });

  it('rewritePagePath follows a rename across open tabs', () => {
    const { result } = renderHook(() => useTabs());
    act(() => result.current.openPage('old/p.md'));
    act(() => result.current.rewritePagePath('old/p.md', 'new/p.md'));
    expect(result.current.active).toMatchObject({ path: 'new/p.md' });
  });

  it('closing the last tab resets to a fresh "new" tab', () => {
    const { result } = renderHook(() => useTabs());
    const id = result.current.activeId;
    act(() => result.current.closeTab(id));
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.active?.kind).toBe('new');
  });
});
