import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useFolderOrder } from '@/lib/folderOrder';

describe('useFolderOrder', () => {
  beforeEach(() => localStorage.clear());

  it('starts with no explicit order', () => {
    const { result } = renderHook(() => useFolderOrder());
    expect(result.current.order).toEqual([]);
  });

  it('move pins the dragged folder immediately before the target', () => {
    const { result } = renderHook(() => useFolderOrder());
    act(() => result.current.move('a', 'b')); // [] -> ['a','b']
    expect(result.current.order).toEqual(['a', 'b']);
    act(() => result.current.move('b', 'a')); // ['a','b'] -> ['b','a']
    expect(result.current.order).toEqual(['b', 'a']);
  });

  it('forget drops a path from the explicit order', () => {
    const { result } = renderHook(() => useFolderOrder());
    act(() => result.current.move('a', 'b'));
    act(() => result.current.forget('a'));
    expect(result.current.order).not.toContain('a');
  });
});
