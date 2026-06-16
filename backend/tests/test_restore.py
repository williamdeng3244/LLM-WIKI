"""Restore an older published version — GAP-002 / GAP-004 (FR-REV-011).

POST /api/revisions/{id}/restore recreates a published revision's content as a
fresh edit and runs it through the normal workflow. Option A semantics: it
honours the page's trust dial, so an open page republishes immediately and a
stable page enters the review queue. Only published versions are restorable,
and readers can't restore at all.
"""
from __future__ import annotations

from tests.conftest import create_draft, publish_page, unique_path


def _two_version_open_page(client) -> tuple[str, int, int]:
    """Publish an open page with two accepted versions. Returns
    (path, rev1_id (v1, now superseded), rev2_id (v2, current))."""
    path = unique_path("restore")
    seed = publish_page(client, path=path, title="v1", body="v1 body", stability="open")
    rev1 = seed["revision_id"]
    draft = create_draft(client, page_path=path, title="v2", body="v2 body")
    sub = client.post(f"/api/revisions/{draft['id']}/submit")
    sub.raise_for_status()
    rev2 = draft["id"]
    return path, rev1, rev2


def test_FR_REV_011_restore_open_page_republishes_immediately(admin):
    path, rev1, rev2 = _two_version_open_page(admin)
    # Sanity: the page currently shows v2.
    assert admin.get(f"/api/pages/{path}").json()["body"] == "v2 body"

    r = admin.post(f"/api/revisions/{rev1}/restore")
    assert r.status_code == 200, r.text
    restored = r.json()
    # Open page -> the restore went live as a brand-new accepted revision.
    assert restored["status"] == "accepted"
    assert restored["id"] not in (rev1, rev2)
    assert restored["body"] == "v1 body"

    # The page now serves v1's content again.
    assert admin.get(f"/api/pages/{path}").json()["body"] == "v1 body"


def test_FR_REV_011_restore_stable_page_enters_review(admin):
    path, rev1, rev2 = _two_version_open_page(admin)
    # Flip the page to stable so edits must be reviewed (lock?locked=false).
    admin.post(f"/api/pages/{path}/lock", params={"locked": False}).raise_for_status()

    r = admin.post(f"/api/revisions/{rev1}/restore")
    assert r.status_code == 200, r.text
    restored = r.json()
    # Stable page -> queued, not published. Even an admin's restore waits.
    assert restored["status"] == "proposed"
    # The live page is untouched until someone reviews it.
    assert admin.get(f"/api/pages/{path}").json()["body"] == "v2 body"
    # ...and it shows up in the review queue.
    queue = admin.get("/api/revisions/review-queue").json()
    assert restored["id"] in [rev["id"] for rev in queue]


def test_FR_REV_011_reader_cannot_restore(admin, reader):
    path, rev1, _rev2 = _two_version_open_page(admin)
    r = reader.post(f"/api/revisions/{rev1}/restore")
    assert r.status_code == 403, r.text


def test_FR_REV_011_cannot_restore_a_draft(admin):
    # A never-submitted draft is not a published version.
    draft = create_draft(admin, new_path=unique_path("restore-draft"), body="wip")
    assert draft["status"] == "draft"
    r = admin.post(f"/api/revisions/{draft['id']}/restore")
    assert r.status_code == 400, r.text


def test_FR_REV_011_restore_unknown_revision_404(admin):
    r = admin.post("/api/revisions/99999999/restore")
    assert r.status_code == 404, r.text
