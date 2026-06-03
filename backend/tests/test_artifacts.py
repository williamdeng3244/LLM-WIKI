"""Smoke tests for the gated artifact feature.

Runs against a **live** backend (in-container or local) on port 8000.
Each test creates its own user via stub auth (`X-User-Email: pytest-<uuid>@…`)
so they don't collide with each other or with the seeded admin.

Run inside the backend container:
    docker exec wiki-backend-1 pytest tests/test_artifacts.py -v

Spec § 11 mapping (each test below cites the spec name in its docstring).
"""
from __future__ import annotations

import hashlib
import uuid

import httpx
import pytest


BASE_URL = "http://localhost:8000"


def _email() -> str:
    """Fresh unique email per test → stub auth auto-creates a fresh user
    so tests don't collide on the admin account or on each other."""
    return f"pytest-{uuid.uuid4().hex[:8]}@example.com"


def _client(email: str | None = None) -> httpx.Client:
    headers: dict[str, str] = {}
    if email is not None:
        headers["X-User-Email"] = email
    return httpx.Client(base_url=BASE_URL, headers=headers, follow_redirects=False, timeout=10.0)


# ── 1: publish HTML artifact ───────────────────────────────────────────


def test_publish_artifact_html():
    """spec § 11 #1 — owner can POST, receives short_id + URL,
    can GET metadata."""
    with _client(_email()) as c:
        r = c.post(
            "/api/artifacts",
            files={"file": ("hello.html", b"<h1>hi</h1>", "text/html")},
            data={"name": "Test publish HTML"},
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["short_id"]
        assert body["url"].endswith(f"/a/{body['short_id']}-{'test-publish-html'}")
        assert body["version"] == 1

        meta = c.get(f"/api/artifacts/{body['short_id']}").json()
        assert meta["name"] == "Test publish HTML"
        assert meta["mime_type"] == "text/html"
        assert meta["visibility"] == "wiki"
        assert meta["current_version"] == 1


# ── 2: a different authenticated user can view ─────────────────────────


def test_view_artifact_authenticated():
    """spec § 11 #2 — a second authenticated wiki user can view the
    artifact at /a/<short_id> and gets a 200 with the rendered shell."""
    owner_email = _email()
    viewer_email = _email()

    with _client(owner_email) as owner:
        r = owner.post(
            "/api/artifacts",
            files={"file": ("a.html", b"<h1>seen by viewer</h1>", "text/html")},
            data={"name": "Cross-user viewable"},
        )
        sid = r.json()["short_id"]

    with _client(viewer_email) as viewer:
        r = viewer.get(f"/a/{sid}")
        assert r.status_code == 200, r.text
        # Shell + iframe sandbox attribute present and lacking allow-same-origin.
        text = r.text
        assert 'sandbox="allow-scripts allow-popups allow-forms"' in text
        assert "allow-same-origin" not in text
        # Shell carries the spec-required headers.
        assert r.headers.get("x-frame-options") == "SAMEORIGIN"
        assert r.headers.get("referrer-policy") == "same-origin"
        assert "no-store" in r.headers.get("cache-control", "")


# ── 2b: private visibility is owner-only ───────────────────────────────


def test_view_artifact_private_owner_only():
    """visibility=private — the owner gets 200, but any *other* signed-in
    wiki user gets the generic 404 (existence isn't leaked). Mirrors the
    soft-deleted 404 behaviour."""
    owner_email = _email()
    other_email = _email()

    with _client(owner_email) as owner:
        sid = owner.post(
            "/api/artifacts",
            files={"file": ("pr.html", b"<h1>owner eyes only</h1>", "text/html")},
            data={"name": "Private artifact", "visibility": "private"},
        ).json()["short_id"]
        # Owner can view their own private artifact.
        assert owner.get(f"/a/{sid}").status_code == 200

    # A different authenticated wiki user is refused with a generic 404.
    with _client(other_email) as other:
        r = other.get(f"/a/{sid}")
        assert r.status_code == 404, r.text
        assert "not available" in r.text


# ── 3: unauthenticated → 302 to login ──────────────────────────────────


def test_view_artifact_unauthenticated_redirects():
    """spec § 11 #3 — no session cookie → 302 to /login?next=…"""
    with _client(_email()) as owner:
        r = owner.post(
            "/api/artifacts",
            files={"file": ("u.html", b"<h1>unauth</h1>", "text/html")},
            data={"name": "Unauth bounce"},
        )
        sid = r.json()["short_id"]

    # No `X-User-Email` header at all → backend has no authenticated user.
    with _client(None) as anon:
        r = anon.get(f"/a/{sid}")
        assert r.status_code == 302
        loc = r.headers.get("location", "")
        assert "/login" in loc
        assert f"next=/a/{sid}" in loc


# ── 4: soft-deleted → 404 (not 410 / 403) ──────────────────────────────


def test_view_deleted_artifact_404():
    """spec § 11 #4 — soft-deleted artifact returns generic 404, not a
    leak-y 410 / 403 that would let a probe distinguish 'existed once'."""
    email = _email()
    with _client(email) as c:
        sid = c.post(
            "/api/artifacts",
            files={"file": ("d.html", b"<h1>delete me</h1>", "text/html")},
            data={"name": "To be soft-deleted"},
        ).json()["short_id"]
        assert c.delete(f"/api/artifacts/{sid}").status_code == 204
        # Now the viewer route returns the generic 404.
        r = c.get(f"/a/{sid}")
        assert r.status_code == 404
        assert "not available" in r.text


# ── 5: expired → 404 ───────────────────────────────────────────────────


def test_view_expired_artifact_404():
    """spec § 11 #5 — past expires_at → generic 404, same as deleted."""
    email = _email()
    with _client(email) as c:
        # Expire in the past via PATCH; create endpoint accepts ISO but
        # post-create PATCH is the simplest way to force a past date.
        sid = c.post(
            "/api/artifacts",
            files={"file": ("e.html", b"<h1>expire</h1>", "text/html")},
            data={"name": "Expires immediately"},
        ).json()["short_id"]
        c.patch(
            f"/api/artifacts/{sid}",
            json={"expires_at": "2000-01-01T00:00:00Z"},
        )
        r = c.get(f"/a/{sid}")
        assert r.status_code == 404


# ── 6: body > limit → 413 ──────────────────────────────────────────────


def test_max_body_size_enforced():
    """spec § 11 #6 — body larger than ARTIFACTS_MAX_BODY_BYTES → 413."""
    # The default cap is 10 MiB. Send 11 MiB so we trip it cleanly.
    big = b"A" * (11 * 1024 * 1024)
    with _client(_email()) as c:
        r = c.post(
            "/api/artifacts",
            files={"file": ("big.html", big, "text/html")},
            data={"name": "Too big"},
        )
        assert r.status_code == 413, r.text


# ── 7: public visibility is gated by ARTIFACTS_ALLOW_PUBLIC ─────────────


def test_public_visibility_flag_behavior():
    """spec § 11 #7 — visibility=public is gated by ARTIFACTS_ALLOW_PUBLIC.

    There's no config probe over the API, so we accept either outcome and
    assert the matching invariant:
      - flag OFF → publish returns 403 (blocked).
      - flag ON  → publish returns 201 AND the artifact is viewable with
        no auth at all (the whole point of `public`)."""
    with _client(_email()) as c:
        r = c.post(
            "/api/artifacts",
            files={"file": ("p.html", b"<h1>pub</h1>", "text/html")},
            data={"name": "Public attempt", "visibility": "public"},
        )
        assert r.status_code in (201, 403), r.text
        if r.status_code == 403:
            return  # flag off — blocked as expected
        sid = r.json()["short_id"]

    # flag on — a public artifact is viewable by an anonymous visitor.
    with _client(None) as anon:
        assert anon.get(f"/a/{sid}").status_code == 200

    # …and it shows up in the no-auth public listing.
    with _client(None) as anon:
        listing = anon.get("/api/artifacts/public?limit=100").json()
        assert sid in {i["short_id"] for i in listing["items"]}


# ── 8: iframe sandbox attributes correct ───────────────────────────────


def test_iframe_sandbox_attributes():
    """spec § 11 #8 — shell HTML contains sandbox without allow-same-origin."""
    email = _email()
    with _client(email) as c:
        sid = c.post(
            "/api/artifacts",
            files={"file": ("s.html", b"<h1>sandbox check</h1>", "text/html")},
            data={"name": "Sandbox attr check"},
        ).json()["short_id"]
        r = c.get(f"/a/{sid}")
        assert r.status_code == 200
        # Sandbox attribute is the security boundary. The exact string
        # is checked because adding allow-same-origin would undo the
        # session-cookie isolation that the auth gate depends on.
        assert 'sandbox="allow-scripts allow-popups allow-forms"' in r.text
        assert "allow-same-origin" not in r.text


# ── 9: MCP publish ownership matches token's user ──────────────────────


def test_mcp_publish_artifact_tool():
    """spec § 11 #9 — MCP bearer can publish; resulting owner_id matches
    the token's user. We're operating off the same DB the dev container
    uses, so the test plumbs an api_tokens row directly (the
    `POST /api/mcp-tokens` endpoint has a pre-existing 500 unrelated to
    artifacts — flagged in the commit-4 message)."""
    import os
    import psycopg

    # The conn string is the same DSN the backend uses (translated for
    # psycopg's sync driver). DATABASE_URL is set by docker-compose.
    dsn = os.environ.get(
        "DATABASE_URL",
        "postgresql+asyncpg://wiki:wiki@db:5432/wiki",
    ).replace("postgresql+asyncpg://", "postgresql://")

    email = _email()
    # Make a user first by hitting any auth-required endpoint with the
    # stub email — `auto_create_on_first_sight` will insert the row.
    with _client(email) as c:
        whoami = c.get("/api/auth/whoami")
        if whoami.status_code != 200:
            pytest.skip(f"stub auth not configured: /auth/whoami → {whoami.status_code}")
        user_id = whoami.json()["id"]

    raw_token = f"wt_pytest_{uuid.uuid4().hex[:12]}"
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    try:
        import psycopg
    except ImportError:
        pytest.skip("psycopg not installed; skipping MCP-via-SQL test")
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute(
            "INSERT INTO api_tokens (user_id, name, token_hash, created_at) "
            "VALUES (%s, %s, %s, now())",
            (user_id, "pytest-mcp-token", token_hash),
        )

    with httpx.Client(
        base_url=BASE_URL,
        headers={"Authorization": f"Bearer {raw_token}"},
        timeout=10.0,
    ) as mcp:
        r = mcp.post(
            "/mcp",
            json={
                "jsonrpc": "2.0", "id": 1, "method": "tools/call",
                "params": {
                    "name": "publish_artifact",
                    "arguments": {
                        "name": "Via MCP test",
                        "body": "<h1>hello mcp</h1>",
                        "mime_type": "text/html",
                    },
                },
            },
        )
        assert r.status_code == 200, r.text
        import json as _json
        payload = _json.loads(r.json()["result"]["content"][0]["text"])
        short_id = payload["short_id"]

    # Confirm owner_id matches the MCP token's user.
    with _client(email) as c:
        meta = c.get(f"/api/artifacts/{short_id}").json()
        assert meta["owner_id"] == user_id


# ── 10: access log row written on view ─────────────────────────────────


def test_access_log_recorded():
    """spec § 11 #10 — viewing an artifact creates an ArtifactAccessLog
    row with the viewer's user_id (not the owner's). Owner reads the
    log via /api/artifacts/{sid}/access-log."""
    owner_email = _email()
    viewer_email = _email()

    with _client(owner_email) as owner:
        sid = owner.post(
            "/api/artifacts",
            files={"file": ("al.html", b"<h1>logme</h1>", "text/html")},
            data={"name": "Access-log target"},
        ).json()["short_id"]

    with _client(viewer_email) as viewer:
        # whoami first so the user row exists, then view the shell.
        viewer_id = viewer.get("/api/auth/whoami").json()["id"]
        assert viewer.get(f"/a/{sid}").status_code == 200

    with _client(owner_email) as owner:
        logs = owner.get(f"/api/artifacts/{sid}/access-log").json()
        assert logs["total"] >= 1
        viewer_ids = {row["user_id"] for row in logs["items"]}
        assert viewer_id in viewer_ids


# ── 11: directory bundle publish + asset serving ───────────────────────


def test_bundle_publish_and_serve():
    """A zipped directory publishes as one artifact and serves its files at
    /a/<sid>/<path>. Missing index.html is rejected; /raw and missing
    members 404."""
    import io
    import zipfile

    email = _email()

    # Bundle without index.html → 400.
    bad = io.BytesIO()
    with zipfile.ZipFile(bad, "w") as zf:
        zf.writestr("style.css", "h1{color:red}")
    with _client(email) as c:
        r = c.post(
            "/api/artifacts/bundle",
            files={"file": ("site.zip", bad.getvalue(), "application/zip")},
            data={"name": "No index", "visibility": "wiki"},
        )
        assert r.status_code == 400, r.text

    # Valid bundle: index.html + a relative asset.
    good = io.BytesIO()
    with zipfile.ZipFile(good, "w") as zf:
        zf.writestr("index.html", '<link rel="stylesheet" href="style.css"><h1>hi</h1>')
        zf.writestr("style.css", "h1{color:rebeccapurple}")
    with _client(email) as c:
        r = c.post(
            "/api/artifacts/bundle",
            files={"file": ("site.zip", good.getvalue(), "application/zip")},
            data={"name": "Bundle", "visibility": "wiki"},
        )
        assert r.status_code == 201, r.text
        sid = r.json()["short_id"]

        # Shell renders as an iframe pointing at the bundle's index.html.
        shell = c.get(f"/a/{sid}")
        assert shell.status_code == 200
        assert f"/a/{sid}/index.html" in shell.text

        # Assets serve from the zip with correct content types.
        idx = c.get(f"/a/{sid}/index.html")
        assert idx.status_code == 200
        assert "text/html" in idx.headers.get("content-type", "")
        css = c.get(f"/a/{sid}/style.css")
        assert css.status_code == 200
        assert "text/css" in css.headers.get("content-type", "")

        # /raw is meaningless for a bundle; a missing member is a generic 404.
        assert c.get(f"/a/{sid}/raw").status_code == 404
        assert c.get(f"/a/{sid}/nope.js").status_code == 404
