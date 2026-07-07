import { describe, expect, it } from 'vitest';

import type { PageSummary } from '@/lib/api';
import { buildTree } from './FileTree';

function page(path: string, title: string): PageSummary {
  return {
    id: 1, path, title, category_id: null,
    stability: 'stable', status: 'active', tags: [],
  } as PageSummary;
}

describe('buildTree — page path colliding with a folder name', () => {
  it('renders BOTH the leaf page and the folder subtree (nothing swallowed)', () => {
    // Legacy servers hold a page stored at 'Enflame' next to real
    // 'Enflame/*' pages. Descending into the identically-named LEAF used
    // to swallow the whole subtree: rows showed in the quick switcher but
    // never in the tree (QA 2026-07-07).
    const root = buildTree(
      [page('Enflame', 'ferry_test'), page('Enflame/child', '被吞的孩子')],
      'asc', [],
    );

    const leaf = root.children.find((c) => c.isFile && c.pagePath === 'Enflame');
    expect(leaf?.name).toBe('ferry_test');

    const folder = root.children.find((c) => !c.isFile && c.path === 'Enflame');
    expect(folder, 'a parallel folder node must exist').toBeTruthy();
    const child = folder!.children.find((c) => c.isFile && c.pagePath === 'Enflame/child');
    expect(child?.name).toBe('被吞的孩子');
  });

  it('order of insertion does not matter (folder first, then leaf)', () => {
    const root = buildTree(
      [page('Enflame/child', '孩子'), page('Enflame', 'ferry_test')],
      'asc', [],
    );
    expect(root.children.filter((c) => c.path === 'Enflame')).toHaveLength(2);
    const folder = root.children.find((c) => !c.isFile && c.path === 'Enflame');
    expect(folder!.children.some((c) => c.pagePath === 'Enflame/child')).toBe(true);
  });

  it('normal nesting still builds a single folder chain', () => {
    const root = buildTree(
      [page('a/b/c', 'C'), page('a/b/d', 'D')],
      'asc', [],
    );
    expect(root.children).toHaveLength(1);
    const a = root.children[0];
    expect(a.isFile).toBe(false);
    const b = a.children[0];
    expect(b.children.map((c) => c.name).sort()).toEqual(['C', 'D']);
  });
});
