"""[API] integration tests for FR-ADMIN — admin config (idea-file) + lint.

Black-box against the LIVE backend on :8000 in stub-auth mode. Style mirrors
``test_baseline_api.py``. Each test maps to a requirement in
docs/srs/backend-functional.md § FR-ADMIN.

Notes / deliberate non-goals:
* We never wait for the lint LLM/Celery worker to finish. We only assert the
  HTTP contract of POST /api/admin/lint/run (creates a planning report, or 409
  if one is already planning) and the admin-only gates.
* The idea-file is a single shared file on disk; the GET auto-creates it. PUT
  overwrites it. Tests that mutate it use uniquely-marked content so they don't
  assert on a fixed body that a concurrent run might change.
"""
from __future__ import annotations

import uuid

import pytest

# Every admin sub-route except GET /idea-file must reject non-admins with 403.
# (Listed as (method, path) with a harmless body where a body is required.)
ADMIN_ONLY_ROUTES = [
    ("PUT", "/api/admin/idea-file"),
    ("POST", "/api/admin/lint/run"),
    ("GET", "/api/admin/lint/reports"),
    ("GET", "/api/admin/lint/reports/1"),
    ("GET", "/api/admin/lint/reports/1/issues"),
    ("POST", "/api/admin/lint/issues/1/dismiss"),
    ("POST", "/api/admin/lint/issues/1/act"),
    ("GET", "/api/admin/artifacts"),
    ("DELETE", "/api/admin/artifacts/does-not-exist"),
]


def _call(client, method: str, path: str):
    if method == "PUT" and path.endswith("/idea-file"):
        return client.put(path, json={"content": "x"})
    if method == "POST" and path.endswith("/dismiss"):
        return client.post(path, json={"note": "x"})
    return client.request(method, path)


# ── FR-ADMIN-001: idea-file readable by any authed user, can_edit gated ──


def test_FR_ADMIN_001_idea_file_get_contributor_cannot_edit(contributor):
    """FR-ADMIN-001 — any authenticated user can GET the idea-file; a
    contributor sees can_edit=false and the documented shape."""
    r = contributor.get("/api/admin/idea-file")
    assert r.status_code == 200, r.text
    body = r.json()
    for key in ("path", "content", "last_modified", "can_edit"):
        assert key in body, f"missing {key} in {body}"
    assert body["can_edit"] is False
    assert isinstance(body["content"], str) and body["content"]


def test_FR_ADMIN_001_idea_file_get_admin_can_edit(admin):
    """FR-ADMIN-001 — an admin sees can_edit=true on the same GET."""
    r = admin.get("/api/admin/idea-file")
    assert r.status_code == 200, r.text
    assert r.json()["can_edit"] is True


def test_FR_ADMIN_001_idea_file_get_requires_auth(anon):
    """FR-ADMIN-001 — the idea-file read still requires a principal."""
    assert anon.get("/api/admin/idea-file").status_code == 401


# ── FR-ADMIN-002: PUT idea-file admin-only + content changes ─────────────


def test_FR_ADMIN_002_idea_file_put_contributor_403(contributor):
    """FR-ADMIN-002 — a non-admin PUT to the idea-file is rejected (403)."""
    r = contributor.put("/api/admin/idea-file", json={"content": "nope"})
    assert r.status_code == 403, r.text


def test_FR_ADMIN_002_idea_file_put_admin_changes_content(admin):
    """FR-ADMIN-002 — an admin PUT overwrites the playbook; the response and a
    fresh GET both reflect the new content. Uses a unique marker so a parallel
    run can't make this flaky."""
    marker = f"# QA playbook {uuid.uuid4().hex[:12]}\n\nedited by test."
    put = admin.put("/api/admin/idea-file", json={"content": marker})
    assert put.status_code == 200, put.text
    assert put.json()["content"] == marker
    assert put.json()["can_edit"] is True

    got = admin.get("/api/admin/idea-file")
    assert got.status_code == 200
    assert got.json()["content"] == marker


# ── FR-ADMIN-003: lint run is admin-only + planning ⇒ 409 ────────────────


def test_FR_ADMIN_003_lint_run_contributor_403(contributor):
    """FR-ADMIN-003 — POST /api/admin/lint/run is admin-only (contributor
    403)."""
    r = contributor.post("/api/admin/lint/run")
    assert r.status_code == 403, r.text


def test_FR_ADMIN_003_lint_run_admin_creates_or_conflicts(admin):
    """FR-ADMIN-003 — an admin POST either creates a LintReport(planning)
    [200 + status=planning] OR, if one is already in flight, returns 409.

    We do NOT wait for the worker. We fire twice back-to-back: the first call
    must be one of {200, 409}; if the first created a planning report, the
    immediate second call must observe the in-flight one and return 409."""
    first = admin.post("/api/admin/lint/run")
    assert first.status_code in (200, 409), first.text

    if first.status_code == 200:
        rep = first.json()
        assert rep.get("status") == "planning", rep
        assert "id" in rep
        # A planning report now exists → a second run must 409.
        second = admin.post("/api/admin/lint/run")
        assert second.status_code == 409, second.text
    else:
        # Already planning from a prior/concurrent trigger — that's the
        # 409 branch of the contract; nothing more to assert safely.
        assert "running" in first.text.lower() or "planning" in first.text.lower()


def test_FR_ADMIN_004_lint_reports_admin_list(admin):
    """FR-ADMIN-004 — GET /api/admin/lint/reports returns a list for an admin
    (200). We ensure at least one exists by triggering a run first (200 or 409
    both leave a report present)."""
    admin.post("/api/admin/lint/run")  # 200 creates one; 409 means one exists
    r = admin.get("/api/admin/lint/reports")
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)


# ── FR-ADMIN-006: admin artifact list ────────────────────────────────────


def test_FR_ADMIN_006_admin_artifact_list(admin):
    """FR-ADMIN-006 — GET /api/admin/artifacts lists artifacts for an admin
    with the paged envelope {items, limit, offset} and clamps the limit to
    1..500."""
    # Seed one artifact owned by the admin so the list is non-trivial.
    admin.post(
        "/api/artifacts",
        files={"file": ("adm.html", b"<h1>admin list</h1>", "text/html")},
        data={"name": "Admin-list seed"},
    )
    r = admin.get("/api/admin/artifacts", params={"limit": 5})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) >= {"items", "limit", "offset"}, body
    assert isinstance(body["items"], list)
    assert body["limit"] == 5

    # Limit clamps high → 500.
    clamped = admin.get("/api/admin/artifacts", params={"limit": 99999})
    assert clamped.status_code == 200
    assert clamped.json()["limit"] == 500


# ── FR-ADMIN-001..006: blanket non-admin 403 on every /api/admin/* ───────


@pytest.mark.parametrize("method,path", ADMIN_ONLY_ROUTES)
def test_FR_ADMIN_non_admin_forbidden(contributor, method, path):
    """FR-ADMIN — every admin-scoped route (all except GET /idea-file) rejects
    a non-admin with 403, regardless of whether the target id exists."""
    r = _call(contributor, method, path)
    assert r.status_code == 403, f"{method} {path} -> {r.status_code}: {r.text}"


@pytest.mark.parametrize("method,path", ADMIN_ONLY_ROUTES)
def test_FR_ADMIN_anon_unauthorized(anon, method, path):
    """FR-ADMIN — the same routes reject an unauthenticated caller (401)."""
    r = _call(anon, method, path)
    assert r.status_code == 401, f"{method} {path} -> {r.status_code}: {r.text}"


# ── FR-LINT-001/002: in-process lint pass (mocked-LLM) ───────────────────────
#
# The FR-ADMIN tests above cover the HTTP gates + the synchronous "report
# created in planning" contract. These complete the actual lint PASS by driving
# the real run_lint_pass task body in-process against tests/mock_llm: the agent
# reads the wiki snapshot and returns findings via the forced
# submit_lint_findings tool; we persist them read-only (never auto-edits), with
# kind/severity coercion, and move the report planning → done.
from sqlalchemy import select

import app.worker as worker
from app.models import (
    LintIssue, LintIssueKind, LintIssueSeverity, LintReport, LintReportStatus,
)
from tests import mock_llm
from tests._inproc import mock_llm_server, run, session_scope  # noqa: F401
from tests.conftest import uid


def _make_lint_report(trig_uid: int) -> int:
    async def _go():
        async with session_scope() as s:
            rep = LintReport(triggered_by_id=trig_uid, status=LintReportStatus.planning)
            s.add(rep)
            await s.commit()
            return rep.id
    return run(_go())


def test_FR_LINT_001_lint_pass_persists_findings_and_completes(admin, mock_llm_server):
    """FR-LINT-001 — a lint pass reads the wiki snapshot, returns findings via
    the forced submit_lint_findings tool, persists them (read-only — the agent
    never auto-edits), and moves the report planning → done."""
    report_id = _make_lint_report(uid(admin))
    mock_llm.STATE["tool_args"] = {
        "summary": "Mock lint pass.",
        "issues": [
            {"kind": "orphan", "severity": "high", "title": "Orphan page",
             "affected_paths": ["some/page"], "suggested_action": "link it"},
            {"kind": "broken_link", "severity": "low", "title": "Broken wikilink"},
        ],
    }
    worker.run_lint_pass(report_id)

    async def _check():
        async with session_scope() as s:
            rep = await s.get(LintReport, report_id)
            issues = (await s.execute(
                select(LintIssue).where(LintIssue.report_id == report_id)
            )).scalars().all()
            return rep.status, rep.total_issues, rep.summary, len(issues)
    status, total, summary, n = run(_check())

    assert status == LintReportStatus.done, status
    assert total == 2 and n == 2, (total, n)
    assert summary == "Mock lint pass."


def test_FR_LINT_002_issue_kind_and_severity_coercion(admin, mock_llm_server):
    """FR-LINT-002 — unknown issue kinds coerce to `other`, unknown severities to
    `medium`, and missing values default the same way; valid values pass through."""
    report_id = _make_lint_report(uid(admin))
    mock_llm.STATE["tool_args"] = {
        "summary": "Coercion check.",
        "issues": [
            {"kind": "conflict", "severity": "medium", "title": "Valid one"},
            {"kind": "totally_unknown", "severity": "critical", "title": "Coerced one"},
            {"title": "No kind or severity"},  # both missing → other / medium
        ],
    }
    worker.run_lint_pass(report_id)

    async def _check():
        async with session_scope() as s:
            issues = (await s.execute(
                select(LintIssue).where(LintIssue.report_id == report_id)
                .order_by(LintIssue.id)
            )).scalars().all()
            return [(i.kind, i.severity, i.title) for i in issues]
    by_title = {t: (k, sv) for (k, sv, t) in run(_check())}

    assert by_title["Valid one"] == (LintIssueKind.conflict, LintIssueSeverity.medium)
    assert by_title["Coerced one"] == (LintIssueKind.other, LintIssueSeverity.medium)
    assert by_title["No kind or severity"] == (LintIssueKind.other, LintIssueSeverity.medium)
