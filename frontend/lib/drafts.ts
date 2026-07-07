import type { Revision } from './api';

/** The newest revision on a page that is (a) still in `draft` status and
 *  (b) authored by the given user.
 *
 *  This is the "bounced" draft case: a reviewer clicked request-changes, the
 *  revision fell back from `proposed` to `draft` (content intact), and the
 *  author needs a way back into it — the page body itself only shows the
 *  *published* revision, which for a never-accepted proposal is empty
 *  (the "正文都没了，只剩标题" report, QA 2026-07-07). */
export function latestOwnDraft(
  revisions: readonly Revision[],
  userId: number | null | undefined,
): Revision | undefined {
  if (userId == null) return undefined;
  // Only the user's NEWEST revision counts: once they resume the draft and
  // resubmit, a newer `proposed` revision exists and the banner must go
  // away (the bounced original stays `draft` forever — create_draft never
  // supersedes drafts). If the reviewer bounces the resubmit too, the
  // newest own revision is a draft again and the banner returns with the
  // freshest content.
  const newestOwn = revisions
    .filter((r) => r.author_id === userId)
    .sort((a, b) => b.id - a.id)[0];
  return newestOwn?.status === 'draft' ? newestOwn : undefined;
}
