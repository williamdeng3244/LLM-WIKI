# Permission model — detailed reference

This is the source of truth for who can do what. The implementation lives in `backend/app/core/permissions.py`. If the code and this document disagree, fix the document.

## The four roles

| Role        | Default for          | Notes                                      |
|-------------|----------------------|--------------------------------------------|
| reader      | external contractors | Read published pages only                  |
| contributor | every employee       | Read + draft + comment + flag              |
| editor      | senior ICs           | Contributor + review in assigned categories|
| admin       | wiki team            | Editor for all + lock + manage roles       |

Roles are stored in the `role` enum on `users`. Higher roles inherit lower-role abilities. The numeric ranking lives in `models.user.ROLE_RANK`.

## Stability levels per page

Each page carries a `stability` field controlling who can publish to it:

| Stability | Behavior on `submit_for_review`                                    |
|-----------|--------------------------------------------------------------------|
| open      | Auto-publishes immediately. Used for low-stakes brainstorming.     |
| stable    | Goes to the review queue. Editors-in-category can publish. Default.|
| locked    | Goes to the review queue. **Only admins** can publish.             |

Only admins can change a page's stability. The transition is logged to `audit_log`.

## Editor scoping

A user with `role=editor` is **not** automatically empowered to review every page. Their reviewing scope is defined by rows in `category_editors`:

- One row per (category, user) pair
- A user can edit multiple categories
- A user with `role=editor` but zero `category_editors` rows can only review **uncategorized** pages

Admins always pass the `is_editor_for_page` check regardless of `category_editors`.

## Worked examples

### "Alice is editor for engineering. What can she do?"

- Read all published pages: ✓
- Draft a page in any category: ✓
- Comment on any page: ✓
- Review a proposed edit on `engineering/authentication`: ✓ (in scope, stability=stable)
- Review a proposed edit on `product/roadmap`: ✗ (out of scope)
- Review a proposed edit on `engineering/payment-keys` if `stability=locked`: ✗ (admin only)
- Lock a page: ✗ (admin only)
- Promote Bob to editor: ✗ (admin only)

### "Bob is a contributor. He proposes an edit to a page with stability=open."

1. Bob writes the draft in the editor
2. Bob clicks Submit
3. The system sees `page.stability == open` and bypasses the review queue
4. The revision is marked `accepted`, the page's `current_revision_id` is updated
5. The new content is written to disk and indexed
6. Bob receives no notification (he made the change)

### "Carol is an editor and creates an agent."

1. Carol opens the Agents modal, types "research helper", clicks Create
2. The system creates a `User` row: `is_agent=True, owner_id=Carol.id, role=contributor`
3. The system creates an `ApiToken` and shows Carol the raw token once
4. Carol copies it into Claude Code
5. Claude Code calls `POST /api/chat` with `Authorization: Bearer wt_...`
6. The agent's identity is the agent user, not Carol — but it inherits Carol's relationship to the wiki

Note: even though Carol is an editor, **the agent defaults to contributor**. This is intentional: an agent shouldn't be able to silently approve changes on Carol's behalf. Admins can promote a specific agent to editor explicitly if needed.

## What gets audited

Every state-changing action writes an `audit_log` row:

- `revision.create_draft`, `revision.propose`, `revision.publish`, `revision.reject`, `revision.request_changes`
- `page.create_proposal`, `page.lock`, `page.unlock`
- `user.role_change`, `user.deactivate`
- `agent.create`, `agent.delete`
- `flag.raise`

The log is append-only. Admins can query it to answer "who published this and when?"

## Anti-patterns to avoid

- **Don't bypass `submit_for_review`**: never directly set `revision.status = accepted` outside the workflow. The publish path also writes to disk and reindexes — skipping it leaves the system inconsistent.
- **Don't query chunks for unpublished pages**: the indexer only writes chunks for published pages, but if you're tempted to "preview" a draft via vector search, route through a separate code path that scopes to author identity.
- **Don't promote agents to admin**: agents should never have admin-level powers. The role-change endpoint will accept it, but it's a footgun. Future versions should reject this at the API level.
