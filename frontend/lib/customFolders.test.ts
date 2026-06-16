import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useCustomFolders } from '@/lib/customFolders';

describe('useCustomFolders', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty', () => {
    const { result } = renderHook(() => useCustomFolders());
    expect(result.current.folders).toEqual([]);
  });

  it('add cleans surrounding/duplicate slashes; remove deletes', () => {
    const { result } = renderHook(() => useCustomFolders());
    act(() => result.current.add('  /eng//sub/  '));
    expect(result.current.folders).toContain('eng/sub');
    act(() => result.current.remove('eng/sub'));
    expect(result.current.folders).not.toContain('eng/sub');
  });

  it('rejects path-traversal segments', () => {
    const { result } = renderHook(() => useCustomFolders());
    act(() => result.current.add('../escape'));
    act(() => result.current.add('a/./b'));
    expect(result.current.folders).toHaveLength(0);
  });

  it('does not add duplicates', () => {
    const { result } = renderHook(() => useCustomFolders());
    act(() => {
      result.current.add('x');
      result.current.add('x');
    });
    expect(result.current.folders.filter((f) => f === 'x')).toHaveLength(1);
  });
});
