"""Admin-only configuration: the idea file (`agents.md`) and friends.

The idea file is the schema layer in Karpathy's framing — a markdown
playbook that's injected into the agent's context whenever it runs an
ingest or lint pass. Anyone authenticated can read it (so every editor
sees the conventions); only admins can change it.
"""
import logging
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from datetime import datetime, timezone
from sqlalchemy import select

from app.core.auth import current_user
from app.core.config import settings
from app.core.db import get_session
from app.models import (
    AuditLog, LintIssue, LintIssueStatus, LintReport, LintReportStatus,
    Role, User,
)
from app.schemas import LintIssueDismiss, LintIssueOut, LintReportOut

router = APIRouter()
log = logging.getLogger(__name__)


# --- The idea file (agents.md) -----------------------------------------------

DEFAULT_IDEA_FILE = """\
# Agent playbook for this wiki

This file is the schema layer for the LLM Wiki. It is injected into the
agent's context whenever it ingests a raw source or runs a lint pass.

(Replace this default with your own conventions: page taxonomy, wikilink
rules, ingest rules, lint rules, answer formatting, authority.)
"""


def _idea_file_path() -> Path:
    return Path(settings.config_path) / "agents.md"


def _ensure_idea_file() -> Path:
    p = _idea_file_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    if not p.exists():
        p.write_text(DEFAULT_IDEA_FILE, encoding="utf-8")
    return p


class IdeaFileOut(BaseModel):
    path: str
    content: str
    last_modified: datetime
    can_edit: bool


class IdeaFileUpdate(BaseModel):
    content: str


@router.get("/idea-file", response_model=IdeaFileOut)
async def read_idea_file(user: User = Depends(current_user)):
    p = _ensure_idea_file()
    stat = p.stat()
    return IdeaFileOut(
        path=str(p),
        content=p.read_text(encoding="utf-8"),
        last_modified=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
        can_edit=(user.role == Role.admin),
    )


@router.put("/idea-file", response_model=IdeaFileOut)
async def write_idea_file(
    body: IdeaFileUpdate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    if user.role != Role.admin:
        raise HTTPException(403, "Admins only")
    p = _ensure_idea_file()
    p.write_text(body.content, encoding="utf-8")
    session.add(AuditLog(
        actor_id=user.id, action="schema.update",
        target_type="idea_file", target_id=None,
        payload={"size": len(body.content)},
    ))
    await session.commit()
    stat = p.stat()
    return IdeaFileOut(
        path=str(p),
        content=p.read_text(encoding="utf-8"),
        last_modified=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
        can_edit=True,
    )


# --- Lint pipeline (Phase 4) -------------------------------------------------

@router.get("/lint/reports", response_model=list[LintReportOut])
async def list_lint_reports(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    if user.role != Role.admin:
        raise HTTPException(403, "Admins only")
    rows = (await session.execute(
        select(LintReport).order_by(LintReport.started_at.desc())
    )).scalars().all()
    return rows


@router.post("/lint/run", response_model=LintReportOut)
async def trigger_lint(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """Queue a new lint pass. Returns immediately — poll the report
    row until status flips from `planning` to `done`/`failed`."""
    if user.role != Role.admin:
        raise HTTPException(403, "Admins only")

    # Refuse if a planning report is already in flight.
    in_flight = (await session.execute(
        select(LintReport).where(LintReport.status == LintReportStatus.planning)
    )).scalar_one_or_none()
    if in_flight is not None:
        raise HTTPException(409, f"Lint already running (report #{in_flight.id})")

    report = LintReport(triggered_by_id=user.id, status=LintReportStatus.planning)
    session.add(report)
    await session.flush()
    session.add(AuditLog(
        actor_id=user.id, action="lint.start",
        target_type="lint_report", target_id=report.id, payload={},
    ))
    await session.commit()
    await session.refresh(report)

    from app.worker import run_lint_pass as celery_task
    celery_task.delay(report_id=report.id)
    return report


@router.get("/lint/reports/{report_id}", response_model=LintReportOut)
async def get_lint_report(
    report_id: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    if user.role != Role.admin:
        raise HTTPException(403, "Admins only")
    rep = await session.get(LintReport, report_id)
    if rep is None:
        raise HTTPException(404, "Not found")
    return rep


@router.get("/lint/reports/{report_id}/issues", response_model=list[LintIssueOut])
async def list_lint_issues(
    report_id: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    if user.role != Role.admin:
        raise HTTPException(403, "Admins only")
    rows = (await session.execute(
        select(LintIssue).where(LintIssue.report_id == report_id)
        .order_by(LintIssue.severity.desc(), LintIssue.id)
    )).scalars().all()
    return rows


@router.post("/lint/issues/{issue_id}/dismiss", response_model=LintIssueOut)
async def dismiss_lint_issue(
    issue_id: int,
    body: LintIssueDismiss,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    if user.role != Role.admin:
        raise HTTPException(403, "Admins only")
    issue = await session.get(LintIssue, issue_id)
    if issue is None:
        raise HTTPException(404, "Not found")
    issue.status = LintIssueStatus.dismissed
    issue.dismissed_by_id = user.id
    issue.dismissed_at = datetime.now(timezone.utc)
    issue.dismiss_note = body.note
    session.add(AuditLog(
        actor_id=user.id, action="lint.dismiss_issue",
        target_type="lint_issue", target_id=issue.id,
        payload={"note": body.note},
    ))
    await session.commit()
    await session.refresh(issue)
    return issue


@router.post("/lint/issues/{issue_id}/act", response_model=LintIssueOut)
async def mark_issue_acted(
    issue_id: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """Mark an issue as 'acted upon'. Used when the reviewer clicks
    'Open page' / 'Suggest edit' so we know the human took notice."""
    if user.role != Role.admin:
        raise HTTPException(403, "Admins only")
    issue = await session.get(LintIssue, issue_id)
    if issue is None:
        raise HTTPException(404, "Not found")
    if issue.status == LintIssueStatus.open:
        issue.status = LintIssueStatus.acted
        await session.commit()
        await session.refresh(issue)
    return issue
