import { describe, it, expect } from 'vitest';

import { matchesCombo, eventToCombo, formatCombo } from '@/lib/hotkeys';

function key(opts: KeyboardEventInit & { key: string }): KeyboardEvent {
  return new KeyboardEvent('keydown', opts);
}

describe('matchesCombo', () => {
  it('treats mod as meta OR ctrl (cross-platform)', () => {
    expect(matchesCombo(key({ key: 'k', metaKey: true }), 'mod+k')).toBe(true);
    expect(matchesCombo(key({ key: 'k', ctrlKey: true }), 'mod+k')).toBe(true);
  });

  it('requires the modifier to be held', () => {
    expect(matchesCombo(key({ key: 'k' }), 'mod+k')).toBe(false);
  });

  it('respects shift exactly', () => {
    expect(matchesCombo(key({ key: 'k', metaKey: true, shiftKey: true }), 'mod+shift+k')).toBe(true);
    expect(matchesCombo(key({ key: 'k', metaKey: true }), 'mod+shift+k')).toBe(false);
  });

  it('an empty combo never matches', () => {
    expect(matchesCombo(key({ key: 'k', metaKey: true }), '')).toBe(false);
  });
});

describe('eventToCombo', () => {
  it('returns null while only a modifier is held (binding incomplete)', () => {
    expect(eventToCombo(key({ key: 'Shift', shiftKey: true }))).toBeNull();
  });

  it('captures the full combo in mod+shift+key order', () => {
    expect(eventToCombo(key({ key: 'k', metaKey: true, shiftKey: true }))).toBe('mod+shift+k');
  });
});

describe('formatCombo', () => {
  it('uppercases the key and shows a modifier glyph', () => {
    const out = formatCombo('mod+k');
    expect(out).toMatch(/⌘|Ctrl/);
    expect(out).toContain('K');
  });
});
