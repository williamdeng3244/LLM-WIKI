"""[API] integration tests for FR-NOTIF — user notifications.

Black-box against the LIVE backend on :8000 in stub-auth mode, mirroring the
style of ``test_artifacts.py`` / ``test_baseline_api.py``. Each test is named
after the SRS requirement it covers (docs/srs/backend-functional.md § FR-NOTIF).

The real event path exercised here: a contributor creates a NEW page draft with
stability 'stable' (so it does NOT auto-publish), then submits it. Submission
flips the revision to ``proposed`` and ``workflow._notify_reviewers`` inserts a
``review_requested`` Notification for every reviewer (admins, since the page has
no category). We then assert the admin actually receives + can manage it.
"""
from __future__ import annotations

import httpx

from tests.conftest import create_draft, unique_path, uid


def _submit(client: httpx.Client, revision_id: int) -> httpx.Response:
    return client.post(f"/api/revisions/{revision_id}/submit")


def _materialize(client: httpx.Client) -> int:
    """Force the stub user row to exist NOW.

    Reviewer notifications are addressed to admin User rows that exist at
    submit time (``workflow._notify_reviewers`` selects existing admins).
    Stub users are created lazily on first request, so a brand-new ``admin``
    fixture that hasn't made a call yet won't be a notification target. Touch
    whoami first so the row exists before the contributor submits. (In the
    real product, reviewers always pre-exist — this only matters for the
    fresh-per-test isolation the harness gives us.)"""
    return uid(client)


def test_FR_NOTIF_004_review_requested_created_on_submit(contributor, admin):
    """FR-NOTIF-004 — submitting a draft on a STABLE page creates a real
    `review_requested` notification addressed to the reviewer (admin).

    Baseline the admin's unread count first, then submit, then assert exactly
    one new unread row whose kind is 'review_requested' and whose link points
    at the proposed revision (/review/<id>)."""
    # Snapshot admin's unread set BEFORE we generate the event (isolation:
    # other concurrent tests may also notify admins, so compare by id-delta).
    before = admin.get("/api/notifications", params={"only_unread": "true"})
    assert before.status_code == 200, before.text
    before_ids = {n["id"] for n in before.json()}

    # Contributor proposes a brand-new STABLE page → goes to review (proposed).
    draft = create_draft(contributor, new_path=unique_path("notif"), stability="stable")
    sub = _submit(contributor, draft["id"])
    assert sub.status_code == 200, sub.text
    assert sub.json()["status"] == "proposed", sub.json()

    after = admin.get("/api/notifications", params={"only_unread": "true"})
    assert after.status_code == 200, after.text
    new_rows = [n for n in after.json() if n["id"] not in before_ids]

    # The admin gained at least one unread row, and the one for THIS revision
    # is a review_requested pointing at /review/<revision_id>.
    assert new_rows, "admin gained no unread notification after a stable-page submit"
    mine = [n for n in new_rows if n.get("link") == f"/review/{draft['id']}"]
    assert mine, f"no review_requested for /review/{draft['id']} in {new_rows}"
    assert mine[0]["kind"] == "review_requested", mine[0]
    assert mine[0]["is_read"] is False


def test_FR_NOTIF_001_list_newest_first_and_shape(contributor, admin):
    """FR-NOTIF-001 — GET /api/notifications returns the caller's rows
    newest-first with the documented shape (id, kind, body, link, is_read,
    created_at)."""
    _materialize(admin)  # reviewer must exist before the event fires
    d1 = create_draft(contributor, new_path=unique_path("notif1"), stability="stable")
    assert _submit(contributor, d1["id"]).status_code == 200
    d2 = create_draft(contributor, new_path=unique_path("notif2"), stability="stable")
    assert _submit(contributor, d2["id"]).status_code == 200

    r = admin.get("/api/notifications")
    assert r.status_code == 200, r.text
    rows = r.json()
    assert isinstance(rows, list) and rows, "admin should have notifications"
    for key in ("id", "kind", "body", "link", "is_read", "created_at"):
        assert key in rows[0], f"missing {key} in {rows[0]}"
    # Newest-first ordering by created_at (desc).
    stamps = [row["created_at"] for row in rows]
    assert stamps == sorted(stamps, reverse=True), "not newest-first"


def test_FR_NOTIF_001_only_unread_filter(contributor, admin):
    """FR-NOTIF-001 — only_unread=true returns a subset of the full list and
    every returned row is unread (the spec derives the bell badge from this
    length, since there is no count endpoint)."""
    _materialize(admin)  # reviewer must exist before the event fires
    d = create_draft(contributor, new_path=unique_path("notifu"), stability="stable")
    assert _submit(contributor, d["id"]).status_code == 200

    unread = admin.get("/api/notifications", params={"only_unread": "true"})
    assert unread.status_code == 200, unread.text
    rows = unread.json()
    assert rows, "expected at least one unread row"
    assert all(row["is_read"] is False for row in rows), rows


def test_FR_NOTIF_002_read_not_owned_404(contributor, admin, reader):
    """FR-NOTIF-002 — POST /{id}/read for a notification you don't own → 404
    (existence not leaked to a non-owner). The reader owns no notifications,
    so the admin's review_requested id is 'not found' for them."""
    _materialize(admin)  # reviewer must exist before the event fires
    d = create_draft(contributor, new_path=unique_path("notif404"), stability="stable")
    assert _submit(contributor, d["id"]).status_code == 200

    # Grab the admin's row for this revision.
    rows = admin.get("/api/notifications", params={"only_unread": "true"}).json()
    target = next(n for n in rows if n.get("link") == f"/review/{d['id']}")
    nid = target["id"]

    # A different user (reader) cannot mark the admin's notification read.
    not_owner = reader.post(f"/api/notifications/{nid}/read")
    assert not_owner.status_code == 404, not_owner.text

    # The real owner can.
    owner = admin.post(f"/api/notifications/{nid}/read")
    assert owner.status_code == 200, owner.text
    assert owner.json() == {"ok": True}

    # And it is now read (drops out of only_unread).
    still_unread = admin.get("/api/notifications", params={"only_unread": "true"}).json()
    assert nid not in {n["id"] for n in still_unread}


def test_FR_NOTIF_002_read_missing_404(admin):
    """FR-NOTIF-002 — POST /{id}/read for a non-existent id → 404."""
    r = admin.post("/api/notifications/2000000001/read")
    assert r.status_code == 404, r.text


def test_FR_NOTIF_003_read_all_clears_unread(contributor, admin):
    """FR-NOTIF-003 — POST /api/notifications/read-all marks ALL of the
    caller's unread rows read; the subsequent only_unread list is empty."""
    _materialize(admin)  # reviewer must exist before the events fire
    # Generate a couple of fresh unread notifications for this admin.
    for i in range(2):
        d = create_draft(contributor, new_path=unique_path(f"notifall{i}"), stability="stable")
        assert _submit(contributor, d["id"]).status_code == 200

    pre = admin.get("/api/notifications", params={"only_unread": "true"}).json()
    assert pre, "precondition: admin must have unread rows to clear"

    r = admin.post("/api/notifications/read-all")
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True}

    post = admin.get("/api/notifications", params={"only_unread": "true"}).json()
    assert post == [], f"read-all left unread rows behind: {post}"


def test_FR_NOTIF_005_unread_count_endpoint(contributor, admin):
    """FR-NOTIF-005 (GAP-005) — GET /api/notifications/unread-count returns the
    caller's exact unread count, agrees with the only_unread list length, and
    tracks mark-all-read down to zero."""
    _materialize(admin)  # reviewer must exist before the events fire

    def count(client) -> int:
        r = client.get("/api/notifications/unread-count")
        assert r.status_code == 200, r.text
        body = r.json()
        assert set(body) == {"unread"} and isinstance(body["unread"], int), body
        return body["unread"]

    before = count(admin)
    for i in range(2):
        d = create_draft(contributor, new_path=unique_path(f"notifc{i}"), stability="stable")
        assert _submit(contributor, d["id"]).status_code == 200

    after = count(admin)
    assert after == before + 2, (before, after)
    # Agrees with the only_unread list length.
    unread_rows = admin.get("/api/notifications", params={"only_unread": "true"}).json()
    assert after == len(unread_rows), (after, unread_rows)

    # Mark everything read → count drops to zero.
    assert admin.post("/api/notifications/read-all").status_code == 200
    assert count(admin) == 0


def test_FR_NOTIF_005_unread_count_per_user(contributor, admin, reader):
    """FR-NOTIF-005 — the count is scoped to the caller: a fresh reader who is
    no one's reviewer sees 0 even while the admin has unread rows."""
    _materialize(admin)
    d = create_draft(contributor, new_path=unique_path("notifciso"), stability="stable")
    assert _submit(contributor, d["id"]).status_code == 200

    assert admin.get("/api/notifications/unread-count").json()["unread"] >= 1
    assert reader.get("/api/notifications/unread-count").json()["unread"] == 0


def test_FR_NOTIF_005_unread_count_requires_auth(anon):
    """FR-NOTIF-005 — the count endpoint requires a principal (anon → 401)."""
    assert anon.get("/api/notifications/unread-count").status_code == 401


def test_FR_NOTIF_001_requires_auth(anon):
    """FR-NOTIF — the notifications list requires a principal (anon → 401)."""
    assert anon.get("/api/notifications").status_code == 401


def test_FR_NOTIF_isolation_per_user(contributor, admin, reader):
    """FR-NOTIF-001 — notifications are per-user: the review_requested raised
    for the admin is NOT visible to an unrelated reader."""
    _materialize(admin)  # reviewer must exist before the event fires
    d = create_draft(contributor, new_path=unique_path("notifiso"), stability="stable")
    assert _submit(contributor, d["id"]).status_code == 200

    admin_links = {n.get("link") for n in admin.get("/api/notifications").json()}
    assert f"/review/{d['id']}" in admin_links

    reader_links = {n.get("link") for n in reader.get("/api/notifications").json()}
    assert f"/review/{d['id']}" not in reader_links
    # Sanity: the reader (a brand-new user) sees none of the contributor's events.
    assert uid(reader) != uid(admin)
