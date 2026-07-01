"""Fetch a public URL and turn it into a RawSource-friendly blob.

Backs `POST /api/raw/url` (issue #6). The HTTP fetch has three guard
rails: scheme allowlist, an SSRF IP check (blocks the link-local /
cloud-metadata range by default; private/loopback intranet hosts are
allowed so company links import — URL_INGEST_ALLOW_PRIVATE=true lifts it
entirely), and a streaming size cap. text/html responses are run
through readability + markdownify to strip nav/chrome before storage,
so the downstream ingest pipeline gets clean markdown. PDFs and
plain markdown/text are stored as-is and handled by the existing
ingest paths.
"""
from __future__ import annotations

import ipaddress
import logging
import socket
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlparse, unquote

import httpx
from fastapi import HTTPException

from app.core.config import settings

log = logging.getLogger(__name__)

# Subset of MIME types we know how to handle downstream. Everything else
# gets rejected up front with a clear 415 instead of being stored and
# then failing in the ingest worker.
_SUPPORTED_PREFIXES = (
    "text/html",
    "text/markdown",
    "text/plain",
    "application/pdf",
)


@dataclass
class FetchedResource:
    """Result of a successful URL fetch."""
    content: bytes          # bytes to write to disk
    mime_type: str          # final mime; HTML becomes text/markdown
    filename: str           # derived from URL path, safe extension
    title: Optional[str]    # extracted from <title> for HTML, else None
    source_url: str         # the final URL after redirects


def _validate_url(url: str) -> tuple[str, str]:
    """Parse the URL and SSRF-check it. Returns (hostname, normalized_url)."""
    try:
        parsed = urlparse(url)
    except ValueError as e:
        raise HTTPException(400, f"Invalid URL: {e}") from e
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(400, "Only http and https URLs are supported")
    if not parsed.hostname:
        raise HTTPException(400, "URL has no hostname")
    if settings.url_ingest_allow_private:
        return parsed.hostname, url
    # This is an internal-only wiki whose whole point is importing from
    # company links, so private/RFC1918 + loopback hosts are ALLOWED. What
    # stays blocked is the link-local range (169.254.0.0/16 — the cloud
    # metadata / IMDS endpoint, the highest-impact SSRF target: it can leak
    # instance credentials), plus multicast/unspecified. Set
    # URL_INGEST_ALLOW_PRIVATE=true to lift the check entirely. (One-shot
    # check; it doesn't cover DNS rebinding — a per-connection transport
    # would, layered in later if abuse becomes a real concern.)
    try:
        infos = socket.getaddrinfo(parsed.hostname, None)
    except socket.gaierror as e:
        raise HTTPException(400, f"Cannot resolve hostname: {e}") from e
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_link_local or ip.is_multicast or ip.is_unspecified:
            raise HTTPException(
                403,
                f"Refusing to fetch from link-local/metadata address {ip}. "
                "Set URL_INGEST_ALLOW_PRIVATE=true to override.",
            )
    return parsed.hostname, url


def _filename_from_url(url: str, mime_type: str) -> str:
    """Derive a sensible filename from the URL path."""
    parsed = urlparse(url)
    name = unquote(parsed.path.rstrip("/").rsplit("/", 1)[-1]) or parsed.hostname or "url-source"
    # Strip query/fragment fragments accidentally captured.
    name = name.split("?", 1)[0].split("#", 1)[0]
    # Append a content-type-appropriate extension if the URL didn't end with one.
    lower = name.lower()
    if mime_type.startswith("text/markdown") and not lower.endswith(".md"):
        name += ".md"
    elif mime_type == "application/pdf" and not lower.endswith(".pdf"):
        name += ".pdf"
    elif mime_type.startswith("text/plain") and not (
        lower.endswith(".txt") or lower.endswith(".md")
    ):
        name += ".txt"
    return name[:200]  # filesystem-safe length


def _html_to_markdown(html: str) -> tuple[str, Optional[str]]:
    """Strip nav/chrome and convert to markdown. Returns (markdown, title)."""
    # Imports are lazy because these libs are 2nd-tier deps; we don't want
    # the entire backend to fail to start if they're missing in some weird
    # rebuild scenario.
    from readability import Document
    from markdownify import markdownify

    doc = Document(html)
    title = (doc.short_title() or "").strip() or None
    clean_html = doc.summary(html_partial=True)
    md = markdownify(clean_html, heading_style="ATX").strip()
    return md, title


async def fetch_url(url: str) -> FetchedResource:
    """Fetch the URL and return a stored-as content blob ready for RawSource.

    Raises HTTPException on validation / transport / size / content-type errors.
    """
    _validate_url(url)

    limit_bytes = settings.url_ingest_max_bytes
    timeout = settings.url_ingest_timeout_seconds

    async with httpx.AsyncClient(
        timeout=timeout,
        follow_redirects=True,
        headers={
            "User-Agent": f"LLM-WIKI-ingest/0.x (+https://github.com/williamdeng3244/LLM-WIKI)",
            "Accept": "text/html, text/markdown, text/plain, application/pdf",
        },
        max_redirects=5,
    ) as client:
        try:
            # Stream so we can enforce size cap mid-download instead of
            # buffering then discarding.
            async with client.stream("GET", url) as resp:
                if resp.status_code >= 400:
                    raise HTTPException(
                        resp.status_code if resp.status_code < 500 else 502,
                        f"Upstream returned {resp.status_code} for {url}",
                    )
                final_url = str(resp.url)
                mime = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
                if not mime:
                    mime = "application/octet-stream"
                if not any(mime.startswith(p) for p in _SUPPORTED_PREFIXES):
                    raise HTTPException(
                        415,
                        f"Unsupported content type {mime!r}. Supported: "
                        f"text/html, text/markdown, text/plain, application/pdf.",
                    )
                buf = bytearray()
                async for chunk in resp.aiter_bytes(chunk_size=64 * 1024):
                    buf.extend(chunk)
                    if len(buf) > limit_bytes:
                        raise HTTPException(
                            413,
                            f"Resource exceeds {limit_bytes // (1024*1024)} MB cap",
                        )
        except httpx.TimeoutException as e:
            raise HTTPException(504, f"Timed out fetching {url} after {timeout}s") from e
        except httpx.HTTPError as e:
            raise HTTPException(502, f"Failed to fetch {url}: {e}") from e

    body = bytes(buf)
    title: Optional[str] = None

    # HTML gets converted at fetch time so the ingest pipeline sees
    # clean markdown instead of raw web chrome. PDFs / md / txt pass
    # through unchanged.
    if mime.startswith("text/html"):
        try:
            html_str = body.decode("utf-8", errors="replace")
            md_text, title = _html_to_markdown(html_str)
        except Exception as e:
            log.warning("HTML→markdown failed for %s: %s", final_url, e)
            md_text = body.decode("utf-8", errors="replace")
        body = md_text.encode("utf-8")
        mime = "text/markdown"

    filename = _filename_from_url(final_url, mime)
    return FetchedResource(
        content=body,
        mime_type=mime,
        filename=filename,
        title=title,
        source_url=final_url,
    )
