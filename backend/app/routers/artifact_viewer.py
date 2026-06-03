"""Gated artifact viewer — the security boundary.

Mounted at the app root (`/a/<short_id>`), NOT under `/api`. Spec § 7.

Two routes:

  GET /a/{token}/raw  → the raw body bytes with strict CSP, used as the
                        iframe `src` for HTML artifacts. Auth-gated
                        identically to the shell.
  GET /a/{token}      → the outer shell (top bar + "Back to wiki" +
                        iframe for HTML or inline rendered Markdown).

`{token}` is `<short_id>` or `<short_id>-<kebab-slug>`; we keep only the
characters up to the first hyphen.

Auth flow:
  1. Resolve the artifact.
  2. If missing / soft-deleted / expired → **generic 404** (spec § 10:
     no existence leak — a probe can't tell deleted from never-existed).
  3. If visibility=public AND ARTIFACTS_ALLOW_PUBLIC=true → skip auth.
  4. Otherwise require an authenticated user (cookie session OR `wt_*`
     token). Missing → **302 to {public_base_url}/login?next=/a/<token>**.
  5. Log the view with the *viewer's* user_id (NOT the owner's — spec § 10).
  6. Return shell (HTML) or inline rendered markdown.

Sandboxing (the load-bearing part — see spec § 10 checklist):
  - The iframe's sandbox attribute is exactly
      sandbox="allow-scripts allow-popups allow-forms"
    with no `allow-same-origin`. That's what isolates artifact JS from
    the wiki session cookie, even though both are on the same origin —
    a sandboxed iframe without `allow-same-origin` is treated as a
    unique origin and can't see document.cookie / localStorage / etc.
  - The shell page carries `X-Frame-Options: SAMEORIGIN` so a third
    party can't embed it.
  - The `/raw` response carries a strict CSP that allows the inline
    scripting/styling artifacts actually need (D3, Tailwind via CDN, …)
    but blocks form submissions to third-party origins.
"""
from __future__ import annotations

import html
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import current_user
from app.core.config import settings
from app.core.db import get_session
from app.models import (
    Artifact, ArtifactAccessLog, ArtifactVersion, Role, User,
    VISIBILITY_PRIVATE, VISIBILITY_PUBLIC,
)
from app.services.artifact_storage import get_storage
from app.services.markdown_render import render_markdown_to_html

router = APIRouter()


async def _viewer_user(
    authorization: Optional[str] = Header(default=None),
    x_user_email: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
    wiki_jwt: Optional[str] = Cookie(default=None),
    wiki_email: Optional[str] = Cookie(default=None),
    wiki_role: Optional[str] = Cookie(default=None),
    session: AsyncSession = Depends(get_session),
) -> Optional[User]:
    """Like `optional_user`, but also accepts identity from cookies.

    The wiki frontend authenticates with a JWT / stub identity it keeps in
    localStorage and attaches as *request headers* on its fetch calls. A
    top-level browser navigation to /a/<short_id> (someone pasting a gated
    link) runs no JS and sends only cookies — so the header path is empty
    and the viewer would always bounce to /login. The frontend mirrors its
    identity into cookies (see `syncAuthCookies` in lib/api.ts); here we
    fall back to them when the headers are absent.

    This is wired ONLY into the read-only viewer GET routes. Mutating
    endpoints keep header-only auth so a cross-site request can't ride the
    cookie (CSRF)."""
    auth = authorization or (f"Bearer {wiki_jwt}" if wiki_jwt else None)
    email = x_user_email or wiki_email
    role = x_user_role or wiki_role
    try:
        return await current_user(auth, email, role, session)
    except HTTPException:
        return None


# ── Token / artifact resolution ────────────────────────────────────────


def _short_id_of(token: str) -> str:
    """`token` is `<short_id>` or `<short_id>-<slug>`. short_id never
    contains a hyphen (see generate_short_id), so split-on-first-hyphen
    is unambiguous."""
    return token.split("-", 1)[0]


async def _load_viewable(
    session: AsyncSession, token: str, *, requested_version: Optional[int],
) -> Optional[tuple[Artifact, ArtifactVersion]]:
    """Resolve `token` to (artifact, version) for viewing. Returns None
    on ANY failure condition — missing, soft-deleted, expired, version
    missing — so the caller renders a generic 404 (no existence leak)."""
    short_id = _short_id_of(token)
    if not short_id:
        return None
    art = (await session.execute(
        select(Artifact).where(Artifact.short_id == short_id)
    )).scalar_one_or_none()
    if art is None or art.deleted_at is not None:
        return None
    if art.expires_at is not None and art.expires_at < datetime.now(timezone.utc):
        return None
    ver_num = requested_version if requested_version is not None else art.current_version
    version = (await session.execute(
        select(ArtifactVersion).where(
            ArtifactVersion.artifact_id == art.id,
            ArtifactVersion.version == ver_num,
        )
    )).scalar_one_or_none()
    if version is None:
        return None
    return art, version


def _login_redirect(token: str) -> RedirectResponse:
    """Send the unauthenticated viewer to the wiki login screen with a
    `next=` bounce-back. Uses PUBLIC_BASE_URL so the redirect works even
    when the backend is hit directly during dev (the frontend hosts the
    login page)."""
    next_path = f"/a/{token}"
    target = f"{settings.public_base_url.rstrip('/')}/login?next={next_path}"
    return RedirectResponse(target, status_code=302)


def _generic_404() -> HTMLResponse:
    """One response shape for missing / deleted / expired. Plain text so
    we don't leak any artifact metadata."""
    return HTMLResponse(
        "<!doctype html><meta charset=utf-8><title>Not found</title>"
        "<p>This artifact is not available.</p>",
        status_code=404,
    )


def _can_view_private(art: Artifact, user: Optional[User]) -> bool:
    """A `private` artifact is viewable only by its owner or an admin.
    Anyone else (including other signed-in wiki users) gets the generic
    404 — same response as a non-existent token, so privacy isn't leaked."""
    if user is None:
        return False
    return art.owner_id == user.id or user.role == Role.admin


def _client_ip(request: Request) -> Optional[str]:
    xff = request.headers.get("X-Forwarded-For")
    if xff:
        # First entry is the originating client; the rest are proxies.
        return xff.split(",")[0].strip()[:64] or None
    return (request.client.host[:64] if request.client else None)


async def _record_access(
    session: AsyncSession,
    *,
    artifact: Artifact,
    version: int,
    user: Optional[User],
    request: Request,
) -> None:
    """Append an ArtifactAccessLog row. user_id can be None for public
    anonymous views; it's the *viewer's* id when authenticated, not the
    artifact owner's — that distinction is the security-relevant one."""
    log = ArtifactAccessLog(
        artifact_id=artifact.id,
        user_id=(user.id if user is not None else None),
        version=version,
        ip=_client_ip(request),
        user_agent=(request.headers.get("User-Agent") or "")[:500] or None,
    )
    session.add(log)
    await session.commit()


# ── Shell rendering ────────────────────────────────────────────────────


_SHELL_CSS = """
:root {
  color-scheme: light dark;
  --bg: #0b0f1a;
  --panel: rgba(255,255,255,0.04);
  --border: rgba(255,255,255,0.08);
  --ink: #e6e9f2;
  --muted: #9aa1b8;
  --accent: #82a4ff;
}
/* Light values: applied when the user explicitly picks light, OR (no
   explicit choice) when the OS prefers light. An explicit data-theme
   always wins over the media query. */
[data-theme="light"] {
  --bg: #f7f8fb;
  --panel: rgba(0,0,0,0.03);
  --border: rgba(0,0,0,0.10);
  --ink: #1a1f2e;
  --muted: #5a6273;
  --accent: #3a63d9;
}
@media (prefers-color-scheme: light) {
  :root:not([data-theme]) {
    --bg: #f7f8fb;
    --panel: rgba(0,0,0,0.03);
    --border: rgba(0,0,0,0.10);
    --ink: #1a1f2e;
    --muted: #5a6273;
    --accent: #3a63d9;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
/* Hide scrollbars everywhere but keep scrolling — the page scrolls
   without a visible bar. */
html { scrollbar-width: none; }
html::-webkit-scrollbar, body::-webkit-scrollbar { width: 0; height: 0; display: none; }
body {
  background: var(--bg); color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
header.shell {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 16px; border-bottom: 1px solid var(--border);
  background: var(--panel); backdrop-filter: blur(6px);
  font-size: 13px;
  position: sticky; top: 0; z-index: 5;
}
header.shell .title { font-weight: 600; }
header.shell .meta { color: var(--muted); }
header.shell .spacer { flex: 1; }
header.shell a, header.shell button {
  color: var(--accent); background: transparent; border: 0;
  font: inherit; cursor: pointer; text-decoration: none;
  padding: 4px 8px; border-radius: 4px; line-height: 1;
}
header.shell a:hover, header.shell button:hover { background: var(--border); }
header.shell button.icon { font-size: 15px; }

/* ── Document mode (Markdown / text): one natural, scrollbar-free page ── */
body.mode-doc article.shell {
  padding: 32px 24px 64px; max-width: 820px; margin: 0 auto; line-height: 1.6;
}
article.shell pre {
  background: var(--panel); padding: 12px; border-radius: 6px; overflow: auto;
}
article.shell code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
article.shell a { color: var(--accent); }

/* ── Frame mode (HTML): the sandboxed iframe fills the viewport. ── */
body.mode-frame { height: 100dvh; display: flex; flex-direction: column; overflow: hidden; }
body.mode-frame main.shell { flex: 1; min-height: 0; display: flex; }
body.mode-frame main.shell iframe { flex: 1; width: 100%; border: 0; background: #fff; }
""".strip()


# The sandbox attribute is load-bearing — keep this exact string and
# never add `allow-same-origin` (see spec § 10 + the header docstring).
_IFRAME_SANDBOX = "allow-scripts allow-popups allow-forms"

# Light/dark toggle for the shell (NOT the sandboxed iframe — this runs in
# our own top-level document). `_THEME_INIT_JS` runs in <head> to set the
# saved theme before first paint (no flash); `_THEME_TOGGLE_JS` wires the
# button + persists the choice in localStorage.
_THEME_INIT_JS = (
    "(function(){try{var s=localStorage.getItem('dsp:art:theme');"
    "if(s==='light'||s==='dark')"
    "document.documentElement.setAttribute('data-theme',s);}catch(e){}})();"
)
_THEME_TOGGLE_JS = (
    "function dspTheme(){var r=document.documentElement;return r.getAttribute('data-theme')"
    "||((window.matchMedia&&matchMedia('(prefers-color-scheme: light)').matches)?'light':'dark');}"
    "function dspSyncThemeBtn(){var b=document.getElementById('dspThemeBtn');"
    "if(b)b.textContent=dspTheme()==='light'?'\\u263E':'\\u2600';}"
    "function dspToggleTheme(){var next=dspTheme()==='light'?'dark':'light';"
    "document.documentElement.setAttribute('data-theme',next);"
    "try{localStorage.setItem('dsp:art:theme',next);}catch(e){}dspSyncThemeBtn();}"
    "dspSyncThemeBtn();"
)


def _shell_html(
    *, artifact: Artifact, version: int, owner_email: str,
    inner: str, is_iframe: bool,
) -> str:
    name = html.escape(artifact.name)
    owner = html.escape(owner_email or "(unknown)")
    base = settings.public_base_url.rstrip("/")
    artifacts_url = html.escape((base or "") + "/artifacts")
    body_class = "mode-frame" if is_iframe else "mode-doc"
    body_inner = inner if is_iframe else f'<article class="shell">{inner}</article>'
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{name}</title>
  <style>{_SHELL_CSS}</style>
  <script>{_THEME_INIT_JS}</script>
</head>
<body class="{body_class}">
  <header class="shell">
    <span class="title">{name}</span>
    <span class="meta">v{version}</span>
    <span class="meta">·</span>
    <span class="meta">Shared by {owner}</span>
    <span class="spacer"></span>
    <button id="dspThemeBtn" class="icon" onclick="dspToggleTheme()" title="Light / dark" aria-label="Toggle theme">☀</button>
    <a href="{artifacts_url}">← Artifacts</a>
    <button onclick="navigator.clipboard.writeText(window.location.href)">Copy link</button>
  </header>
  {body_inner}
  <script>{_THEME_TOGGLE_JS}</script>
</body>
</html>"""


# ── Endpoints ──────────────────────────────────────────────────────────


_SHELL_HEADERS = {
    # Spec § 7. SAMEORIGIN means third-party sites can't embed the shell.
    "X-Frame-Options": "SAMEORIGIN",
    # Hide the referring URL when the user clicks a link inside the
    # artifact — don't tell third-party sites the wiki host.
    "Referrer-Policy": "same-origin",
    # Don't let intermediaries cache an artifact body; the auth gate
    # decides visibility on every request.
    "Cache-Control": "private, no-store",
}

# Strict CSP for the raw body. Allows the inline JS/CSS real artifacts
# need (D3 charts, Observable embeds, Tailwind via CDN) while blocking
# form submissions to third-party origins — see spec § 10.
_RAW_CSP = (
    "default-src 'self'; "
    "script-src 'unsafe-inline' 'unsafe-eval' https: data:; "
    "style-src 'unsafe-inline' https: data:; "
    "img-src * data: blob:; "
    "font-src * data:; "
    "connect-src * data:; "
    "form-action 'self';"
)


@router.get("/{token}/raw")
async def view_raw(
    token: str,
    request: Request,
    v: Optional[int] = None,
    session: AsyncSession = Depends(get_session),
    user: Optional[User] = Depends(_viewer_user),
):
    """Body bytes for the iframe `src`. Auth-gated identically to the
    shell — otherwise a sandboxed iframe is meaningless."""
    pair = await _load_viewable(session, token, requested_version=v)
    if pair is None:
        return _generic_404()
    art, version = pair
    # A bundle has no single "raw" body — its files come from /{path}.
    if art.is_bundle:
        return _generic_404()

    if art.visibility != VISIBILITY_PUBLIC or not settings.artifacts_allow_public:
        if user is None:
            return _login_redirect(token)
    if art.visibility == VISIBILITY_PRIVATE and not _can_view_private(art, user):
        return _generic_404()

    body = await get_storage().load(version.storage_path)
    # NOTE: we deliberately don't log access from /raw — only the shell
    # logs once. /raw fires whenever the iframe re-renders / the user
    # refreshes, and double-counting would skew "views_7d".

    media = art.mime_type if art.mime_type.startswith("text/") else "text/plain"
    return Response(
        content=body,
        media_type=f"{media}; charset=utf-8",
        headers={
            "Content-Security-Policy": _RAW_CSP,
            **_SHELL_HEADERS,
        },
    )


@router.get("/{token}")
async def view_shell(
    token: str,
    request: Request,
    v: Optional[int] = None,
    session: AsyncSession = Depends(get_session),
    user: Optional[User] = Depends(_viewer_user),
):
    pair = await _load_viewable(session, token, requested_version=v)
    if pair is None:
        return _generic_404()
    art, version = pair

    is_public_view = (
        art.visibility == VISIBILITY_PUBLIC and settings.artifacts_allow_public
    )
    if not is_public_view and user is None:
        return _login_redirect(token)
    if art.visibility == VISIBILITY_PRIVATE and not _can_view_private(art, user):
        return _generic_404()

    await _record_access(
        session, artifact=art, version=version.version,
        user=user, request=request,
    )

    owner_email = ""
    if art.owner_id is not None:
        owner = await session.get(User, art.owner_id)
        if owner is not None:
            owner_email = owner.email

    if art.mime_type == "text/html":
        # The iframe URL preserves the version pin if one was requested
        # so refreshing the inner frame doesn't silently jump to current.
        # Bundles are served from the zip at /a/<sid>/index.html (relative
        # assets resolve against it); single files come from /raw.
        raw_path = (
            f"/a/{art.short_id}/index.html" if art.is_bundle
            else f"/a/{art.short_id}/raw"
        )
        if v is not None:
            raw_path += f"?v={v}"
        inner = (
            f'<main class="shell">'
            f'  <iframe src="{html.escape(raw_path)}" '
            f'          sandbox="{_IFRAME_SANDBOX}" '
            f'          referrerpolicy="same-origin" '
            f'          allow="clipboard-read; clipboard-write"></iframe>'
            f'</main>'
        )
        shell = _shell_html(
            artifact=art, version=version.version, owner_email=owner_email,
            inner=inner, is_iframe=True,
        )
    elif art.mime_type == "text/markdown":
        body = (await get_storage().load(version.storage_path)).decode("utf-8", "replace")
        rendered = render_markdown_to_html(body)
        shell = _shell_html(
            artifact=art, version=version.version, owner_email=owner_email,
            inner=rendered, is_iframe=False,
        )
    else:  # text/plain (or any other text/*)
        body = (await get_storage().load(version.storage_path)).decode("utf-8", "replace")
        shell = _shell_html(
            artifact=art, version=version.version, owner_email=owner_email,
            inner=f"<pre>{html.escape(body)}</pre>", is_iframe=False,
        )

    return HTMLResponse(shell, headers=_SHELL_HEADERS)


@router.get("/{token}/{asset_path:path}")
async def view_bundle_asset(
    token: str,
    asset_path: str,
    request: Request,
    v: Optional[int] = None,
    session: AsyncSession = Depends(get_session),
    user: Optional[User] = Depends(_viewer_user),
):
    """Serve one file out of a directory-bundle artifact's zip.

    Declared last so the literal `/{token}/raw` and the exact `/{token}`
    shell match first. Same auth gate as the shell; path-traversal-safe —
    only exact zip members are served, never arbitrary filesystem paths."""
    import io
    import mimetypes
    import zipfile

    pair = await _load_viewable(session, token, requested_version=v)
    if pair is None:
        return _generic_404()
    art, version = pair
    if not art.is_bundle:
        return _generic_404()

    # Auth gate — identical to the shell / raw body.
    if art.visibility != VISIBILITY_PUBLIC or not settings.artifacts_allow_public:
        if user is None:
            return _login_redirect(token)
    if art.visibility == VISIBILITY_PRIVATE and not _can_view_private(art, user):
        return _generic_404()

    # Resolve the requested member; a bare path or a directory → index.html.
    member = (asset_path or "").replace("\\", "/").lstrip("/")
    if member == "" or member.endswith("/"):
        member = member + "index.html"
    if ".." in member.split("/"):
        return _generic_404()

    zip_bytes = await get_storage().load(version.storage_path)
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
        data = zf.read(member)
    except (zipfile.BadZipFile, KeyError):
        return _generic_404()

    media, _ = mimetypes.guess_type(member)
    media = media or "application/octet-stream"
    if media.startswith("text/") or media in ("application/javascript", "application/json"):
        media += "; charset=utf-8"
    return Response(
        content=data,
        media_type=media,
        headers={"Content-Security-Policy": _RAW_CSP, **_SHELL_HEADERS},
    )
