import { describe, it, expect } from 'vitest';

import { blockText, HELP_SECTIONS } from '@/lib/help';

describe('blockText', () => {
  it('selects en vs zh for paragraph/heading blocks', () => {
    const p = { kind: 'p', en: 'Hello', zh: '你好' } as const;
    expect(blockText(p, 'en')).toBe('Hello');
    expect(blockText(p, 'zh')).toBe('你好');
  });

  it('returns the bullet array for ul blocks', () => {
    const ul = { kind: 'ul', en: ['a', 'b'], zh: ['甲', '乙'] } as const;
    expect(blockText(ul, 'zh')).toEqual(['甲', '乙']);
    expect(blockText(ul, 'en')).toEqual(['a', 'b']);
  });
});

describe('HELP_SECTIONS bilingual consistency', () => {
  it('every block carries both languages; ul bullets stay parallel', () => {
    for (const s of HELP_SECTIONS) {
      for (const b of s.blocks) {
        if (b.kind === 'ul') {
          expect(b.en.length, `ul mismatch in ${s.id}`).toBe(b.zh.length);
        } else {
          expect(typeof b.en).toBe('string');
          expect(typeof b.zh).toBe('string');
        }
      }
    }
  });
});
