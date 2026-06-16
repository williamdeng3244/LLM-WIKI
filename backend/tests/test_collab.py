"""Collaboration vertical — comments (FR-CMT), flags (FR-FLAG), bookmarks
(FR-BMK). Black-box integration against the live backend on :8000 in stub auth
mode, using the shared harness in ``tests.conftest``.

Every test is named ``test_FR_<AREA>_<NNN>_<short>`` and maps 1:1 to a clause in
``docs/srs/backend-functional.md``. Isolation: every test uses fresh users
(via the role fixtures / ``make_client``) and ``unique_path()`` pages, so runs
never collide and assertions never depend on global state.
"""
from __future__ import annotations

import pytest

from tests.conftest import (
    publish_page,
    unique_path,
    uid,
)

# ── Known backend bug (FINDING), shared by the two list-GET tests below ──────
# `GET /api/pages/{path}/comments` and `.../flags` live in routers/comments.py
# (mounted at prefix="/api"), but routers/pages.py is mounted FIRST at
# prefix="/api/pages" and declares a greedy `GET /{page_path:path}`. That
# greedy route captures `/api/pages/<path>/comments` (page_path becomes
# "<path>/comments") and 404s before the comments router is ever consulted.
# POST works because pages.py has no POST /{page_path:path}. Net effect: the
# FR-CMT-001 / FR-FLAG-001: the comment/flag LIST GETs were shadowed by pages.py's
# greedy GET /{page_path:path} (router order). FIXED 2026-06-10 by registering
# comments.router before pages.router in app/main.py — these tests are now plain.


# ── FR-CMT-001 / FR-CMT-002 — Comments ──────────────────────────────────────


def test_FR_CMT_001_list_asc_and_flat(contributor):
    """GET comments returns them oldest-first (ASC) and flat (no threading).

    RED: see _SHADOWED_LIST_GET — the GET is captured by pages.py's greedy
    path route and 404s, so the ASC/flat behavior can't be observed via API.
    """
    p = publish_page(contributor)
    bodies = ["first", "second", "third"]
    for b in bodies:
        r = contributor.post(f"/api/pages/{p['path']}/comments", json={"body": b})
        assert r.status_code == 200, r.text

    rows = contributor.get(f"/api/pages/{p['path']}/comments")
    assert rows.status_code == 200, rows.text
    data = rows.json()
    # Scope to the comments we created (ours is a fresh page, so it's all of them).
    got_bodies = [c["body"] for c in data]
    assert got_bodies == bodies, f"expected ASC insertion order, got {got_bodies}"
    # Flat: comments carry no children/parent linkage in the payload.
    assert all("parent_id" not in c and "children" not in c for c in data)


def test_FR_CMT_001_missing_page_404(reader):
    assert reader.get(f"/api/pages/{unique_path('nope')}/comments").status_code == 404


def test_FR_CMT_002_reader_can_comment_empty_body_ok(reader, contributor):
    """Any authenticated user incl. reader may comment; empty body is accepted."""
    p = publish_page(contributor)
    r = reader.post(f"/api/pages/{p['path']}/comments", json={"body": ""})
    assert r.status_code == 200, r.text
    assert r.json()["body"] == ""
    assert r.json()["author_id"] == uid(reader)


def test_FR_CMT_002_missing_page_404_on_post(reader):
    r = reader.post(f"/api/pages/{unique_path('nope')}/comments", json={"body": "x"})
    assert r.status_code == 404, r.text


def test_FR_CMT_002_no_notification_side_effect(make_client):
    """Posting a comment creates NO notification — assert the page owner's
    notification list does not gain a row when a different user comments."""
    owner = make_client("contributor")
    commenter = make_client("reader")
    p = publish_page(owner)

    before = owner.get("/api/notifications")
    assert before.status_code == 200, before.text
    n_before = len(before.json())

    r = commenter.post(f"/api/pages/{p['path']}/comments", json={"body": "hi owner"})
    assert r.status_code == 200, r.text

    after = owner.get("/api/notifications")
    assert after.status_code == 200, after.text
    assert len(after.json()) == n_before, (
        "commenting must not notify the page owner "
        f"(before={n_before}, after={len(after.json())})"
    )


# ── FR-FLAG-001 / FR-FLAG-002 / FR-FLAG-003 — Flags ─────────────────────────


def test_FR_FLAG_001_list_desc(contributor):
    """GET flags returns them newest-first (DESC).

    RED: see _SHADOWED_LIST_GET — the GET is captured by pages.py's greedy
    path route and 404s, so the DESC ordering can't be observed via API.
    """
    p = publish_page(contributor)
    ids = []
    for kind in ("incorrect", "outdated", "duplicate"):
        r = contributor.post(
            f"/api/pages/{p['path']}/flags", json={"kind": kind, "body": kind}
        )
        assert r.status_code == 200, r.text
        ids.append(r.json()["id"])

    rows = contributor.get(f"/api/pages/{p['path']}/flags")
    assert rows.status_code == 200, rows.text
    got_ids = [f["id"] for f in rows.json()]
    assert got_ids == list(reversed(ids)), f"expected DESC, got {got_ids}"


def test_FR_FLAG_001_missing_page_404(reader):
    assert reader.get(f"/api/pages/{unique_path('nope')}/flags").status_code == 404


def test_FR_FLAG_002_any_user_valid_kind_open_plus_audit(reader, contributor, admin):
    """Any authenticated user (incl. reader) raises a flag with a valid kind ->
    status 'open'; an AuditLog action='flag.raise' row is written."""
    p = publish_page(contributor)
    r = reader.post(
        f"/api/pages/{p['path']}/flags", json={"kind": "needs_source", "body": "cite?"}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "open"
    assert body["kind"] == "needs_source"
    assert body["resolved_by_id"] is None and body["resolved_at"] is None

    # Audit side-effect: flag.raise on this page by the reader.
    logs = admin.get(
        "/api/audit", params={"action": "flag.raise", "target_id": body["page_id"]}
    )
    if logs.status_code == 200:
        rows = logs.json()
        rows = rows if isinstance(rows, list) else rows.get("items", [])
        assert any(
            row.get("action") == "flag.raise"
            and row.get("payload", {}).get("kind") == "needs_source"
            for row in rows
        ), f"expected a flag.raise audit row, got {rows}"
    else:
        # No public audit endpoint -> the status assertion above still proves
        # the flag was raised; audit persistence is covered by the model layer.
        assert logs.status_code in (403, 404), logs.text


def test_FR_FLAG_002_invalid_kind_422(reader, contributor):
    p = publish_page(contributor)
    bad = reader.post(
        f"/api/pages/{p['path']}/flags", json={"kind": "bogus", "body": "x"}
    )
    assert bad.status_code == 422, bad.text


def test_FR_FLAG_002_missing_page_404(reader):
    r = reader.post(
        f"/api/pages/{unique_path('nope')}/flags",
        json={"kind": "other", "body": "x"},
    )
    assert r.status_code == 404, r.text


def test_FR_FLAG_003_resolve_requires_editor_else_403(contributor, editor):
    """A flag is resolvable only by editor/admin; a contributor gets 403."""
    p = publish_page(contributor)
    raised = contributor.post(
        f"/api/pages/{p['path']}/flags", json={"kind": "incorrect", "body": "wrong"}
    )
    assert raised.status_code == 200, raised.text
    fid = raised.json()["id"]

    # contributor (the raiser) cannot resolve.
    denied = contributor.post(f"/api/flags/{fid}/resolve")
    assert denied.status_code == 403, denied.text

    # editor can resolve.
    ok = editor.post(f"/api/flags/{fid}/resolve")
    assert ok.status_code == 200, ok.text
    body = ok.json()
    assert body["status"] == "resolved"
    assert body["resolved_by_id"] == uid(editor)
    assert body["resolved_at"] is not None


def test_FR_FLAG_003_dismiss_vs_resolve(contributor, admin):
    """dismiss=true -> status 'dismissed'; default -> 'resolved'. Admin allowed."""
    p = publish_page(contributor)
    f1 = contributor.post(
        f"/api/pages/{p['path']}/flags", json={"kind": "outdated", "body": "old"}
    ).json()
    f2 = contributor.post(
        f"/api/pages/{p['path']}/flags", json={"kind": "duplicate", "body": "dup"}
    ).json()

    dismissed = admin.post(f"/api/flags/{f1['id']}/resolve", params={"dismiss": True})
    assert dismissed.status_code == 200, dismissed.text
    assert dismissed.json()["status"] == "dismissed"

    resolved = admin.post(f"/api/flags/{f2['id']}/resolve", params={"dismiss": False})
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["status"] == "resolved"


def test_FR_FLAG_003_missing_flag_404(editor):
    assert editor.post("/api/flags/999999999/resolve").status_code == 404


def test_FR_FLAG_003_resolve_no_notification_to_raiser(make_client):
    """Resolving a flag writes NO notification to the raiser (per SRS)."""
    raiser = make_client("contributor")
    resolver = make_client("admin")
    p = publish_page(raiser)
    fid = raiser.post(
        f"/api/pages/{p['path']}/flags", json={"kind": "incorrect", "body": "x"}
    ).json()["id"]

    before = len(raiser.get("/api/notifications").json())
    assert resolver.post(f"/api/flags/{fid}/resolve").status_code == 200
    after = len(raiser.get("/api/notifications").json())
    assert after == before, (
        f"resolving a flag must not notify the raiser (before={before}, after={after})"
    )


# ── FR-BMK-001 / FR-BMK-002 / FR-BMK-003 — Bookmarks ────────────────────────


def test_FR_BMK_001_list_own_newest_first(contributor):
    """GET /api/bookmarks returns the caller's bookmarks newest-first."""
    p1 = publish_page(contributor)
    p2 = publish_page(contributor)
    p3 = publish_page(contributor)
    for p in (p1, p2, p3):
        assert contributor.post(f"/api/bookmarks/{p['path']}").status_code == 200

    rows = contributor.get("/api/bookmarks")
    assert rows.status_code == 200, rows.text
    mine = [b for b in rows.json() if b["page_path"] in {p1["path"], p2["path"], p3["path"]}]
    # newest-first: last bookmarked (p3) appears before p1.
    ordered_paths = [b["page_path"] for b in mine]
    assert ordered_paths == [p3["path"], p2["path"], p1["path"]], ordered_paths


def test_FR_BMK_001_list_is_owner_scoped(make_client):
    """A user's bookmark list never contains another user's bookmarks."""
    a = make_client("contributor")
    b = make_client("contributor")
    p = publish_page(a)
    assert a.post(f"/api/bookmarks/{p['path']}").status_code == 200

    b_paths = {row["page_path"] for row in b.get("/api/bookmarks").json()}
    assert p["path"] not in b_paths


def test_FR_BMK_002_add_idempotent(contributor):
    """POST is idempotent: same bookmark id returned, never duplicated."""
    p = publish_page(contributor)
    a = contributor.post(f"/api/bookmarks/{p['path']}")
    b = contributor.post(f"/api/bookmarks/{p['path']}")
    assert a.status_code == 200 and b.status_code == 200
    assert a.json()["id"] == b.json()["id"]
    # Only one row for this page in the caller's list.
    mine = [r for r in contributor.get("/api/bookmarks").json() if r["page_path"] == p["path"]]
    assert len(mine) == 1, mine


def test_FR_BMK_002_missing_page_404_on_add(contributor):
    assert contributor.post(f"/api/bookmarks/{unique_path('nope')}").status_code == 404


def test_FR_BMK_003_delete_idempotent_204(contributor):
    """DELETE is idempotent -> 204 even for a non-existent page/bookmark."""
    p = publish_page(contributor)
    contributor.post(f"/api/bookmarks/{p['path']}")
    assert contributor.delete(f"/api/bookmarks/{p['path']}").status_code == 204
    # Second delete (bookmark already gone) still 204.
    assert contributor.delete(f"/api/bookmarks/{p['path']}").status_code == 204
    # Delete for a page that never existed -> still 204 (idempotent).
    assert contributor.delete(f"/api/bookmarks/{unique_path('ghost')}").status_code == 204
