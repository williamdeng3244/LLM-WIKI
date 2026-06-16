import { describe, it, expect } from 'vitest';

import { categoryColor, visibleCategories } from '@/lib/graphSettings';

describe('categoryColor', () => {
  it('returns the neutral gray for null / undefined / empty', () => {
    expect(categoryColor(null)).toBe('#9aa1b8');
    expect(categoryColor(undefined)).toBe('#9aa1b8');
    expect(categoryColor('')).toBe('#9aa1b8');
  });

  it('an override wins over the computed hash color', () => {
    expect(categoryColor('engineering', { engineering: '#abcdef' })).toBe('#abcdef');
  });

  it('is deterministic and returns a valid hex for an arbitrary category', () => {
    const a = categoryColor('some-random-cat');
    const b = categoryColor('some-random-cat');
    expect(a).toBe(b);
    expect(a).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('visibleCategories', () => {
  it('dedupes repeated categories', () => {
    const out = visibleCategories(['x', 'x', 'y']);
    expect(out.filter((c) => c === 'x')).toHaveLength(1);
  });

  it('includes every category present in the data', () => {
    expect(visibleCategories(['zeta-cat'])).toContain('zeta-cat');
  });

  it('orders unknown categories alphabetically (after the seeds)', () => {
    const out = visibleCategories(['zzz-unknown', 'aaa-unknown']);
    expect(out.indexOf('aaa-unknown')).toBeLessThan(out.indexOf('zzz-unknown'));
  });

  it('returns a non-empty, dup-free seed list for empty input', () => {
    const out = visibleCategories([]);
    expect(out.length).toBeGreaterThan(0);
    expect(new Set(out).size).toBe(out.length);
  });
});
