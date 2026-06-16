"""Baseline API vertical — proves the harness across auth, pages, revisions,
bookmarks, search, and the core permission gates. Every test maps to an SRS
requirement id (docs/srs/backend-functional.md). All are expected GREEN against
current behavior; the gap/negative assertions live in test_wave1_gaps.py.
"""
from __future__ import annotations

import httpx

from tests.conftest import (
    BASE_URL,
    publish_page,
    create_draft,
    unique_path,
)


def test_harness_stub_mode_on():
    """Precondition: the backend must be in stub auth mode for this suite."""
    cfg = httpx.get(f"{BASE_URL}/api/auth/config", timeout=10).json()
    assert cfg["mode"] == "stub", f"suite requires AUTH_MODE=stub, got {cfg}"


def test_FR_AUTH_009_whoami_role(admin, reader):
    assert admin.get("/api/auth/whoami").json()["role"] == "admin"
    assert reader.get("/api/auth/whoami").json()["role"] == "reader"


def test_NFR_SEC_001_anonymous_401(anon):
    # whoami requires a principal; no stub headers -> 401.
    assert anon.get("/api/auth/whoami").status_code == 401


def test_FR_PAGE_003_reader_draft_403(reader):
    r = reader.post(
        "/api/pages/draft",
        json={"title": "x", "body": "y", "new_page": {"path": unique_path()}},
    )
    assert r.status_code == 403, r.text


def test_FR_PAGE_004_draft_validation(contributor):
    # neither page_path nor new_page -> 400
    r = contributor.post("/api/pages/draft", json={"title": "x", "body": "y"})
    assert r.status_code == 400, r.text
    # duplicate new-page path -> 409
    p = publish_page(contributor)
    dup = contributor.post(
        "/api/pages/draft",
        json={"title": "x", "body": "y", "new_page": {"path": p["path"]}},
    )
    assert dup.status_code == 409, dup.text


def test_FR_REV_005_open_page_autopublishes(contributor):
    p = publish_page(contributor, stability="open")
    assert p["status"] == "accepted"
    got = contributor.get(f"/api/pages/{p['path']}")
    assert got.status_code == 200
    assert got.json()["current_revision_id"] is not None


def test_FR_PAGE_001_list_published_only(contributor):
    pub = publish_page(contributor)
    create_draft(contributor, new_path=unique_path("draftonly"))
    listing = {row["path"] for row in contributor.get("/api/pages").json()}
    assert pub["path"] in listing
    assert not any(p.startswith("qa/draftonly-") for p in listing)


def test_FR_PAGE_002_draft_only_page_body_empty(contributor):
    # Creating a draft for a NEW page makes the Page row but leaves it unpublished:
    # GET by path returns 200 with empty body + null current_revision_id.
    path = unique_path("hidden")
    create_draft(contributor, new_path=path)
    got = contributor.get(f"/api/pages/{path}")
    assert got.status_code == 200, got.text
    body = got.json()
    assert body["current_revision_id"] is None
    assert body["body"] == ""


def test_FR_PAGE_002_missing_page_404(contributor):
    assert contributor.get(f"/api/pages/{unique_path('nope')}").status_code == 404


def test_FR_REV_003_other_users_draft_403(contributor, make_client):
    other = make_client("contributor")
    d = create_draft(contributor, new_path=unique_path())
    assert contributor.get(f"/api/revisions/{d['id']}").status_code == 200
    assert other.get(f"/api/revisions/{d['id']}").status_code == 403


def test_FR_PAGE_011_delete_admin_only(contributor, admin):
    p = publish_page(contributor)
    assert contributor.delete(f"/api/pages/{p['path']}").status_code == 403
    assert admin.delete(f"/api/pages/{p['path']}").status_code == 204
    assert admin.get(f"/api/pages/{p['path']}").status_code == 404


def test_FR_PAGE_008_lock_admin_only(contributor, admin):
    p = publish_page(contributor)
    assert contributor.post(f"/api/pages/{p['path']}/lock?locked=true").status_code == 403
    r = admin.post(f"/api/pages/{p['path']}/lock?locked=true")
    assert r.status_code == 200, r.text


def test_FR_BMK_002_003_bookmark_idempotent(contributor):
    p = publish_page(contributor)
    a = contributor.post(f"/api/bookmarks/{p['path']}")
    b = contributor.post(f"/api/bookmarks/{p['path']}")
    assert a.status_code == 200 and b.status_code == 200
    assert a.json()["id"] == b.json()["id"]  # no duplicate
    assert contributor.delete(f"/api/bookmarks/{p['path']}").status_code == 204
    assert contributor.delete(f"/api/bookmarks/{p['path']}").status_code == 204


def test_FR_SRCH_001_empty_query_422(contributor):
    assert contributor.get("/api/search", params={"q": ""}).status_code == 422


def test_FR_REV_002_review_queue_low_role_empty(contributor, reader):
    # reader/contributor get an empty queue (200, not 403)
    assert contributor.get("/api/revisions/review-queue").status_code == 200
    assert contributor.get("/api/revisions/review-queue").json() == []
    assert reader.get("/api/revisions/review-queue").json() == []


def test_FR_FLAG_002_anyone_can_flag(reader, contributor):
    p = publish_page(contributor)
    r = reader.post(f"/api/pages/{p['path']}/flags", json={"kind": "outdated", "body": "stale"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "open"
    bad = reader.post(f"/api/pages/{p['path']}/flags", json={"kind": "bogus", "body": "x"})
    assert bad.status_code == 422


def test_FR_API_malformed_db_input_maps_to_400_not_500(admin):
    """Global contract (QA-found): input that slips past schema validation and
    triggers a DB data exception (SQLSTATE 22) — an id beyond int4 range, or a
    null byte (0x00) in a text field — returns 400, never a leaked 500. A
    genuinely missing in-range id still 404s; the handler only catches 22-class."""
    # id outside int4 range → 400 (was an unhandled 500), on any id endpoint
    assert admin.get("/api/revisions/9999999999").status_code == 400
    assert admin.get("/api/raw/9999999999").status_code == 400
    # null byte in a text field → 400 (was 500)
    path = publish_page(admin, stability="open")["path"]
    r = admin.post(f"/api/pages/{path}/comments", json={"body": "x\x00y"})
    assert r.status_code == 400, r.text
    # a genuinely missing (in-range) id still 404s — not over-caught as 400
    assert admin.get("/api/revisions/0").status_code == 404


def test_FR_PAGE_009_backlinks_missing_404_and_empty(admin):
    """FR-PAGE-009: backlinks on a missing page → 404; a page with no inbound
    resolved links → []."""
    assert admin.get("/api/pages/qa/definitely-missing-xyz/backlinks").status_code == 404
    p = publish_page(admin, stability="open")
    r = admin.get(f"/api/pages/{p['path']}/backlinks")
    assert r.status_code == 200 and r.json() == []


def test_FR_RAW_009_pending_drafts_empty_for_fresh_source(contributor):
    """FR-RAW-009: a freshly-uploaded source has no pending agent drafts → []."""
    rs = contributor.post("/api/raw", files={"file": ("s.txt", b"hello", "text/plain")}).json()
    r = contributor.get(f"/api/raw/{rs['id']}/pending-drafts")
    assert r.status_code == 200 and r.json() == []


def test_FR_ADMIN_005_lint_dismiss_act_guards(admin, contributor):
    """FR-ADMIN-005: dismiss/act on a missing issue → 404; a non-admin is
    rejected (403), never a 5xx."""
    assert admin.post("/api/admin/lint/issues/99999999/dismiss", json={}).status_code == 404
    assert admin.post("/api/admin/lint/issues/99999999/act").status_code == 404
    assert contributor.post("/api/admin/lint/issues/1/dismiss", json={}).status_code == 403


def test_FR_PAGE_006_REV_008_draft_privacy_and_review_clears_badge(contributor, admin):
    """FR-PAGE-006: creating a draft sends reviewers NO notification (drafts are
    private). FR-REV-008: submitting then accepting it clears the reviewer's
    `review_requested` badge (no stuck count)."""
    admin.get("/api/search", params={"q": "warm", "k": 1})  # warm embedding model (accept reindexes)
    admin.get("/api/auth/whoami")  # materialize the admin reviewer before the event
    n0 = admin.get("/api/notifications/unread-count").json()["unread"]
    draft = create_draft(contributor, new_path=unique_path("sc"), stability="stable")
    assert admin.get("/api/notifications/unread-count").json()["unread"] == n0, "draft-create must NOT notify"
    assert contributor.post(f"/api/revisions/{draft['id']}/submit").status_code == 200
    assert admin.get("/api/notifications/unread-count").json()["unread"] == n0 + 1, "submit notifies the reviewer"
    assert admin.post(f"/api/revisions/{draft['id']}/review", json={"decision": "accept"}).status_code == 200
    assert admin.get("/api/notifications/unread-count").json()["unread"] == n0, "accept clears review_requested"
