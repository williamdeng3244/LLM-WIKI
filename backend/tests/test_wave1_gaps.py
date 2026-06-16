"""Wave-1 gap fixes (TDD). Each test asserts the *desired secure* behavior, so
it is RED against the pre-fix code and GREEN after the fix. When a gap is fixed,
its SRS row flips from GAP-* (negative) to a positive FR-* guarantee.
"""
from __future__ import annotations

import pytest

from tests.conftest import publish_page, create_draft, unique_path


def _publish_categorized(client, category: str = "engineering") -> str:
    """Publish an OPEN page assigned to a seeded category. Returns its path."""
    path = unique_path()
    r = client.post(
        "/api/pages/draft",
        json={
            "title": "cat",
            "body": "body",
            "new_page": {"path": path, "category_slug": category, "stability": "open"},
        },
    )
    r.raise_for_status()
    rev = r.json()
    client.post(f"/api/revisions/{rev['id']}/submit").raise_for_status()
    return path


def test_FR_PAGE_007_revisions_hide_other_users_drafts(contributor, make_client):
    """GAP-008 -> fixed: GET /api/pages/{path}/revisions must NOT expose another
    user's DRAFT revisions. The author still sees their own draft; non-draft
    revisions (accepted/superseded/proposed) stay visible to everyone."""
    author = contributor
    other = make_client("contributor")

    p = publish_page(author)  # 1 accepted revision on the page
    draft = create_draft(author, page_path=p["path"])  # author's private draft

    # The author DOES see their own draft in the list.
    author_ids = {r["id"] for r in author.get(f"/api/pages/{p['path']}/revisions").json()}
    assert draft["id"] in author_ids

    # Another user must NOT see the author's draft.
    other_revs = other.get(f"/api/pages/{p['path']}/revisions").json()
    other_ids = {r["id"] for r in other_revs}
    assert draft["id"] not in other_ids, (
        "GAP-008: revisions list leaks another user's draft"
    )

    # ...but the published (accepted/superseded) revision is still visible.
    assert any(r["status"] in ("accepted", "superseded") for r in other_revs)


def test_FR_PAGE_010_move_enforces_editor_category_scope(admin, make_client):
    """GAP-010 -> fixed: an editor NOT in the page's category cannot move it;
    admins can; an editor can still move an UNCATEGORIZED page."""
    editor = make_client("editor")
    cat_path = _publish_categorized(admin)
    if admin.get(f"/api/pages/{cat_path}").json().get("category_id") is None:
        pytest.skip("no seeded 'engineering' category to scope against")

    # out-of-category editor -> 403
    r = editor.patch(f"/api/pages/{cat_path}/path", json={"new_path": unique_path()})
    assert r.status_code == 403, (
        f"GAP-010: out-of-category editor moved a categorized page ({r.status_code})"
    )
    # admin -> 200
    assert admin.patch(
        f"/api/pages/{cat_path}/path", json={"new_path": unique_path()}
    ).status_code == 200
    # editor CAN still move an uncategorized page (no regression)
    unc = publish_page(editor)
    assert editor.patch(
        f"/api/pages/{unc['path']}/path", json={"new_path": unique_path()}
    ).status_code == 200


def test_FR_FLAG_003_resolve_enforces_editor_category_scope(admin, make_client, contributor):
    """GAP-009 -> fixed: an editor NOT in the page's category cannot resolve a
    flag on it; admins can."""
    editor = make_client("editor")
    cat_path = _publish_categorized(admin)
    if admin.get(f"/api/pages/{cat_path}").json().get("category_id") is None:
        pytest.skip("no seeded 'engineering' category to scope against")

    flag = contributor.post(
        f"/api/pages/{cat_path}/flags", json={"kind": "outdated", "body": "x"}
    ).json()
    # out-of-category editor -> 403
    r = editor.post(f"/api/flags/{flag['id']}/resolve")
    assert r.status_code == 403, (
        f"GAP-009: out-of-category editor resolved a flag ({r.status_code})"
    )
    # admin -> 200
    assert admin.post(f"/api/flags/{flag['id']}/resolve").status_code == 200
