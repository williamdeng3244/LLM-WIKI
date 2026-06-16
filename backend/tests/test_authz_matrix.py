"""[API] Authorization matrix — a systematic role x endpoint sweep.

Complements the per-FR auth tests with a broad sweep proving (a) no mutation
endpoint is reachable unauthenticated, and (b) admin-only endpoints reject a
non-admin. Catches a route that forgets its auth / role dependency.

Params are made valid where required so the ONLY possible rejection reason is
authorization (not a 422 for a missing field).
"""
from __future__ import annotations

import pytest

# (method, path, json_body) — mutations that MUST require authentication.
MUTATIONS = [
    ("POST", "/api/pages/draft",
     {"title": "t", "body": "b", "new_page": {"path": "azmx/x", "stability": "open"}}),
    ("POST", "/api/admin/lint/run", None),
    ("PUT", "/api/admin/idea-file", {"content": "x"}),
    ("POST", "/api/users/1/role?role=editor", None),
    ("POST", "/api/users/1/deactivate", None),
    ("POST", "/api/users/1/mcp-access?enabled=false", None),
    ("PATCH", "/api/pages/azmx/y/path", {"new_path": "azmx/z"}),
    ("DELETE", "/api/pages/azmx/y", None),
    ("POST", "/api/pages/azmx/y/lock", {"locked": True}),
]


@pytest.mark.parametrize("method,path,body", MUTATIONS)
def test_authz_mutation_requires_auth(anon, method, path, body):
    r = anon.request(method, path, json=body) if body is not None else anon.request(method, path)
    assert r.status_code == 401, f"{method} {path} -> {r.status_code} (anon must be 401)"


# Admin-only endpoints reject a non-admin (editor) with 403.
ADMIN_ONLY = [
    ("POST", "/api/admin/lint/run", None),
    ("PUT", "/api/admin/idea-file", {"content": "x"}),
    ("GET", "/api/admin/lint/reports", None),
    ("GET", "/api/admin/artifacts", None),
    ("POST", "/api/users/1/role?role=editor", None),
    ("POST", "/api/users/1/deactivate", None),
]


@pytest.mark.parametrize("method,path,body", ADMIN_ONLY)
def test_authz_admin_only_rejects_editor(editor, method, path, body):
    r = editor.request(method, path, json=body) if body is not None else editor.request(method, path)
    assert r.status_code == 403, f"{method} {path} as editor -> {r.status_code} (expected 403)"
