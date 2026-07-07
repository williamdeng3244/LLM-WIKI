import { describe, expect, it } from 'vitest';

import type { Revision } from './api';
import { latestOwnDraft } from './drafts';

function rev(partial: Partial<Revision>): Revision {
  return {
    id: 1, page_id: 1, parent_revision_id: null,
    title: 't', body: 'b', tags: [], status: 'draft',
    author_id: 1, rationale: null, reviewer_id: null,
    review_comment: null, reviewed_at: null, created_at: '2026-07-07T00:00:00Z',
    ...partial,
  } as Revision;
}

describe('latestOwnDraft', () => {
  it('returns the newest draft revision authored by the user', () => {
    const revs = [
      rev({ id: 2, status: 'accepted', author_id: 7 }),
      rev({ id: 5, status: 'draft', author_id: 7 }),
      rev({ id: 9, status: 'draft', author_id: 7, body: 'newer' }),
    ];
    expect(latestOwnDraft(revs, 7)?.id).toBe(9);
  });

  it('suppresses the draft once a newer own revision was submitted (resume → resubmit)', () => {
    const revs = [
      rev({ id: 9, status: 'draft', author_id: 7 }),     // bounced original
      rev({ id: 11, status: 'proposed', author_id: 7 }), // resumed + resubmitted
    ];
    expect(latestOwnDraft(revs, 7)).toBeUndefined();
  });

  it('returns the fresh draft when bounced again after a resubmit', () => {
    const revs = [
      rev({ id: 9, status: 'proposed', author_id: 7 }),  // older cycle
      rev({ id: 11, status: 'draft', author_id: 7 }),    // bounced again
    ];
    expect(latestOwnDraft(revs, 7)?.id).toBe(11);
  });

  it('ignores drafts by other authors', () => {
    const revs = [rev({ id: 3, status: 'draft', author_id: 99 })];
    expect(latestOwnDraft(revs, 7)).toBeUndefined();
  });

  it('ignores non-draft statuses (proposed/accepted/rejected/superseded)', () => {
    const revs = [
      rev({ id: 1, status: 'proposed', author_id: 7 }),
      rev({ id: 2, status: 'accepted', author_id: 7 }),
      rev({ id: 3, status: 'rejected', author_id: 7 }),
      rev({ id: 4, status: 'superseded', author_id: 7 }),
    ];
    expect(latestOwnDraft(revs, 7)).toBeUndefined();
  });

  it('handles empty input and null user', () => {
    expect(latestOwnDraft([], 7)).toBeUndefined();
    expect(latestOwnDraft([rev({ status: 'draft', author_id: 7 })], null)).toBeUndefined();
  });
});
