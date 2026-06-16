"""Shared pytest fixtures for the API test suite.

Style mirrors ``test_artifacts.py``: black-box integration against the **live**
backend on :8000, using stub auth (``X-User-Email`` auto-creates a user;
``X-User-Role`` sets its role on first sight). Every test uses fresh unique
emails/paths so runs never collide with each other or the seeded admin.

Run inside the backend container:
    docker exec wiki-backend-1 pytest tests/ -v

Requires ``AUTH_MODE=stub`` (the dev default; assert it via /api/auth/config).
Each test is named after the SRS requirement it covers (e.g.
``test_FR_PAGE_003_reader_draft_403``) so coverage maps 1:1 to docs/srs.
"""
from __future__ import annotations

import os
import uuid

import httpx
import pytest

BASE_URL = os.environ.get("WIKI_TEST_BASE_URL", "http://localhost:8000")
TIMEOUT = 20.0


def unique_email(prefix: str = "qa") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}@example.com"


def unique_path(prefix: str = "n") -> str:
    # Namespaced under qa/ so seed/cleanup is easy to spot; unique per call.
    return f"qa/{prefix}-{uuid.uuid4().hex[:10]}"


def _client(role: str | None, email: str | None) -> httpx.Client:
    headers: dict[str, str] = {}
    if email is not None:
        headers["X-User-Email"] = email
    if role is not None:
        headers["X-User-Role"] = role
    return httpx.Client(
        base_url=BASE_URL, headers=headers, follow_redirects=False, timeout=TIMEOUT
    )


@pytest.fixture
def make_client():
    """Factory: make_client(role='editor') -> a fresh httpx.Client for a fresh
    user of that role. The user's email is readable via client.headers; its id
    via uid(client). All created clients are closed at teardown."""
    created: list[httpx.Client] = []

    def _make(role: str = "contributor", email: str | None = None) -> httpx.Client:
        c = _client(role, email or unique_email(role))
        created.append(c)
        return c

    yield _make
    for c in created:
        c.close()


@pytest.fixture
def admin(make_client):
    return make_client("admin")


@pytest.fixture
def editor(make_client):
    return make_client("editor")


@pytest.fixture
def contributor(make_client):
    return make_client("contributor")


@pytest.fixture
def reader(make_client):
    return make_client("reader")


@pytest.fixture
def anon():
    """Unauthenticated client (no stub headers)."""
    c = _client(None, None)
    yield c
    c.close()


# -- helpers (importable in test modules) --------------------------------


def uid(client: httpx.Client) -> int:
    """The authenticated user's id (via whoami)."""
    r = client.get("/api/auth/whoami")
    r.raise_for_status()
    return r.json()["id"]


def email_of(client: httpx.Client) -> str:
    return client.headers["x-user-email"]


def publish_page(
    client: httpx.Client,
    *,
    path: str | None = None,
    title: str = "QA Page",
    body: str = "hello world",
    stability: str = "open",
    tags: list[str] | None = None,
) -> dict:
    """Create + submit a NEW page. With stability='open' it auto-publishes, so
    the returned page is live (searchable/graphed). Returns
    {path, revision_id, status}. Raises on any non-2xx (seed must succeed)."""
    path = path or unique_path()
    r = client.post(
        "/api/pages/draft",
        json={
            "title": title,
            "body": body,
            "tags": tags or [],
            "new_page": {"path": path, "stability": stability},
        },
    )
    r.raise_for_status()
    rev = r.json()
    s = client.post(f"/api/revisions/{rev['id']}/submit")
    s.raise_for_status()
    return {"path": path, "revision_id": rev["id"], "status": s.json().get("status")}


def create_draft(
    client: httpx.Client,
    *,
    page_path: str | None = None,
    new_path: str | None = None,
    title: str = "Draft",
    body: str = "draft body",
    stability: str = "stable",
) -> dict:
    """Create a draft (edit an existing page_path, or a new_path). Returns the
    RevisionOut. Does NOT submit."""
    payload: dict = {"title": title, "body": body, "tags": []}
    if page_path is not None:
        payload["page_path"] = page_path
    else:
        payload["new_page"] = {"path": new_path or unique_path(), "stability": stability}
    r = client.post("/api/pages/draft", json=payload)
    r.raise_for_status()
    return r.json()
