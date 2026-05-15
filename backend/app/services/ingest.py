"""Ingest a raw source: read it, build context, run Claude, queue drafts.

Two-phase pipeline:

  PLAN — read source + idea file + retrieved pages, call Claude with a
         forced tool, store the structured result on an `IngestRun` row,
         and flip the run to status=pending_review. No drafts created.
  APPLY — human approves (optionally per-edit) → walk the cached plan,
         open drafts via the existing workflow with force_review=True.

Drafts always go through the existing review queue. force_review=True
is set so even stability=open pages route through review for agent work.
"""
from __future__ import annotations

import base64
import logging
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import (
    AuditLog, Category, IngestRun, IngestRunStatus, IngestStatus,
    Page, PageStability, RawSource, Revision, RevisionProvenance,
    RevisionStatus, Role, User,
)
from app.services.claude_client import get_client
from app.services.retrieval import RetrievalContext, gather_context
from app.services.workflow import create_draft, submit_for_review

log = logging.getLogger(__name__)

MAX_EDITS = 20  # v1 hard cap; excess get logged in run.summary
TEXT_MIME_PREFIXES = ("text/", "application/json", "application/x-yaml")
PDF_MIME = "application/pdf"
INGEST_TOOL_NAME = "submit_ingest_result"

INGEST_TOOL_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["summary", "edits"],
    "properties": {
        "summary": {"type": "string"},
        "edits": {
            "type": "array",
            "maxItems": MAX_EDITS,
            "items": {
                "type": "object",
                "required": ["kind", "path", "title", "body", "rationale"],
                "properties": {
                    "kind": {
                        "type": "string",
                        "enum": ["edit_existing", "create_new", "source_summary", "conflict"],
                    },
                    "path": {"type": "string"},
                    "title": {"type": "string"},
                    "body": {"type": "string"},
                    "tags": {"type": "array", "items": {"type": "string"}},
                    "category_slug": {"type": "string"},
                    "stability": {"type": "string", "enum": ["open", "stable", "locked"]},
                    "rationale": {"type": "string"},
                    "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                    "source_refs": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["quote_or_excerpt"],
                            "properties": {
                                "source_id": {"type": "integer"},
                                "quote_or_excerpt": {"type": "string"},
                                "location": {"type": "string"},
                            },
                        },
                    },
                    "conflict_notes": {"type": "string"},
                },
            },
        },
    },
}


# ── Agent identity ──────────────────────────────────────────────────────────

async def ensure_ingest_agent(session: AsyncSession, owner: User) -> User:
    email = f"agent+{owner.id}+ingest@local"
    existing = (await session.execute(
        select(User).where(User.email == email)
    )).scalar_one_or_none()
    if existing:
        return existing
    agent = User(
        email=email,
        name=f"Ingest agent (of {owner.name})",
        role=Role.contributor,
        is_agent=True,
        owner_id=owner.id,
    )
    session.add(agent)
    await session.flush()
    return agent


# ── Idea-file load ──────────────────────────────────────────────────────────

def _load_idea_file() -> str:
    p = Path(settings.config_path) / "agents.md"
    if not p.exists():
        return "(idea file missing)"
    try:
        return p.read_text(encoding="utf-8")
    except Exception as e:
        log.warning("Failed to read idea file: %s", e)
        return "(idea file unreadable)"


# ── Reviewer-feedback loop (Phase 3.6 closed) ────────────────────────────────

# Window over which past rejections are surfaced to the agent. 90 days keeps
# the feedback relevant without anchoring forever on old mistakes.
REJECT_FEEDBACK_WINDOW_DAYS = 90
# Per-reason quote cap. We always show aggregate counts; only the most recent
# rejections get verbatim notes pasted in.
REJECT_FEEDBACK_MAX_EXAMPLES = 6


async def _recent_reject_feedback(session: AsyncSession) -> str:
    """Aggregate recent rejected agent drafts into a prompt section.

    Pulls `revision_provenance` rows where the linked revision was rejected
    and a `reject_reason` was captured by the reviewer (Phase 3.6 surface).
    Returns a markdown block the caller appends to the system prompt; the
    agent uses it to avoid repeating its own historical failure patterns.

    Empty string if there are no recent rejections — keeps the prompt clean
    on a fresh install.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=REJECT_FEEDBACK_WINDOW_DAYS)
    rows = (await session.execute(
        select(RevisionProvenance, Revision, Page)
        .join(Revision, RevisionProvenance.revision_id == Revision.id)
        .join(Page, Page.id == Revision.page_id)
        .where(
            RevisionProvenance.is_agent_authored.is_(True),
            RevisionProvenance.reject_reason.isnot(None),
            Revision.status == RevisionStatus.rejected,
            Revision.reviewed_at.isnot(None),
            Revision.reviewed_at >= cutoff,
        )
        .order_by(Revision.reviewed_at.desc())
        .limit(200)
    )).all()
    if not rows:
        return ""

    counts: dict[str, int] = {}
    examples: list[tuple[str, str, str]] = []
    for prov, _rev, page in rows:
        reason = prov.reject_reason or "other"
        counts[reason] = counts.get(reason, 0) + 1
        if prov.reject_notes and len(examples) < REJECT_FEEDBACK_MAX_EXAMPLES:
            note = prov.reject_notes.strip()
            if note:
                examples.append((reason, note, page.path))

    lines: list[str] = [
        f"--- RECENT REVIEWER REJECTIONS (last {REJECT_FEEDBACK_WINDOW_DAYS} days, "
        f"{len(rows)} agent drafts) ---",
        "Recent reviewers have rejected agent drafts for the following reasons. "
        "Treat this as guidance for what to avoid in this ingest:",
        "",
        "Counts by category:",
    ]
    for reason, n in sorted(counts.items(), key=lambda x: -x[1]):
        lines.append(f"  - {reason}: {n}×")
    if examples:
        lines.append("")
        lines.append("Representative reviewer notes (verbatim):")
        for reason, note, path in examples:
            # Truncate any single note that's accidentally huge.
            trimmed = note if len(note) <= 220 else note[:220] + "…"
            lines.append(f"  - [{reason}] on '{path}': {trimmed}")
    lines.append("--- END REJECTION FEEDBACK ---")
    return "\n".join(lines)


# ── Raw source -> Anthropic content blocks ─────────────────────────────────

def _read_raw_source_block(rs: RawSource) -> tuple[Optional[dict], Optional[str]]:
    path = Path(settings.raw_path) / rs.disk_filename
    if not path.exists():
        return None, f"Raw file missing on disk: {path}"
    mime = (rs.mime_type or "application/octet-stream").lower()
    try:
        raw_bytes = path.read_bytes()
    except Exception as e:
        return None, f"Cannot read raw file: {e}"

    if mime.startswith(TEXT_MIME_PREFIXES):
        try:
            text = raw_bytes.decode("utf-8", errors="replace")
        except Exception as e:
            return None, f"Cannot decode text source: {e}"
        return {"type": "text", "text": f"--- raw source ({rs.original_filename}) ---\n{text}"}, None

    if mime == PDF_MIME:
        return {
            "type": "document",
            "source": {
                "type": "base64",
                "media_type": "application/pdf",
                "data": base64.b64encode(raw_bytes).decode("ascii"),
            },
        }, None

    if mime.startswith("image/"):
        return {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": mime,
                "data": base64.b64encode(raw_bytes).decode("ascii"),
            },
        }, None

    return None, f"Unsupported MIME type: {mime} — convert to PDF/markdown/text first."


# ── Prompt assembly ────────────────────────────────────────────────────────

def _assemble_user_message(
    rs: RawSource, ctx: RetrievalContext, source_block: dict,
) -> list[dict]:
    directory_lines = "\n".join(
        f"- {p.path} | {p.title} | tags={p.tags}" for p in ctx.directory
    ) or "(no pages yet)"
    focus_lines = []
    for fp in ctx.focus:
        focus_lines.append(
            f"\n## {fp.path}\nTitle: {fp.title}\nTags: {fp.tags}\n\n{fp.body}\n"
        )
    focus_text = "\n".join(focus_lines) or "(no related pages)"

    instruction = (
        f"Raw source #{rs.id}: '{rs.title}' (file '{rs.original_filename}').\n"
        f"Description from uploader: {rs.description or '(none)'}\n\n"
        "Apply the playbook to merge the source content into the wiki. Output your "
        "decisions via the `submit_ingest_result` tool. Each edit MUST include "
        "rationale and source_refs. Use kind=conflict (don't overwrite) when the "
        "raw source contradicts an existing page; include conflict_notes there.\n"
        f"Hard cap: {MAX_EDITS} edits. Skipped suggestions go in summary.\n\n"
        f"Existing page directory ({len(ctx.directory)} pages):\n{directory_lines}\n\n"
        f"Full text of pages most likely affected ({len(ctx.focus)}):\n{focus_text}\n"
    )

    return [
        {"type": "text", "text": instruction},
        source_block,
    ]


async def _call_claude(
    rs: RawSource, ctx: RetrievalContext, source_block: dict,
    *, reject_feedback: str = "",
) -> dict:
    client = get_client()
    system_prompt = (
        "You are an LLM-Wiki ingest agent. Your job is to merge a raw input "
        "document into an existing wiki by proposing edits. Strictly follow "
        "the playbook below. Output ONLY via the `submit_ingest_result` tool.\n\n"
        f"--- PLAYBOOK ---\n{_load_idea_file()}\n--- END PLAYBOOK ---"
    )
    if reject_feedback:
        system_prompt += "\n\n" + reject_feedback
    user_blocks = _assemble_user_message(rs, ctx, source_block)
    response = await client.messages.create(
        model=settings.chat_model,
        max_tokens=8000,
        system=system_prompt,
        tools=[{
            "name": INGEST_TOOL_NAME,
            "description": "Submit the proposed wiki edits for human review.",
            "input_schema": INGEST_TOOL_SCHEMA,
        }],
        tool_choice={"type": "tool", "name": INGEST_TOOL_NAME},
        messages=[{"role": "user", "content": user_blocks}],
    )
    for block in response.content:
        if getattr(block, "type", None) == "tool_use" and block.name == INGEST_TOOL_NAME:
            return block.input  # type: ignore[no-any-return]
    raise RuntimeError("Claude did not return tool_use; refusing to proceed.")


# ── PLAN PHASE ─────────────────────────────────────────────────────────────

async def run_plan_phase(
    session: AsyncSession, *, run_id: int,
) -> IngestRun:
    """Read source + context, call Claude, store plan on the run.
    Run must be in status=planning. Sets pending_review on success or
    failed on any exception."""
    run = await session.get(IngestRun, run_id)
    if run is None:
        raise ValueError(f"IngestRun {run_id} not found")
    rs = await session.get(RawSource, run.raw_source_id)
    if rs is None:
        run.status = IngestRunStatus.failed
        run.error = "Raw source not found"
        run.finished_at = datetime.now(timezone.utc)
        await session.commit()
        return run

    try:
        source_block, err = _read_raw_source_block(rs)
        if err is not None:
            raise RuntimeError(err)
        assert source_block is not None

        ctx = await gather_context(session, rs)
        # Phase 3.6 closed: surface recent reviewer rejections (with notes)
        # so the agent learns from prior failures instead of repeating them.
        reject_feedback = await _recent_reject_feedback(session)
        result = await _call_claude(
            rs, ctx, source_block, reject_feedback=reject_feedback,
        )

        edits = result.get("edits") or []
        # Counts for the preview UI.
        run.edits_count = len(edits)
        run.skipped_count = max(0, len(edits) - MAX_EDITS)
        run.conflict_count = sum(1 for e in edits if e.get("kind") == "conflict")
        if run.skipped_count:
            edits = edits[:MAX_EDITS]
            result["edits"] = edits

        # Stamp a stable edit_id on each edit so the apply phase can be
        # idempotent: re-running apply skips any edit whose (run, edit_id)
        # already has a provenance row.
        for e in edits:
            if not e.get("edit_id"):
                e["edit_id"] = uuid.uuid4().hex[:12]

        run.plan_json = result
        run.summary = result.get("summary")
        run.retrieval_strategy = ctx.strategy
        run.provider_model = settings.chat_model
        run.status = IngestRunStatus.pending_review
        run.planned_at = datetime.now(timezone.utc)

        # Reflect status on the parent source row for SourcesPanel.
        rs.ingest_status = IngestStatus.ingesting  # still "in flight" until applied
        rs.last_ingest_notes = (
            f"Plan ready ({run.edits_count} proposed edits"
            f"{f', {run.conflict_count} conflicts' if run.conflict_count else ''}). "
            "Awaiting human review."
        )
        session.add(AuditLog(
            actor_id=run.triggered_by_id, action="raw.ingest.plan",
            target_type="ingest_run", target_id=run.id,
            payload={
                "edits": run.edits_count,
                "conflicts": run.conflict_count,
                "skipped": run.skipped_count,
            },
        ))
        await session.commit()
    except Exception as e:  # noqa: BLE001
        await session.rollback()
        run = await session.get(IngestRun, run_id)  # refresh
        assert run is not None
        rs = await session.get(RawSource, run.raw_source_id)
        run.status = IngestRunStatus.failed
        run.error = str(e)
        run.finished_at = datetime.now(timezone.utc)
        if rs is not None:
            rs.ingest_status = IngestStatus.failed
            rs.last_ingest_notes = f"Plan failed: {e}"
        session.add(AuditLog(
            actor_id=run.triggered_by_id, action="raw.ingest.failed",
            target_type="ingest_run", target_id=run.id,
            payload={"phase": "plan", "error": str(e)},
        ))
        await session.commit()
        log.exception("Plan phase failed for run %d", run_id)
        raise
    return run


# ── APPLY PHASE ────────────────────────────────────────────────────────────

async def run_apply_phase(
    session: AsyncSession, *, run_id: int,
) -> IngestRun:
    """Walk the cached plan and create drafts for the approved edit indices.

    Retry-safe: if a provenance row already exists for (run_id, edit_id) we
    skip that edit, so re-running this task only fills in the missing drafts.
    Per-edit failures are committed (via failed_count) but never abort the
    rest of the run. Final status is `done`, `partially_failed`, or `failed`.
    """
    run = await session.get(IngestRun, run_id)
    if run is None:
        raise ValueError(f"IngestRun {run_id} not found")
    rs = await session.get(RawSource, run.raw_source_id)
    if rs is None:
        run.status = IngestRunStatus.failed
        run.error = "Raw source not found"
        await session.commit()
        return run

    triggerer = await session.get(User, run.triggered_by_id) if run.triggered_by_id else None
    if triggerer is None:
        run.status = IngestRunStatus.failed
        run.error = "Triggering user no longer exists; cannot apply."
        run.finished_at = datetime.now(timezone.utc)
        if rs is not None:
            rs.ingest_status = IngestStatus.failed
            rs.last_ingest_notes = run.error
        await session.commit()
        return run

    agent = await ensure_ingest_agent(session, triggerer)
    run.agent_user_id = agent.id

    # Recompute applied_count from existing provenance rows so retries
    # reflect actual on-disk state instead of resetting progress to zero.
    already_applied_ids = set(
        r[0] for r in (await session.execute(
            select(RevisionProvenance.edit_id)
            .where(
                RevisionProvenance.ingest_run_id == run.id,
                RevisionProvenance.edit_id.isnot(None),
            )
        )).all()
    )
    run.applied_count = len(already_applied_ids)
    # failed_count is per-attempt: clear on each apply call so the count
    # reflects this run, not the cumulative across retries.
    run.failed_count = 0
    await session.commit()

    plan = run.plan_json or {}
    edits = list(plan.get("edits") or [])
    approved = run.approved_edit_indices
    approved_set = set(range(len(edits))) if approved is None else set(approved)

    cats = (await session.execute(select(Category))).scalars().all()
    cats_by_slug = {c.slug: c for c in cats}

    errors: list[str] = []
    skipped_existing = 0

    for idx, e in enumerate(edits):
        if idx not in approved_set:
            continue
        edit_id = e.get("edit_id")

        # Idempotency guard #1: skip if this edit_id already has a
        # provenance row from a previous attempt.
        if edit_id and edit_id in already_applied_ids:
            skipped_existing += 1
            continue

        try:
            kind = e.get("kind")
            path = (e.get("path") or "").strip().lstrip("/")
            title = (e.get("title") or "").strip()
            body = e.get("body") or ""
            tags = list(e.get("tags") or [])
            rationale_parts = [e.get("rationale") or "Agent ingest"]
            if kind == "conflict" and e.get("conflict_notes"):
                rationale_parts.append(f"CONFLICT: {e['conflict_notes']}")
            rationale = " — ".join(rationale_parts)

            if not path or not title or not body:
                errors.append(f"Skipped #{idx} (missing path/title/body)")
                run.failed_count += 1
                await session.commit()
                continue

            page = (await session.execute(
                select(Page).where(Page.path == path)
            )).scalar_one_or_none()

            if kind in ("edit_existing", "conflict"):
                if page is None:
                    errors.append(f"Skipped #{idx} ({kind}): page '{path}' not found")
                    run.failed_count += 1
                    await session.commit()
                    continue
            elif kind in ("create_new", "source_summary"):
                if page is None:
                    cat_slug = e.get("category_slug")
                    cat = cats_by_slug.get(cat_slug) if cat_slug else None
                    stability_str = (e.get("stability") or "stable").lower()
                    stability = (
                        PageStability.locked if stability_str == "locked"
                        else PageStability.open if stability_str == "open"
                        else PageStability.stable
                    )
                    page = Page(
                        path=path, title=title,
                        category_id=cat.id if cat else None,
                        stability=stability, tags=tags, created_by_id=agent.id,
                    )
                    session.add(page)
                    await session.flush()
            else:
                errors.append(f"Unknown kind: {kind!r}")
                run.failed_count += 1
                await session.commit()
                continue

            assert page is not None
            rev = await create_draft(
                session, page=page, author=agent,
                title=title, body=body, tags=tags, rationale=rationale,
            )
            await submit_for_review(session, rev, agent, force_review=True)

            session.add(RevisionProvenance(
                revision_id=rev.id,
                raw_source_id=rs.id,
                ingest_run_id=run.id,
                edit_id=edit_id,
                confidence=e.get("confidence"),
                source_refs=e.get("source_refs") or [],
                conflict_notes=e.get("conflict_notes"),
                edit_kind=kind,
                is_agent_authored=True,
            ))
            run.applied_count += 1
            await session.commit()
            if edit_id:
                already_applied_ids.add(edit_id)
        except Exception as ex:  # noqa: BLE001
            await session.rollback()
            run = await session.get(IngestRun, run_id)
            assert run is not None
            run.failed_count += 1
            errors.append(f"Edit #{idx} failed ({e.get('path', '?')}): {ex}")
            await session.commit()
            log.exception("Apply edit %d failed", idx)

    # Re-load and finalize status.
    run = await session.get(IngestRun, run_id)
    rs = await session.get(RawSource, run.raw_source_id)
    assert run is not None and rs is not None

    target_count = len(approved_set)
    if run.failed_count == 0:
        run.status = IngestRunStatus.done
    elif run.applied_count == 0:
        run.status = IngestRunStatus.failed
    else:
        run.status = IngestRunStatus.partially_failed

    run.applied_at = run.applied_at or datetime.now(timezone.utc)
    run.finished_at = datetime.now(timezone.utc)
    if errors:
        run.summary = (
            (run.summary or "") + "\n\nApply notes:\n- " + "\n- ".join(errors)
        ).strip()

    if run.status == IngestRunStatus.done:
        rs.ingest_status = IngestStatus.done
    elif run.status == IngestRunStatus.failed:
        rs.ingest_status = IngestStatus.failed
    else:  # partially_failed
        rs.ingest_status = IngestStatus.done  # some drafts landed

    rs.last_ingested_at = datetime.now(timezone.utc)
    rs.last_ingest_notes = (
        f"{run.applied_count}/{target_count} drafts created"
        f"{f' ({run.failed_count} failed)' if run.failed_count else ''}"
        f"{f' (skipped {skipped_existing} already-applied)' if skipped_existing else ''}. "
        f"Retrieval: {run.retrieval_strategy}, model: {run.provider_model}."
    )
    session.add(AuditLog(
        actor_id=run.triggered_by_id, action="raw.ingest.done",
        target_type="ingest_run", target_id=run.id,
        payload={
            "applied": run.applied_count,
            "failed": run.failed_count,
            "skipped_idempotent": skipped_existing,
            "errors": errors[:5],
            "final_status": run.status.value,
        },
    ))
    await session.commit()
    return run


# ── Pre-flight checks ──────────────────────────────────────────────────────

async def list_pending_drafts_for_source(
    session: AsyncSession, *, source_id: int,
) -> list[Revision]:
    """Revisions linked to this source via provenance whose status is
    draft or proposed (not yet reviewed). Used by the duplicate-warning
    dialog before triggering a new ingest."""
    rows = (await session.execute(
        select(Revision)
        .join(RevisionProvenance, RevisionProvenance.revision_id == Revision.id)
        .where(
            RevisionProvenance.raw_source_id == source_id,
            Revision.status.in_([RevisionStatus.draft, RevisionStatus.proposed]),
        )
        .order_by(Revision.created_at.desc())
    )).scalars().all()
    return list(rows)


async def supersede_pending_runs(
    session: AsyncSession, *, source_id: int,
) -> int:
    """Mark any in-flight runs for this source as superseded so a new
    plan replaces the old one. Returns the count superseded."""
    pending = (await session.execute(
        select(IngestRun).where(
            IngestRun.raw_source_id == source_id,
            IngestRun.status.in_([
                IngestRunStatus.planning,
                IngestRunStatus.pending_review,
            ]),
        )
    )).scalars().all()
    now = datetime.now(timezone.utc)
    for r in pending:
        r.status = IngestRunStatus.superseded
        r.finished_at = now
    if pending:
        await session.commit()
    return len(pending)
