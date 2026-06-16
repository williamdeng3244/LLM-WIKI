import { describe, it, expect } from 'vitest';

import { compareVersions } from '@/lib/version';

describe('compareVersions', () => {
  it('orders by numeric segments, not lexically (1.2 < 1.10)', () => {
    expect(compareVersions('1.2.0', '1.10.0')).toBeLessThan(0);
    expect(compareVersions('v1.10.0', 'v1.2.0')).toBeGreaterThan(0);
  });

  it('strips the v prefix and treats missing segments as 0', () => {
    expect(compareVersions('v2.0', '2.0.0')).toBe(0);
    expect(compareVersions('v1.1.2', '1.1.2')).toBe(0);
  });

  it('detects patch-level differences', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareVersions('1.0.1', '1.0.0')).toBeGreaterThan(0);
  });
});
