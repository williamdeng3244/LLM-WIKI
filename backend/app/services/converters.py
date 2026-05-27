"""High-fidelity document converters used during ingest.

Currently a single integration: MinerU sidecar for PDF + Office formats
→ Markdown. Falls back to a None return (caller routes to default
behavior) on any error so the wiki keeps working when the sidecar is
down or the service is disabled.
"""
import logging
from typing import Optional

import httpx

from app.core.config import settings

log = logging.getLogger(__name__)


async def convert_via_mineru(
    file_bytes: bytes,
    filename: str = "input.pdf",
    mime_type: str = "application/octet-stream",
) -> Optional[str]:
    """POST a document to the MinerU sidecar; return the parsed Markdown
    or None if MinerU is disabled or the call fails.

    Supports whatever MinerU 3.x accepts — PDF, DOCX, PPTX, XLSX, and
    images. Generous 30-min timeout because CPU parsing of a multi-page
    document can take that long.

    On any non-2xx, network error, or empty markdown: log and return
    None so the caller falls back to the default content block
    (Anthropic native PDF / image / "Unsupported MIME" error). We don't
    want a single MinerU hiccup to fail the whole ingest run.
    """
    if not settings.mineru_enabled:
        return None
    try:
        async with httpx.AsyncClient(timeout=1800.0) as client:
            r = await client.post(
                f"{settings.mineru_url}/parse",
                files={"file": (filename, file_bytes, mime_type)},
            )
            r.raise_for_status()
            data = r.json()
            md = data.get("markdown") or None
            if md:
                log.info(
                    "MinerU returned %d chars of Markdown for %s",
                    len(md), filename,
                )
            else:
                log.warning("MinerU returned empty Markdown for %s", filename)
            return md
    except Exception as e:  # noqa: BLE001
        log.exception("MinerU conversion failed for %s: %s", filename, e)
        return None


# Backwards-compatible alias — callers that imported the old name still
# work. New code should prefer `convert_via_mineru`.
convert_pdf_via_mineru = convert_via_mineru
