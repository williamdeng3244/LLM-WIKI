"""[API] FR-PAGE-* and FR-REV-* — page CRUD/move/path + revision lifecycle.

Black-box against the live backend on :8000 in stub auth mode. Test names map
1:1 to SRS requirement ids (docs/srs/backend-functional.md). Setup that needs a
seed with no public endpoint (e.g. category_editors for editor category-scoping
in FR-REV-002) is split out and skipped with a reason rather than faked.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models import Category, CategoryEditor, Page
from tests._inproc import run, session_scope
from tests.conftest import (
    create_draft,
    email_of,
    publish_page,
    uid,
    unique_path,
)

# ==========================================================================
# FR-PAGE-*
# ==========================================================================


# FR-PAGE-001 — GET /api/pages lists only published pages; draft-only absent.
# (PageSummary intentionally omits current_revision_id, so we verify the
# published-vs-draft guarantee by presence/absence, not by that field.)
def test_FR_PAGE_001_lists_published_only(contributor):
    pub = publish_page(contributor)
    draft_path = unique_path("draftonly")
    create_draft(contributor, new_path=draft_path)  # never submitted -> draft-only
    paths = {r["path"] for r in contributor.get("/api/pages").json()}
    assert pub["path"] in paths, "a published page must be listed"
    assert draft_path not in paths, "a draft-only page must be absent from the list"


# FR-PAGE-001 — "ordered by path". Verified over a controlled set of three paths
# that differ only by a trailing digit (so PG-locale collation and Python sort
# agree) by asserting they appear in ascending order as a SUBSEQUENCE of the
# list. (A whole-list == python-sorted check is flaky against seed data because
# locale collation reorders punctuation like '-' differently from bytewise sort.)
def test_FR_PAGE_001_ordered_by_path(contributor):
    import uuid

    tag = uuid.uuid4().hex[:8]
    created = []
    for i in (3, 1, 2):  # publish out of order
        p = publish_page(contributor, path=f"qa/zzord{tag}p{i}")
        created.append(p["path"])
    all_paths = [r["path"] for r in contributor.get("/api/pages").json()]
    got = [p for p in all_paths if p in set(created)]
    assert got == sorted(created), f"pages must be ordered by path: {got}"


# FR-PAGE-002 — GET /api/pages/{path}: body from current rev; draft-only empty; 404
def test_FR_PAGE_002_published_returns_body(contributor):
    p = publish_page(contributor, body="the real body")
    got = contributor.get(f"/api/pages/{p['path']}")
    assert got.status_code == 200, got.text
    assert got.json()["body"] == "the real body"
    assert got.json()["current_revision_id"] is not None


def test_FR_PAGE_002_draft_only_empty_body(contributor):
    path = unique_path("hidden")
    create_draft(contributor, new_path=path)
    got = contributor.get(f"/api/pages/{path}")
    assert got.status_code == 200, got.text
    assert got.json()["current_revision_id"] is None
    assert got.json()["body"] == ""


def test_FR_PAGE_002_missing_404(contributor):
    assert contributor.get(f"/api/pages/{unique_path('nope')}").status_code == 404


def test_FR_PAGE_002_no_stability_gate_on_read(contributor, reader):
    # A 'stable' published page is readable by a plain reader (no gate on read).
    p = publish_page(contributor, stability="open")
    assert reader.get(f"/api/pages/{p['path']}").status_code == 200


# FR-PAGE-003 — POST /api/pages/draft requires contributor+ (reader 403)
def test_FR_PAGE_003_reader_draft_403(reader):
    r = reader.post(
        "/api/pages/draft",
        json={"title": "x", "body": "y", "new_page": {"path": unique_path()}},
    )
    assert r.status_code == 403, r.text


def test_FR_PAGE_003_contributor_draft_ok(contributor):
    r = contributor.post(
        "/api/pages/draft",
        json={"title": "x", "body": "y", "new_page": {"path": unique_path()}},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "draft"


# FR-PAGE-004 — draft create: missing page_path 404; colliding new_page 409; neither 400
def test_FR_PAGE_004_edit_missing_page_404(contributor):
    r = contributor.post(
        "/api/pages/draft",
        json={"title": "x", "body": "y", "page_path": unique_path("ghost")},
    )
    assert r.status_code == 404, r.text


def test_FR_PAGE_004_new_page_collision_409(contributor):
    p = publish_page(contributor)
    r = contributor.post(
        "/api/pages/draft",
        json={"title": "x", "body": "y", "new_page": {"path": p["path"]}},
    )
    assert r.status_code == 409, r.text


def test_FR_PAGE_004_neither_400(contributor):
    r = contributor.post("/api/pages/draft", json={"title": "x", "body": "y"})
    assert r.status_code == 400, r.text


# FR-PAGE-005 — new-page draft inserts Page (stability from spec, default stable),
# Revision(draft); page NOT published (hidden from list)
def test_FR_PAGE_005_new_page_stays_unpublished(contributor):
    path = unique_path("unpub")
    rev = create_draft(contributor, new_path=path)
    assert rev["status"] == "draft"
    # page exists but is not in the published list
    assert contributor.get(f"/api/pages/{path}").status_code == 200
    listed = {r["path"] for r in contributor.get("/api/pages").json()}
    assert path not in listed


def test_FR_PAGE_005_default_stability_stable(contributor):
    # Default stability is 'stable' -> submit goes to 'proposed' (not auto-publish).
    path = unique_path("defstab")
    rev = create_draft(contributor, new_path=path)  # create_draft default stability=stable
    s = contributor.post(f"/api/revisions/{rev['id']}/submit")
    assert s.status_code == 200, s.text
    assert s.json()["status"] == "proposed", "default stability 'stable' must require review"


# FR-PAGE-007 — GET /api/pages/{path}/revisions: all statuses, newest-first; 404
def test_FR_PAGE_007_revisions_newest_first(contributor):
    p = publish_page(contributor)  # accepted rev
    d = create_draft(contributor, page_path=p["path"])  # draft rev (newer)
    rows = contributor.get(f"/api/pages/{p['path']}/revisions").json()
    ids = [r["id"] for r in rows]
    assert d["id"] in ids and p["revision_id"] in ids
    # newest-first (descending id)
    assert ids == sorted(ids, reverse=True)


def test_FR_PAGE_007_revisions_missing_page_404(contributor):
    assert contributor.get(f"/api/pages/{unique_path('nope')}/revisions").status_code == 404


# FR-PAGE-008 — POST /api/pages/{path}/lock requires admin; unlock lands on 'stable'
def test_FR_PAGE_008_lock_admin_only(contributor, admin):
    p = publish_page(contributor)
    assert contributor.post(f"/api/pages/{p['path']}/lock", params={"locked": "true"}).status_code == 403
    r = admin.post(f"/api/pages/{p['path']}/lock", params={"locked": "true"})
    assert r.status_code == 200, r.text


def test_FR_PAGE_008_unlock_lands_on_stable(contributor, admin):
    # Publish 'open', lock -> locked, unlock -> 'stable' (never restores 'open').
    p = publish_page(contributor, stability="open")
    admin.post(f"/api/pages/{p['path']}/lock", params={"locked": "true"})
    r = admin.post(f"/api/pages/{p['path']}/lock", params={"locked": "false"})
    assert r.status_code == 200, r.text
    assert r.json()["stability"] == "stable"


def test_FR_PAGE_008_lock_missing_404(admin):
    assert admin.post(f"/api/pages/{unique_path('nope')}/lock", params={"locked": "true"}).status_code == 404


# FR-PAGE-010 — PATCH /api/pages/{path}/path: editor/admin; traversal; collision; no-op
def test_FR_PAGE_010_move_requires_editor_or_admin(contributor):
    p = publish_page(contributor)
    r = contributor.patch(f"/api/pages/{p['path']}/path", json={"new_path": unique_path("moved")})
    assert r.status_code == 403, r.text


def test_FR_PAGE_010_move_editor_ok(editor):
    p = publish_page(editor)
    dest = unique_path("moved")
    r = editor.patch(f"/api/pages/{p['path']}/path", json={"new_path": dest})
    assert r.status_code == 200, r.text
    assert r.json()["path"] == dest
    # old path is gone, new path resolves
    assert editor.get(f"/api/pages/{p['path']}").status_code == 404
    assert editor.get(f"/api/pages/{dest}").status_code == 200


def test_FR_PAGE_010_move_empty_new_path_400(editor):
    p = publish_page(editor)
    assert editor.patch(f"/api/pages/{p['path']}/path", json={"new_path": ""}).status_code == 400


def test_FR_PAGE_010_move_traversal_400(editor):
    p = publish_page(editor)
    r = editor.patch(f"/api/pages/{p['path']}/path", json={"new_path": "qa/../etc/passwd"})
    assert r.status_code == 400, r.text


def test_FR_PAGE_010_move_noop_same_path(editor):
    p = publish_page(editor)
    r = editor.patch(f"/api/pages/{p['path']}/path", json={"new_path": p["path"]})
    assert r.status_code == 200, r.text
    assert r.json()["path"] == p["path"]


def test_FR_PAGE_010_move_collision_409(editor):
    a = publish_page(editor)
    b = publish_page(editor)
    r = editor.patch(f"/api/pages/{a['path']}/path", json={"new_path": b["path"]})
    assert r.status_code == 409, r.text


# FR-PAGE-011 — DELETE /api/pages/{path}: admin only; 204; cascade
def test_FR_PAGE_011_delete_admin_only(contributor, admin):
    p = publish_page(contributor)
    assert contributor.delete(f"/api/pages/{p['path']}").status_code == 403
    assert admin.delete(f"/api/pages/{p['path']}").status_code == 204
    assert admin.get(f"/api/pages/{p['path']}").status_code == 404


# FR-PAGE-012 — path resolution is forgiving (±.md) for BOTH get and delete.
# (GET went lenient in v1.2.4 "Fix 8 issues from internal deployment testing",
# 02e1405; this test originally pinned the pre-v1.2.4 exact-GET behaviour and
# had been failing silently since.)
def test_FR_PAGE_012_get_and_delete_forgiving(contributor, admin):
    """A page stored at 'foo.md' resolves under the bare 'foo' for GET and
    DELETE alike via _resolve_page (+/-.md)."""
    base = unique_path("exact")
    stored = base + ".md"
    publish_page(contributor, path=stored)
    # exact GET on the stored path works
    assert contributor.get(f"/api/pages/{stored}").status_code == 200
    # bare path (no .md) resolves on GET too (lenient since v1.2.4)
    assert contributor.get(f"/api/pages/{base}").status_code == 200
    # ...and DELETE on the bare path resolves to 'base.md' -> 204
    assert admin.delete(f"/api/pages/{base}").status_code == 204
    assert contributor.get(f"/api/pages/{stored}").status_code == 404


# FR-PAGE-011b — legacy malformed stored paths (created before
# canonical_page_path existed) must still be deletable. The UI sends the
# Next.js-normalised URL (trailing slash stripped by the 308 redirect,
# duplicate slashes collapsed), so the API sees the *clean* form while the
# DB row holds the messy one.
def test_FR_PAGE_011b_delete_legacy_malformed_paths(admin):
    suffix = uuid.uuid4().hex[:8]
    messy = [
        f"/qa/lead-{suffix}",   # leading slash
        f"qa//dbl-{suffix}",    # duplicate slash
        f"qa/trail-{suffix}/",  # trailing slash
    ]

    async def seed() -> None:
        async with session_scope() as s:
            for p in messy:
                s.add(Page(path=p, title=f"legacy {p}"))
            await s.commit()

    run(seed())
    # What the browser actually sends after URL normalisation:
    assert admin.delete(f"/api/pages/qa/lead-{suffix}").status_code == 204
    assert admin.delete(f"/api/pages/qa/dbl-{suffix}").status_code == 204
    assert admin.delete(f"/api/pages/qa/trail-{suffix}").status_code == 204


# FR-PAGE-011c — DELETE with an empty path must be a clear 400, never a bare
# 405. (A page row with an empty/mangled path made the UI request
# `DELETE /api/pages/`; Next.js 308-redirects that to `/api/pages`, where only
# GET was registered → "405: Method Not Allowed" with no hint of the cause.)
def test_FR_PAGE_011c_delete_empty_path_400(admin):
    r = admin.delete("/api/pages")  # the post-redirect form
    assert r.status_code == 400, r.text
    r = admin.delete("/api/pages/")  # the direct empty-path form
    assert r.status_code == 400, r.text


# FR-PAGE-011d — a row whose path canonicalises to EMPTY ('/', '', '//') is
# unreachable via the path-addressed API: the client refuses to send the
# delete ("page path is empty — malformed page row", QA 7/7) and no URL can
# name it. The boot-time repair renames such rows to recovered/page-<id> so
# they become visible in the tree and deletable normally.
def test_FR_PAGE_011d_boot_repair_renames_empty_paths(admin):
    from app.services.bootstrap import repair_malformed_page_paths

    async def seed() -> int:
        async with session_scope() as s:
            p = Page(path="/", title="幽灵页")
            s.add(p)
            await s.commit()
            return p.id

    pid = run(seed())

    async def repair() -> int:
        async with session_scope() as s:
            return await repair_malformed_page_paths(s)

    assert run(repair()) >= 1, "the '/' row must be repaired"

    recovered = f"recovered/page-{pid}"
    r = admin.get(f"/api/pages/{recovered}")
    assert r.status_code == 200, r.text
    assert admin.delete(f"/api/pages/{recovered}").status_code == 204

    # Idempotent: nothing left to repair for this row.
    assert run(repair()) == 0


# FR-PAGE-012b — legacy ".md twin" rows (same page stored both as 'x' and
# 'x.md', pre-v1.2.3 Bug #19 data): a delete must remove EXACTLY the row the
# URL names. _resolve_page iterated a SET of variants, so deleting 'x.md'
# sometimes removed 'x' instead — the deleted row "stayed" in the tree and
# read as un-deletable duplicates (QA 2026-07-07). Verbatim match wins now.
def test_FR_PAGE_012b_twin_rows_delete_exact_match_first(admin):
    suffix = uuid.uuid4().hex[:8]
    bare = f"qa/twin-{suffix}"
    md = f"{bare}.md"

    async def seed() -> None:
        async with session_scope() as s:
            s.add(Page(path=bare, title="twin bare"))
            s.add(Page(path=md, title="twin md"))
            await s.commit()

    run(seed())

    async def paths() -> set[str]:
        async with session_scope() as s:
            rows = (await s.execute(
                select(Page.path).where(Page.path.in_([bare, md]))
            )).scalars().all()
            return set(rows)

    # Deleting the .md row must remove the .md row — not its bare twin.
    assert admin.delete(f"/api/pages/{md}").status_code == 204
    assert run(paths()) == {bare}, "the bare twin must survive"
    # And the bare row deletes verbatim too.
    assert admin.delete(f"/api/pages/{bare}").status_code == 204
    assert run(paths()) == set()


# FR-PAGE-013 — empty title/body accepted on draft create
def test_FR_PAGE_013_empty_title_body_accepted(contributor):
    r = contributor.post(
        "/api/pages/draft",
        json={"title": "", "body": "", "new_page": {"path": unique_path("empty")}},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "draft"


# ==========================================================================
# FR-REV-*
# ==========================================================================


# FR-REV-001 — GET /api/revisions/my-drafts: caller's drafts, newest-first; others excluded
def test_FR_REV_001_my_drafts_only_mine_newest_first(contributor, make_client):
    other = make_client("contributor")
    d1 = create_draft(contributor, new_path=unique_path("md"))
    d2 = create_draft(contributor, new_path=unique_path("md"))
    other_draft = create_draft(other, new_path=unique_path("md"))
    rows = contributor.get("/api/revisions/my-drafts").json()
    ids = [r["id"] for r in rows]
    assert d1["id"] in ids and d2["id"] in ids
    assert other_draft["id"] not in ids, "my-drafts must not leak another user's drafts"
    # newest-first
    assert ids == sorted(ids, reverse=True)
    # only draft status present
    assert all(r["status"] == "draft" for r in rows)


def test_FR_REV_001_my_drafts_excludes_non_draft(contributor):
    # A submitted-and-accepted (open) revision is 'accepted', not in my-drafts.
    p = publish_page(contributor, stability="open")
    ids = {r["id"] for r in contributor.get("/api/revisions/my-drafts").json()}
    assert p["revision_id"] not in ids


# FR-REV-002 — review-queue role scoping
def test_FR_REV_002_reader_contributor_empty(reader, contributor):
    assert reader.get("/api/revisions/review-queue").status_code == 200
    assert reader.get("/api/revisions/review-queue").json() == []
    assert contributor.get("/api/revisions/review-queue").json() == []


def test_FR_REV_002_admin_sees_all_proposed_oldest_first(admin, contributor):
    # Create two proposed (stable) revisions; admin must see both, oldest-first.
    a = publish_page(contributor, stability="stable")  # publish_page submits -> proposed
    b = publish_page(contributor, stability="stable")
    # publish_page on a 'stable' page leaves the revision 'proposed' (status field reflects it)
    assert a["status"] == "proposed" and b["status"] == "proposed"
    rows = admin.get("/api/revisions/review-queue").json()
    ids = [r["id"] for r in rows]
    assert a["revision_id"] in ids and b["revision_id"] in ids
    # oldest-first: this test's two revisions appear in creation order. (Asserting
    # the WHOLE global queue is sorted is brittle — it accumulates hundreds of
    # proposed revisions across runs and created_at order can diverge from id order.)
    assert ids.index(a["revision_id"]) < ids.index(b["revision_id"])
    assert all(r["status"] == "proposed" for r in rows)


def test_FR_REV_002_editor_sees_uncategorized(editor, contributor):
    # Pages created via the API have no category -> an editor (no category seed)
    # sees uncategorized proposed revisions per the SRS ("in-category + uncategorized").
    p = publish_page(contributor, stability="stable")
    assert p["status"] == "proposed"
    ids = {r["id"] for r in editor.get("/api/revisions/review-queue").json()}
    assert p["revision_id"] in ids


def _propose_in_category(client, category_slug: str) -> int:
    """Create a STABLE page in `category_slug` and submit it. Stable pages enter
    the review queue on submit, so this returns the *proposed* revision id."""
    r = client.post("/api/pages/draft", json={
        "title": "Scoped page", "body": "scoped body", "tags": [],
        "new_page": {
            "path": unique_path("scoped"),
            "category_slug": category_slug,
            "stability": "stable",
        },
    })
    r.raise_for_status()
    rev_id = r.json()["id"]
    s = client.post(f"/api/revisions/{rev_id}/submit")
    s.raise_for_status()
    assert s.json().get("status") == "proposed"
    return rev_id


def test_FR_REV_002_editor_in_category_scoping(contributor, make_client):
    """FR-REV-002 (in-category half): an editor scoped to category A sees
    proposed revisions on A's pages but NOT on a different category B's.

    Both prerequisites the old skip cited — `category_editors` rows and a
    categorized page — are seeded here: the CategoryEditor link via the ORM
    (no public endpoint), the categorized pages via the draft endpoint's
    `category_slug`. This is the positive scoping that the negative-only tests
    (out-of-category → 403) and the uncategorized test don't cover."""
    sfx = uuid.uuid4().hex[:8]
    slug_a, slug_b = f"qa-cat-a-{sfx}", f"qa-cat-b-{sfx}"

    in_cat_editor = make_client("editor")
    editor_uid = uid(in_cat_editor)  # whoami also creates the editor's user row

    async def _seed():
        async with session_scope() as s:
            a = Category(slug=slug_a, name=f"QA Cat A {sfx}")
            b = Category(slug=slug_b, name=f"QA Cat B {sfx}")
            s.add_all([a, b])
            await s.flush()
            # scope the editor to category A ONLY
            s.add(CategoryEditor(category_id=a.id, user_id=editor_uid))
            await s.commit()
    run(_seed())

    rev_a = _propose_in_category(contributor, slug_a)  # in the editor's category
    rev_b = _propose_in_category(contributor, slug_b)  # in a category they don't edit

    queue_ids = {r["id"] for r in in_cat_editor.get("/api/revisions/review-queue").json()}
    assert rev_a in queue_ids, "editor must see proposed revisions in their own category (A)"
    assert rev_b not in queue_ids, "editor must NOT see revisions in a category they don't edit (B)"


# FR-REV-003 — GET /api/revisions/{id}: 404 missing; draft not owned 403; non-draft visible
def test_FR_REV_003_missing_404(contributor):
    assert contributor.get("/api/revisions/999999999").status_code == 404


def test_FR_REV_003_other_users_draft_403(contributor, make_client):
    other = make_client("contributor")
    d = create_draft(contributor, new_path=unique_path())
    assert contributor.get(f"/api/revisions/{d['id']}").status_code == 200
    assert other.get(f"/api/revisions/{d['id']}").status_code == 403


def test_FR_REV_003_non_draft_visible_to_any_user(contributor, make_client):
    other = make_client("reader")
    p = publish_page(contributor, stability="open")  # accepted revision
    # an accepted revision is visible to a different authenticated user
    assert other.get(f"/api/revisions/{p['revision_id']}").status_code == 200


# FR-REV-004 — provenance: agent row; human (no provenance) -> 404
def test_FR_REV_004_human_revision_provenance_404(contributor):
    p = publish_page(contributor, stability="open")
    assert contributor.get(f"/api/revisions/{p['revision_id']}/provenance").status_code == 404


# FR-REV-005 — submit: non-author 403; non-draft 409; open publishes; stable proposes
def test_FR_REV_005_submit_non_author_403(contributor, make_client):
    other = make_client("contributor")
    d = create_draft(contributor, new_path=unique_path(), stability="open")
    assert other.post(f"/api/revisions/{d['id']}/submit").status_code == 403


def test_FR_REV_005_submit_non_draft_409(contributor):
    # Submit an already-accepted (open auto-published) revision again -> 409.
    p = publish_page(contributor, stability="open")
    assert contributor.post(f"/api/revisions/{p['revision_id']}/submit").status_code == 409


def test_FR_REV_005_submit_open_publishes(contributor):
    d = create_draft(contributor, new_path=unique_path(), stability="open")
    r = contributor.post(f"/api/revisions/{d['id']}/submit")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "accepted"


def test_FR_REV_005_submit_stable_proposes(contributor):
    d = create_draft(contributor, new_path=unique_path(), stability="stable")
    r = contributor.post(f"/api/revisions/{d['id']}/submit")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "proposed"


# FR-REV-006 — review: invalid decision 400; can_review fail 403; non-proposed 409
def test_FR_REV_006_invalid_decision_400(admin, contributor):
    p = publish_page(contributor, stability="stable")  # proposed
    r = admin.post(f"/api/revisions/{p['revision_id']}/review", json={"decision": "maybe"})
    assert r.status_code == 400, r.text


def test_FR_REV_006_cannot_review_403(contributor):
    # A contributor fails can_review -> 403 on a proposed revision.
    author = contributor
    p = publish_page(author, stability="stable")
    r = author.post(f"/api/revisions/{p['revision_id']}/review", json={"decision": "accept"})
    assert r.status_code == 403, r.text


def test_FR_REV_006_editor_cannot_review_locked_403(editor, contributor, admin):
    # Locked pages are admin-only review (can_review returns False for editors).
    p = publish_page(contributor, stability="stable")  # proposed
    admin.post(f"/api/pages/{p['path']}/lock", params={"locked": "true"})  # -> locked
    r = editor.post(f"/api/revisions/{p['revision_id']}/review", json={"decision": "accept"})
    assert r.status_code == 403, r.text


def test_FR_REV_006_non_proposed_409(admin, contributor):
    # A draft (not proposed) reviewed -> 409.
    d = create_draft(contributor, new_path=unique_path(), stability="stable")
    r = admin.post(f"/api/revisions/{d['id']}/review", json={"decision": "accept"})
    assert r.status_code == 409, r.text


# FR-REV-007 — reject / request_changes effects
def test_FR_REV_007_reject_sets_rejected(admin, contributor):
    p = publish_page(contributor, stability="stable")  # proposed
    r = admin.post(
        f"/api/revisions/{p['revision_id']}/review",
        json={"decision": "reject", "comment": "no"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "rejected"


def test_FR_REV_007_reject_notifies_author(admin, contributor):
    p = publish_page(contributor, stability="stable")
    admin.post(
        f"/api/revisions/{p['revision_id']}/review",
        json={"decision": "reject", "comment": "stale"},
    )
    kinds = [n["kind"] for n in contributor.get("/api/notifications").json()]
    assert "revision_rejected" in kinds


def test_FR_REV_007_request_changes_bounces_to_draft(admin, contributor):
    p = publish_page(contributor, stability="stable")  # proposed
    r = admin.post(
        f"/api/revisions/{p['revision_id']}/review",
        json={"decision": "request_changes", "comment": "tweak"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "draft"
    # bounced back to the author's drafts
    ids = {x["id"] for x in contributor.get("/api/revisions/my-drafts").json()}
    assert p["revision_id"] in ids


def test_FR_REV_007_request_changes_notifies_author(admin, contributor):
    p = publish_page(contributor, stability="stable")
    admin.post(
        f"/api/revisions/{p['revision_id']}/review",
        json={"decision": "request_changes", "comment": "tweak"},
    )
    kinds = [n["kind"] for n in contributor.get("/api/notifications").json()]
    assert "changes_requested" in kinds


# FR-REV-009 — PUT /api/revisions/{id}: non-author 403; non-draft 409; updates fields
# NOTE: the endpoint takes title/body/tags as QUERY params, not a JSON body.
def test_FR_REV_009_edit_updates_fields(contributor):
    d = create_draft(contributor, new_path=unique_path(), title="old", body="old body")
    r = contributor.put(
        f"/api/revisions/{d['id']}",
        params={"title": "new title", "body": "new body"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["title"] == "new title"
    assert r.json()["body"] == "new body"


def test_FR_REV_009_edit_non_author_403(contributor, make_client):
    other = make_client("contributor")
    d = create_draft(contributor, new_path=unique_path())
    r = other.put(f"/api/revisions/{d['id']}", params={"title": "x", "body": "y"})
    assert r.status_code == 403, r.text


def test_FR_REV_009_edit_non_draft_409(contributor):
    # An accepted (open-published) revision cannot be edited -> 409.
    p = publish_page(contributor, stability="open")
    r = contributor.put(
        f"/api/revisions/{p['revision_id']}", params={"title": "x", "body": "y"}
    )
    assert r.status_code == 409, r.text


# FR-REV-010 — publish side-effects: page body updated + prior superseded
def test_FR_REV_010_publish_updates_page_body(editor, contributor):
    # 1) publish v1 (open) -> page body == v1
    p = publish_page(contributor, stability="open", body="version one")
    assert contributor.get(f"/api/pages/{p['path']}").json()["body"] == "version one"

    # 2) propose v2 on the now-'open' page... open auto-publishes on submit, so
    #    edit + submit publishes v2 directly. Page body must become v2.
    d2 = create_draft(contributor, page_path=p["path"], title="QA Page", body="version two")
    s2 = contributor.post(f"/api/revisions/{d2['id']}/submit")
    assert s2.status_code == 200, s2.text
    assert s2.json()["status"] == "accepted"

    got = contributor.get(f"/api/pages/{p['path']}")
    assert got.json()["body"] == "version two"
    assert got.json()["current_revision_id"] == d2["id"]


def test_FR_REV_010_prior_revision_superseded(admin, contributor):
    # On a 'stable' page: publish v1 (admin accepts), then publish v2; v1 -> superseded.
    p = publish_page(contributor, stability="stable")  # v1 proposed
    acc1 = admin.post(
        f"/api/revisions/{p['revision_id']}/review", json={"decision": "accept"}
    )
    assert acc1.status_code == 200 and acc1.json()["status"] == "accepted"

    d2 = create_draft(contributor, page_path=p["path"], body="v2 body", stability="stable")
    s2 = contributor.post(f"/api/revisions/{d2['id']}/submit")
    assert s2.status_code == 200 and s2.json()["status"] == "proposed"
    acc2 = admin.post(f"/api/revisions/{d2['id']}/review", json={"decision": "accept"})
    assert acc2.status_code == 200 and acc2.json()["status"] == "accepted"

    # v1 is now superseded; v2 is the page's current revision.
    revs = {r["id"]: r["status"] for r in contributor.get(f"/api/pages/{p['path']}/revisions").json()}
    assert revs[p["revision_id"]] == "superseded"
    assert revs[d2["id"]] == "accepted"
    assert contributor.get(f"/api/pages/{p['path']}").json()["current_revision_id"] == d2["id"]


def test_FR_REV_010_publish_notifies_author_when_reviewer_differs(admin, contributor):
    # reviewer (admin) != author (contributor) -> author gets revision_accepted.
    p = publish_page(contributor, stability="stable")
    admin.post(f"/api/revisions/{p['revision_id']}/review", json={"decision": "accept"})
    kinds = [n["kind"] for n in contributor.get("/api/notifications").json()]
    assert "revision_accepted" in kinds
