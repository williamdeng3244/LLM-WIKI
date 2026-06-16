"""[unit] URL-ingest helper — SSRF validation + HTML→markdown + filename.

`fetch_url()` itself does live HTTP, but its guard rails are pure: the
SSRF/scheme/hostname checks in `_validate_url`, the extension logic in
`_filename_from_url`, and the readability/markdownify conversion in
`_html_to_markdown`. These run with no real network (literal IPs resolve
locally; a reserved `.invalid` host fails DNS immediately).
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.core.config import settings
from app.services.url_fetcher import (
    _filename_from_url,
    _html_to_markdown,
    _validate_url,
)


def test_validate_url_rejects_non_http_scheme():
    with pytest.raises(HTTPException) as e:
        _validate_url("ftp://example.com/x")
    assert e.value.status_code == 400


def test_validate_url_rejects_missing_hostname():
    with pytest.raises(HTTPException) as e:
        _validate_url("http:///just/a/path")
    assert e.value.status_code == 400


def test_validate_url_rejects_unresolvable_host():
    # `.invalid` is reserved (RFC 2606) → guaranteed DNS failure → 400.
    with pytest.raises(HTTPException) as e:
        _validate_url("http://no-such-host.invalid/")
    assert e.value.status_code == 400


def test_validate_url_rejects_loopback_as_ssrf():
    with pytest.raises(HTTPException) as e:
        _validate_url("http://127.0.0.1/admin")
    assert e.value.status_code == 403


def test_validate_url_allows_public_ip_literal():
    host, url = _validate_url("http://8.8.8.8/")
    assert host == "8.8.8.8"


def test_validate_url_allow_private_override(monkeypatch):
    monkeypatch.setattr(settings, "url_ingest_allow_private", True)
    host, _ = _validate_url("http://10.1.2.3/internal")
    assert host == "10.1.2.3"  # private allowed → SSRF check skipped


def test_filename_from_url_appends_appropriate_extension():
    assert _filename_from_url("https://x.com/doc", "text/markdown").endswith(".md")
    assert _filename_from_url("https://x.com/f", "application/pdf").endswith(".pdf")
    assert _filename_from_url("https://x.com/n", "text/plain").endswith(".txt")
    # already-correct extension is not doubled
    assert _filename_from_url("https://x.com/a.md", "text/markdown") == "a.md"


def test_html_to_markdown_runs_and_returns_str():
    md, title = _html_to_markdown(
        "<html><head><title>My Title</title></head>"
        "<body><article><h1>Heading</h1>"
        "<p>A paragraph of real body text that readability should keep.</p>"
        "</article></body></html>"
    )
    assert isinstance(md, str)
    # title is extracted from <title> when present
    assert title is None or "Title" in title
