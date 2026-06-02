# Gated artifacts

Self-contained HTML / Markdown / plain-text payloads published behind
the wiki's auth boundary, addressable at `/a/<short_id>`. Modeled after
[display.dev](https://display.dev) and
[Flowershow](https://github.com/flowershow/flowershow) sharing.

An **Artifact** is a sibling concept to a wiki **Page** — it has its own
table, its own URL space, and its own UI. It does **not** enter the
page review queue, and editing a wiki page does **not** retroactively
change an artifact snapshotted from it.

## Why

Two recurring patterns at most teams:

1. A teammate authors an HTML dashboard / D3 chart / one-off report and
   needs to share it with the company. Pasting it into a wiki page
   strips the JavaScript. Hosting it on a third-party service moves it
   outside the company's auth boundary.
2. An LLM tool (Claude, Cursor) needs to hand the user a viewable link
   to something it just generated, without making the user open an
   attachment.

Artifacts solve both. The viewer is auth-gated by the same login the
rest of the wiki uses, and the body is rendered exactly as authored —
inside a sandboxed iframe for HTML, or server-rendered for Markdown.

## How to publish

### From the wiki UI

- **Right-click any page** in the file tree → **Publish as gated link**.
  The modal pre-fills the page title. Submit with defaults → the URL
  appears with **Copy link** and **Open** buttons.
- **Upload a stand-alone file** (HTML / Markdown / plain text): hit the
  `Share2` icon in the top bar to open the **Artifacts** panel, then
  click **Upload**.

### From Claude Code / Cursor (MCP)

The MCP server exposes three tools:

| Tool | Args | Returns |
|---|---|---|
| `publish_artifact` | `name`, `body`, `mime_type`, `visibility`, `expires_in_days` | `{short_id, url, version}` |
| `update_artifact` | `short_id`, `body`, `mime_type` (optional) | `{short_id, url, version}` |
| `list_my_artifacts` | `limit` (optional) | array of metadata |

The MCP token authenticates as its owner; the artifact's `owner_id`
matches that user.

### From the REST API

```http
POST /api/artifacts                    # multipart upload
POST /api/artifacts/from-page/{path}   # snapshot a wiki page
POST /api/artifacts/{sid}/versions     # add a new version (owner+admin)
GET  /api/artifacts                    # list your own
GET  /api/artifacts/{sid}              # metadata
PATCH/api/artifacts/{sid}              # rename / visibility / expiry
DELETE /api/artifacts/{sid}            # soft delete
GET  /api/artifacts/{sid}/access-log   # who viewed, when
```

Admin-only:

```http
GET    /api/admin/artifacts            # all artifacts, including soft-deleted
DELETE /api/admin/artifacts/{sid}      # hard delete (rows + blobs)
```

## Security model

The viewer at `/a/<short_id>` is the only public surface that returns
artifact bodies. It implements three guarantees:

1. **Auth gate.** Missing / unknown / soft-deleted / expired artifacts
   all return a **generic 404** — a probe cannot distinguish "never
   existed" from "was deleted" from "expired yesterday." Unauthenticated
   requests for non-public artifacts get a **302 → /login?next=/a/<sid>**.
2. **iframe sandbox** for HTML artifacts. The shell page loads the body
   in an iframe whose `sandbox` attribute is exactly:

   ```
   sandbox="allow-scripts allow-popups allow-forms"
   ```

   The omitted `allow-same-origin` is what isolates the artifact's
   JavaScript from the wiki session cookie — even though both are on
   the same host. A sandboxed iframe without `allow-same-origin` is
   treated by the browser as a unique origin and **cannot** read
   `document.cookie` / `localStorage` / `IndexedDB` from the parent.
3. **CSP on the raw body**. The `/a/<sid>/raw` endpoint carries:

   ```
   Content-Security-Policy:
     default-src 'self';
     script-src 'unsafe-inline' 'unsafe-eval' https: data:;
     style-src 'unsafe-inline' https: data:;
     img-src * data: blob:;
     font-src * data:;
     connect-src * data:;
     form-action 'self';
   ```

   This is intentionally permissive for inline scripts / styles (real
   artifacts need them — D3 charts, Tailwind via CDN, Observable
   embeds) but blocks form submissions to third-party origins.

The shell page additionally sets:

| Header | Value | Why |
|---|---|---|
| `X-Frame-Options` | `SAMEORIGIN` | Third-party sites can't embed the shell. |
| `Referrer-Policy` | `same-origin` | Links inside the artifact don't leak the wiki host. |
| `Cache-Control` | `private, no-store` | Intermediaries don't cache auth-gated bodies. |

Every successful shell view records a row in `artifact_access_log` with
the **viewer's** `user_id` (not the owner's). The owner can read the
log at `GET /api/artifacts/{sid}/access-log`.

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `ARTIFACTS_STORAGE_DIR` | `/data/artifacts` | Where blobs are written. v1 = local disk; the storage class is S3-swappable. |
| `ARTIFACTS_MAX_BODY_BYTES` | `10485760` (10 MiB) | Per-body hard cap. Server enforces, returns 413. |
| `ARTIFACTS_ALLOW_PUBLIC` | `false` | Gate the `visibility=public` value. When `false`, the publish endpoints return 403 for that visibility. |
| `ARTIFACTS_DEFAULT_EXPIRY_DAYS` | unset | Blank = never expire. Set to apply a default expiration to artifacts whose creator didn't pick one. |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | Base of the share-link URL returned by the API + MCP tools. |

Set `ARTIFACTS_ALLOW_PUBLIC=true` only after you understand the
implications — visibility=public means the artifact body is served to
anyone who can reach the wiki host, with no auth check at all.

## Limits and non-goals (v1)

- **No comments** on artifacts (yet). We'll reuse the existing
  `comments` model when this lands.
- **No promote-to-page** (yet). Artifacts are one-way; the source page
  remains the editable surface.
- **Per-user rate limit** is a follow-up commit. A small `redis.asyncio`
  INCR + EXPIRE module will land separately; until then, publish
  endpoints are unthrottled. See `routers/artifacts.py` docstring.
- **`visibility=specific`** (only listed users) is in the schema but
  the UI / enforcement is not wired. The column accepts the value;
  the viewer treats it as `company` today.

## Verifying the security checklist

Run the test suite:

```bash
docker exec wiki-backend-1 pytest tests/test_artifacts.py -v
```

The ten tests in `backend/tests/test_artifacts.py` map 1-to-1 onto
spec § 11; each docstring cites the spec test name. Key behaviors
asserted:

- The exact sandbox attribute string (no `allow-same-origin`)
- Generic 404 for missing / deleted / expired
- 302 to `/login?next=…` for unauthenticated
- 413 on body > limit
- 403 on `visibility=public` when the flag is off
- Access log row written with the **viewer's** `user_id`
- MCP publish creates an artifact whose `owner_id` matches the token's user
