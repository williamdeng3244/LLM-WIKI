"""[API] Admin-only controls that test_admin_lint.py doesn't reach.

Covers the irreversible artifact **hard-delete** (row + every version's blob),
the admin all-artifacts listing's `include_deleted=false` branch, and the
single-report / per-report-issues reads. The lint *run* itself needs the LLM,
so this targets the read/delete sides that don't.
"""
from __future__ import annotations


def test_admin_hard_delete_artifact_and_idempotent(make_client, admin):
    owner = make_client("editor")
    sid = owner.post(
        "/api/artifacts",
        files={"file": ("h.html", b"<h1>del</h1>", "text/html")},
        data={"name": "to hard-delete"},
    ).json()["short_id"]
    # admin hard-deletes (row + blobs) → 204
    assert admin.delete(f"/api/admin/artifacts/{sid}").status_code == 204
    # gone for everyone (viewer 404s)
    assert owner.get(f"/a/{sid}").status_code == 404
    # idempotent — deleting an already-gone artifact still 204
    assert admin.delete(f"/api/admin/artifacts/{sid}").status_code == 204


def test_admin_hard_delete_forbidden_for_non_admin(make_client):
    editor = make_client("editor")
    sid = editor.post(
        "/api/artifacts",
        files={"file": ("h.html", b"<h1>x</h1>", "text/html")},
        data={"name": "guard"},
    ).json()["short_id"]
    assert editor.delete(f"/api/admin/artifacts/{sid}").status_code == 403


def test_admin_list_artifacts_excluding_deleted(admin, make_client):
    owner = make_client("editor")
    owner.post(
        "/api/artifacts",
        files={"file": ("h.html", b"<h1>x</h1>", "text/html")},
        data={"name": "listed"},
    )
    r = admin.get("/api/admin/artifacts?include_deleted=false&limit=500")
    assert r.status_code == 200
    body = r.json()
    assert "items" in body and body["limit"] == 500


def test_admin_list_artifacts_forbidden_for_non_admin(make_client):
    assert make_client("editor").get("/api/admin/artifacts").status_code == 403


def test_get_lint_report_404(admin):
    assert admin.get("/api/admin/lint/reports/99999999").status_code == 404


def test_list_lint_issues_for_unknown_report_is_empty(admin):
    r = admin.get("/api/admin/lint/reports/99999999/issues")
    assert r.status_code == 200
    assert r.json() == []


def test_lint_report_endpoints_forbidden_for_non_admin(make_client):
    ed = make_client("editor")
    assert ed.get("/api/admin/lint/reports/1").status_code == 403
    assert ed.get("/api/admin/lint/reports/1/issues").status_code == 403
