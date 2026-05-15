"""Lint pass: read entire wiki + agents.md playbook, ask Claude for findings.

The lint pipeline is **read-only**. Claude returns a structured list of
issues (orphans, broken wikilinks, contradictions, stale claims, source
drift, other). We persist them as `LintIssue` rows under a single
`LintReport`. Reviewers act on issues by clicking through to Suggest-edit
or by dismissing them — the agent never auto-edits.

Mirrors the ingest service's shape (forced tool use, retrieval helper,
sync wrapper for Celery) so the same instincts apply.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import (
    AuditLog, LintIssue, LintIssueKind, LintIssueSeverity,
    LintIssueStatus, LintReport, LintReportStatus,
    Link, Page, Revision, User,
)
from app.services.llm_client import active_model, tool_call as llm_tool_call

log = logging.getLogger(__name__)

LINT_TOOL_NAME = "submit_lint_findings"

LINT_TOOL_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["summary", "issues"],
    "properties": {
        "summary": {
            "type": "string",
            "description": "One-sentence summary of the lint pass results.",
        },
        "issues": {
            "type": "array",
            "maxItems": 100,
            "items": {
                "type": "object",
                "required": ["kind", "title"],
                "properties": {
                    "kind": {
                        "type": "string",
                        "enum": ["orphan", "broken_link", "conflict", "stale", "source_drift", "other"],
                    },
                    "severity": {
                        "type": "string",
                        "enum": ["low", "medium", "high"],
                    },
                    "title": {
                        "type": "string",
                        "description": "Short, scannable issue summary (≤100 chars).",
                    },
                    "description": {
                        "type": "string",
                        "description": "Detailed reasoning. Cite specific text from affected pages.",
                    },
                    "affected_paths": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Wiki page paths involved in this issue.",
                    },
                    "suggested_action": {
                        "type": "string",
                        "description": "Recommended human action; agent does not auto-apply.",
                    },
                },
            },
        },
    },
}


def _load_idea_file() -> str:
    p = Path(settings.config_path) / "agents.md"
    if not p.exists():
        return "(idea file missing)"
    try:
        return p.read_text(encoding="utf-8")
    except Exception:
        return "(idea file unreadable)"


async def _gather_wiki_snapshot(session: AsyncSession) -> dict[str, Any]:
    """Build the lint context: page directory, full bodies (truncated), and
    pre-computed link adjacency so the agent has cheap access to the same
    structural signals it would otherwise have to compute."""
    pages = (await session.execute(select(Page).order_by(Page.path))).scalars().all()
    links = (await session.execute(select(Link))).scalars().all()
    inbound: dict[int, list[str]] = {}
    outbound: dict[int, list[str]] = {}
    by_id = {p.id: p for p in pages}

    for ln in links:
        if ln.target_id is not None:
            inbound.setdefault(ln.target_id, []).append(by_id[ln.source_id].path if ln.source_id in by_id else "?")
            outbound.setdefault(ln.source_id, []).append(by_id[ln.target_id].path)
        else:
            # broken link — target_path doesn't resolve
            outbound.setdefault(ln.source_id, []).append(f"BROKEN→{ln.target_path}")

    snapshot: list[dict[str, Any]] = []
    for p in pages:
        body = ""
        if p.current_revision_id:
            rev = await session.get(Revision, p.current_revision_id)
            if rev:
                body = rev.body
        # Truncate to keep prompt size sane on bigger wikis.
        if len(body) > 4000:
            body = body[:4000] + "\n[…truncated]"
        snapshot.append({
            "path": p.path,
            "title": p.title,
            "tags": list(p.tags or []),
            "stability": p.stability.value,
            "inbound_links": inbound.get(p.id, []),
            "outbound_links": outbound.get(p.id, []),
            "body": body,
        })
    return {"pages": snapshot, "page_count": len(pages), "link_count": len(links)}


async def _call_llm(snapshot: dict[str, Any]) -> dict:
    system_prompt = (
        "You are a wiki-maintenance lint agent. Read the playbook below and "
        "scan the wiki snapshot for issues. Output ONLY via the "
        "`submit_lint_findings` tool. Do not propose fixes — only report.\n\n"
        f"--- PLAYBOOK ---\n{_load_idea_file()}\n--- END PLAYBOOK ---"
    )

    instruction = (
        "Inspect this wiki snapshot. Identify:\n"
        "  - orphans: pages with empty inbound_links and no clear hub link.\n"
        "  - broken_link: outbound_links containing 'BROKEN→' tokens.\n"
        "  - conflict: two pages making contradictory factual claims.\n"
        "  - stale: claims that look outdated based on body content.\n"
        "  - source_drift: sources/* pages without supporting evidence; or "
        "    pages citing sources that no longer exist.\n"
        "  - other: structural issues (e.g. missing required sections per playbook).\n"
        "Be specific. Cite page paths in `affected_paths`. Aim for "
        "actionable severity calibration: high = correctness/safety risk; "
        "medium = quality drag; low = polish.\n\n"
        f"Wiki has {snapshot['page_count']} pages, {snapshot['link_count']} resolved links.\n\n"
        "Pages:\n"
    )
    for p in snapshot["pages"]:
        instruction += (
            f"\n## {p['path']} | title='{p['title']}' | tags={p['tags']} | "
            f"stability={p['stability']}\n"
            f"inbound: {p['inbound_links']}\n"
            f"outbound: {p['outbound_links']}\n"
            f"body:\n{p['body']}\n"
        )

    return await llm_tool_call(
        system=system_prompt,
        messages=[{"role": "user", "content": instruction}],
        tool_name=LINT_TOOL_NAME,
        tool_description="Submit the lint findings as a structured report.",
        tool_schema=LINT_TOOL_SCHEMA,
        max_tokens=8000,
    )


async def run_lint(
    session: AsyncSession, *, report_id: int,
) -> LintReport:
    """Pull wiki snapshot, call Claude, persist a list of LintIssue rows."""
    report = await session.get(LintReport, report_id)
    if report is None:
        raise ValueError(f"LintReport {report_id} not found")

    try:
        snapshot = await _gather_wiki_snapshot(session)
        result = await _call_llm(snapshot)

        issues = result.get("issues") or []
        for it in issues:
            try:
                kind_str = (it.get("kind") or "other").lower()
                kind = LintIssueKind(kind_str) if kind_str in {k.value for k in LintIssueKind} else LintIssueKind.other
                sev_str = (it.get("severity") or "medium").lower()
                severity = LintIssueSeverity(sev_str) if sev_str in {s.value for s in LintIssueSeverity} else LintIssueSeverity.medium
                title = (it.get("title") or "(untitled issue)")[:200]
                session.add(LintIssue(
                    report_id=report.id,
                    kind=kind,
                    severity=severity,
                    title=title,
                    description=it.get("description"),
                    affected_paths=it.get("affected_paths") or [],
                    suggested_action=it.get("suggested_action"),
                    status=LintIssueStatus.open,
                ))
            except Exception:
                log.exception("Failed to persist lint issue: %s", it)

        report.summary = result.get("summary")
        report.total_issues = len(issues)
        report.provider_model = active_model()
        report.retrieval_strategy = "full-snapshot"
        report.status = LintReportStatus.done
        report.finished_at = datetime.now(timezone.utc)
        session.add(AuditLog(
            actor_id=report.triggered_by_id, action="lint.done",
            target_type="lint_report", target_id=report.id,
            payload={"issues": len(issues)},
        ))
        await session.commit()
    except Exception as e:  # noqa: BLE001
        await session.rollback()
        report = await session.get(LintReport, report_id)
        assert report is not None
        report.status = LintReportStatus.failed
        report.error = str(e)
        report.finished_at = datetime.now(timezone.utc)
        session.add(AuditLog(
            actor_id=report.triggered_by_id, action="lint.failed",
            target_type="lint_report", target_id=report.id,
            payload={"error": str(e)},
        ))
        await session.commit()
        log.exception("Lint failed for report %d", report_id)
        raise
    return report
