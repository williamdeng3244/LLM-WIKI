"""[API] Security regression tests — the stored-XSS surface (markdown + artifacts).

The wiki renders user-authored content. These lock the CURRENTLY-SAFE behavior so
a future change (enabling raw-HTML passthrough / rehype-raw, flipping markdown-it
`html=True`, or dropping the iframe sandbox) FAILS a test instead of silently
re-opening stored XSS.

Surfaces:
  - `render_markdown_to_html` (server-side artifact markdown) escapes raw HTML.
  - The `/a/<short_id>` viewer renders a `<script>` markdown body as inert text.
  - HTML artifacts are isolated in a sandboxed iframe WITHOUT `allow-same-origin`.
  - The artifact name is html-escaped in the outer shell.
  - markdown-it neutralizes `javascript:` links.
"""
from __future__ import annotations

from app.services.markdown_render import render_markdown_to_html

# Distinctive markers so we can tell the *body's* payload apart from the
# viewer shell's own (legitimate) theme-toggle <script>.
XSS_MD = (
    "# Heading\n\n"
    "<script>alert('XSSPROBE_SCRIPT')</script>\n\n"
    "<img src=x onerror=\"alert('XSSPROBE_IMG')\">\n\n"
    "[click me](javascript:alert('XSSPROBE_LINK'))\n"
)


# ── Unit: the server-side renderer escapes raw HTML ──────────────────────────

def test_render_markdown_escapes_raw_html():
    out = render_markdown_to_html(XSS_MD).lower()
    # Raw tags must be escaped (appear only as &lt;script / &lt;img), never live.
    assert "<script" not in out, out
    assert "<img" not in out, out
    # …but the content survives as (inert) escaped text.
    assert "xssprobe_script" in out


def test_render_markdown_neutralizes_javascript_links():
    out = render_markdown_to_html(XSS_MD).lower()
    # markdown-it's validateLink rejects javascript: URLs, so they never become a
    # live href (the literal text may survive inside a <p>, which is inert). We
    # assert the *dangerous* form — an actual href — is absent.
    assert 'href="javascript:' not in out, f"javascript: href created: {out}"
    assert "href='javascript:" not in out, f"javascript: href created: {out}"


# ── Viewer: markdown artifact renders the payload inert ──────────────────────

def _create_artifact(client, name, body: bytes, content_type="text/markdown"):
    return client.post(
        "/api/artifacts",
        files={"file": (f"{name}.md", body, content_type)},
        data={"name": name},
    )


def test_xss_markdown_artifact_viewer_escapes_script(contributor):
    """A markdown artifact whose body contains <script> renders escaped in the
    /a/<short_id> viewer — not as an executable element."""
    r = _create_artifact(contributor, "xss-probe", XSS_MD.encode())
    assert r.status_code in (200, 201), r.text
    sid = r.json()["short_id"]
    v = contributor.get(f"/a/{sid}", follow_redirects=True)
    assert v.status_code == 200, v.text
    h = v.text.lower()
    # the body's payload must NOT appear in live form
    assert "<script>alert('xssprobe_script')" not in h, "raw <script> leaked into viewer"
    assert 'onerror="alert' not in h, "live onerror handler leaked into viewer"
    # but it is present as inert escaped text (proves it round-tripped, just dead)
    assert "xssprobe_script" in h


def test_xss_html_artifact_is_sandboxed_iframe(contributor):
    """An HTML artifact (which legitimately may carry scripts) is isolated in a
    sandboxed iframe WITHOUT allow-same-origin, so its scripts can't reach the
    session/parent. Locks the load-bearing sandbox string."""
    body = b"<html><body><script>document.title='pwned'</script>hi</body></html>"
    r = _create_artifact(contributor, "xss-html", body, content_type="text/html")
    assert r.status_code in (200, 201), r.text
    sid = r.json()["short_id"]
    v = contributor.get(f"/a/{sid}", follow_redirects=True)
    assert v.status_code == 200, v.text
    h = v.text
    assert "<iframe" in h.lower(), "HTML artifact must render inside an iframe"
    assert 'sandbox="allow-scripts allow-popups allow-forms"' in h, "exact sandbox string missing"
    assert "allow-same-origin" not in h, "iframe must NOT grant allow-same-origin"


def test_xss_artifact_name_is_escaped_in_shell(contributor):
    """A <script> in the artifact NAME is html-escaped in the outer shell."""
    r = _create_artifact(contributor, "<script>alert('XSSNAME')</script>", b"# ok\n")
    assert r.status_code in (200, 201), r.text
    sid = r.json()["short_id"]
    v = contributor.get(f"/a/{sid}", follow_redirects=True)
    assert v.status_code == 200
    assert "<script>alert('xssname')" not in v.text.lower(), "artifact name not escaped in shell"
