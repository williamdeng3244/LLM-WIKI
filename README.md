# Enflame Wiki

A self-hosted internal knowledge base that fuses **Karpathy's LLM-Wiki idea**
("Stop Retrieving. Start Compiling.") with **Obsidian's user experience** — and
keeps a real multi-user permission and review workflow underneath.

Three layers, in the spirit of Karpathy's setup:

- **Raw layer** (`raw/`) — immutable input documents (PDFs, markdown, images).
- **Schema layer** (`config/agents.md`) — a markdown playbook injected into the
  agent's context for every ingest and lint pass.
- **Wiki layer** (`vault/` + Postgres) — the compiled, cross-linked knowledge
  base humans and agents collaboratively curate through draft → review →
  publish.

External LLM clients (Claude Desktop, Claude Code, Cursor, …) attach via the
**Model Context Protocol** using a personal token, and operate as the human
user whose token they hold — no separate "agent users".

## What's in the box

- **Web app** — three-pane workspace (file tree · tabbed graph/page view · chat).
- **Tabs · quick switcher · file-tree toolbar · right-click context menus** —
  Obsidian-style navigation throughout.
- **Knowledge graph** — 2D and 3D force-directed views. Live tunable via the
  Graph Settings panel: node size, edge thickness, glow, repel/center/link
  forces, link distance, per-category colors. Drag a node and its neighbors
  follow the spring chain.
- **Plexus / video background** — animated cosmic background with parallax
  rotation tied to graph dragging.
- **Roles + review queue** — reader / contributor / editor / admin. Page
  stability levels (open / stable / locked) gate auto-publish vs. queue.
- **Personal MCP tokens** — connect Claude Desktop / Cursor / etc. to the wiki
  as yourself. Drafts created via MCP route through the existing review queue.
- **Raw → agent → wiki ingest** — drop a PDF or markdown source into the
  Sources panel, click Ingest. Two-phase pipeline:
  1. **Plan** — the agent reads the source, the playbook, and a retrieval
     context, then proposes a structured set of edits with rationale,
     confidence, and source excerpts.
  2. **Apply** — you preview the plan, untick what you don't want, and approve.
     Drafts land in the existing review queue with `force_review=True` (agent
     edits never auto-publish, even on `stability=open` pages). Apply is
     idempotent and retryable; partial failures are recoverable.
- **Reviewer feedback loop** — when an agent draft is rejected, an optional
  reason category + free-text note is captured for future ingest prompts.
- **Lint pipeline** — admin-triggered audit pass: orphans, broken links,
  contradictions, stale claims, source drift. Read-only report; humans act on
  findings via Suggest-edit or Dismiss.
- **Two chat modes** in the right pane:
  - **Sources** — chunk-level RAG, line-range citations.
  - **Wiki** — synthesizes from full pages, follows `[[wikilinks]]` 1-hop,
    cites pages.
- **Markdown export** — `scripts/git-export.sh` mirrors current published state
  to disk for git commit.
- **Local embeddings** — `sentence-transformers/all-MiniLM-L6-v2` runs inside
  the backend container. No second API key needed for retrieval.

## Quickstart

You need **Docker** + **Docker Compose** and a chat-LLM provider (Anthropic
or any OpenAI-compatible endpoint). Nothing else on your host.

```bash
git clone https://github.com/williamdeng3244/LLM-WIKI.git
cd LLM-WIKI
cp .env.example .env
# Edit .env. Either:
#   LLM_PROVIDER=anthropic + ANTHROPIC_API_KEY=sk-ant-…
# or:
#   LLM_PROVIDER=openai + OPENAI_API_KEY=… (+ OPENAI_BASE_URL for non-OpenAI endpoints).
docker compose up --build
```

Then:

- Open <http://localhost:3000>.
- The app starts in **stub auth mode** — you're auto-logged in as admin.
- Use the role switcher in the top-right to view as a different role.
- The seed pages from `vault/` are imported on first boot.
- Try suggesting an edit, reviewing it, asking the chat panel a question, or
  uploading a markdown file in the Sources panel and clicking Ingest.

First boot of the backend container downloads the embedding model
(`all-MiniLM-L6-v2`, ~90 MB) into the container's torch cache. Subsequent
boots reuse it. If you `docker compose down -v` it'll re-download.

## Choosing an LLM provider

The chat panel, the ingest agent, and the lint pass all go through a
single provider abstraction (`backend/app/services/llm_client.py`). Flip
`LLM_PROVIDER` in `.env` and restart `backend` + `worker` — no code change.

### Anthropic (default)

```env
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
CHAT_MODEL=claude-sonnet-4-6
```

### OpenAI

```env
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_CHAT_MODEL=gpt-4o-mini
```

### OpenAI-compatible endpoints

Anything that speaks the Chat Completions API works — set `OPENAI_BASE_URL`
to the alternate endpoint and pick a model your endpoint serves. Tested-shape
configs:

| Provider        | `OPENAI_BASE_URL`                                  | `OPENAI_CHAT_MODEL` example       |
|-----------------|----------------------------------------------------|-----------------------------------|
| Azure OpenAI    | `https://<resource>.openai.azure.com/openai/v1`    | `gpt-4o-mini` (deployment name)   |
| Together AI     | `https://api.together.xyz/v1`                      | `meta-llama/Llama-3.3-70B-Instruct-Turbo` |
| Groq            | `https://api.groq.com/openai/v1`                   | `llama-3.3-70b-versatile`         |
| OpenRouter      | `https://openrouter.ai/api/v1`                     | `anthropic/claude-3.5-sonnet`     |
| DeepSeek        | `https://api.deepseek.com/v1`                      | `deepseek-chat` (V4, supports tools) |
| Moonshot / Kimi | `https://api.moonshot.cn/v1` (CN) · `https://api.moonshot.ai/v1` (intl) | `moonshot-v1-128k` or `kimi-k2-0711-preview` |
| MiniMax         | `https://api.minimaxi.com/v1` (intl) · `https://api.minimax.chat/v1` (legacy) | `MiniMax-Text-01` (new) or `abab6.5s-chat` (legacy) |
| Ollama          | `http://host.docker.internal:11434/v1`             | `llama3.1:8b-instruct`            |
| vLLM            | `http://host.docker.internal:8000/v1`              | depends on served model           |
| LM Studio       | `http://host.docker.internal:1234/v1`              | depends on loaded model           |

Provider-specific notes:

- **DeepSeek** — use `deepseek-chat` for ingest and lint (the alias always
  resolves to the latest chat model — V4 at time of writing). The reasoning
  variant `deepseek-reasoner` does **not** support tool/function calling, so
  it will fail on ingest + lint; it works for chat-only setups but the agent
  surfaces will error out.
- **Moonshot / Kimi** — long-context shines for ingest of large source files
  (`moonshot-v1-128k`); tool calling supported across the v1 series. Use the
  `.cn` endpoint from inside China, `.ai` outside.
- **MiniMax** — `MiniMax-Text-01` is the current default with native function
  calling; the legacy `abab6.5s-chat` also works but `MiniMax-Text-01` is
  preferred for new deployments. International endpoint is `minimaxi.com`,
  legacy China endpoint is `minimax.chat`.

Caveats with non-Anthropic providers:

- **Tool calling is required** for ingest + lint (both use forced function
  calls). Pick a model that supports tools — most modern hosted models do;
  some local models do not.
- **PDF ingest** uses Anthropic's native document block. On OpenAI providers
  the backend falls back to text extraction via `pypdf` — scanned/image-only
  PDFs degrade to "[no extractable text]". Convert to markdown first for best
  results.
- **Image ingest** is sent as a data-URI `image_url` block; only vision-capable
  models will read it.
- Embeddings are local (sentence-transformers, 384-dim) and unaffected by the
  provider switch.

## Connecting Claude Desktop / Claude Code via MCP

The wiki ships a built-in MCP server so any MCP-capable LLM client can attach
and operate on the wiki as you. This is how an "agent" in this system actually
works — not as a wiki-internal user, but as an external client authenticated
with your personal token.

1. In the web app, click the **Plug** icon in the topbar.
2. Click **Create token**, paste a name (e.g. *"Claude Desktop on laptop"*).
3. Copy the **config snippet** the modal shows you. It looks like:

   ```json
   {
     "mcpServers": {
       "enflame-wiki": {
         "url": "http://localhost:8000/mcp",
         "headers": {
           "Authorization": "Bearer wt_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
         }
       }
     }
   }
   ```

4. Open your MCP client config and merge that block in:
   - **Claude Desktop** (macOS): `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Claude Desktop** (Windows): `%APPDATA%\Claude\claude_desktop_config.json`
   - **Cursor**: settings → Tools & Integrations → MCP servers
5. Restart the client. The wiki's tools (`search_wiki`, `get_page`,
   `list_backlinks`, `list_my_drafts`, `list_review_queue`, `create_draft`, …)
   become available.

**Permissions still apply.** A token authorizes as you. If you're a
`contributor`, `create_draft` works but the draft routes through normal
review. If you're a `reader`, write tools return 403.

The token is shown **once**. If you lose it, revoke it and create a new one.
Admin can globally disable MCP via `MCP_ENABLED=false` in `.env`, or revoke
per-user access from the same modal.

## Using the wiki day to day

### Reading + searching

- **Page tabs** — Ctrl/Cmd+T for a new tab; Ctrl/Cmd+W to close. Tabs persist
  across reloads. Right-click a file in the tree → *Open in new tab*.
- **Quick switcher** — Ctrl/Cmd+O. Fuzzy-find any page; recently opened
  surfaces first.
- **Search** — Ctrl/Cmd+K opens a chunk-level search dropdown.
- **Chat panel** (right side):
  - **Sources mode** — chunk-level RAG with line-range citations, best for
    *"where is X documented?"* questions.
  - **Wiki mode** — synthesizes from full pages, follows `[[wikilinks]]`,
    cites pages, best for *"explain this concept"* questions.

### Authoring

- **Suggest edit** (Ctrl/Cmd+E) — opens the propose dialog; submits a draft
  through the review pipeline.
- **Right-click a page tab's kebab menu** for: Backlinks toggle (inline panel),
  Copy path, Open version history, Export to PDF, Reveal in tree, etc.
- **File-tree toolbar** has 6 controls: New note, New folder (creates a
  user-folder placeholder), Sort A↔Z, Collapse/Expand all, 2D Graph, 3D Graph.
- **Custom folders** are user-created top-level categories that persist to
  localStorage; right-click to rename or delete (only if empty).

### Reviewing

- The **Review queue** modal (Inbox icon) shows every revision waiting on you.
- Open a revision → Diff / Preview / Raw view. Comments and decisions go through
  Accept / Request changes / Reject.
- **Agent-authored drafts** show an extra panel with confidence, source quotes
  with locations, conflict notes, and an optional reject-reason dropdown so
  the system can learn from your rejections.

### Uploading + ingesting

- **Sources** modal (Files icon, top bar) — drop PDFs, markdown, plain text,
  images (≤ 50 MB).
- Click **Ingest** on a source. The first time will surface a "this source
  goes to the configured LLM provider" notice. Confirm.
- The plan modal shows up. Untick what you don't want. Approve.
- Drafts land in the Review queue.
- Re-ingest of a source warns about pending drafts and supersedes any
  in-flight plan.

### Linting (admin)

- **ShieldCheck** icon in the topbar (admin-only) → Lint panel.
- Click **Run lint**. The agent reads the wiki + playbook and reports orphans,
  broken links, contradictions, stale claims, and source drift.
- Each issue can be opened on its affected page, suggest-edited, or dismissed
  with an optional note.

### Editing the playbook (admin)

- **BookText** icon in the topbar opens the playbook editor (`config/agents.md`).
- Read-only for non-admins; admin can edit + save. The file is mounted into
  the backend container; updates take effect on the next ingest or lint pass.

## Architecture

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│   Next.js    │──▶│   FastAPI    │──▶│   Postgres   │
│  (frontend)  │   │   (backend)  │   │  + pgvector  │
└──────────────┘   └──────┬───────┘   └──────────────┘
                          │
                   ┌──────▼───────┐   ┌──────────────┐
                   │   Celery     │──▶│    Redis     │
                   │   (worker)   │   │              │
                   └──────────────┘   └──────────────┘

External LLM clients ──MCP─▶ FastAPI /mcp ──▶ wiki tools
```

Five services in `docker-compose.yml`: `db`, `redis`, `backend`, `worker`,
`frontend`. Three host bind mounts: `./vault → /vault` (wiki content
mirror), `./raw → /raw` (raw input documents), `./config → /config` (agent
playbook).

## Permission model

| Role          | Read | Draft | Comment | Review (in-cat) | Lock | Manage |
|---------------|:----:|:-----:|:-------:|:---------------:|:----:|:------:|
| reader        |  ✓   |       |         |                 |      |        |
| contributor   |  ✓   |   ✓   |   ✓     |                 |      |        |
| editor        |  ✓   |   ✓   |   ✓     |       ✓         |      |        |
| admin         |  ✓   |   ✓   |   ✓     |       ✓         |  ✓   |   ✓    |

Each page has a **stability level**:

- **open** — drafts auto-publish on submit (low-stakes).
- **stable** — drafts go to the review queue (default).
- **locked** — only admins can publish.

**Agent-authored drafts always force-review**, even on `stability=open` pages.
The trust dial is for humans only.

Editors are scoped per-category. See `docs/PERMISSIONS.md` for the detailed
reference.

## API surface

About 40 endpoints. Highlights:

| Endpoint                                  | Method | Purpose                                      |
|-------------------------------------------|--------|----------------------------------------------|
| `/api/auth/whoami`                        | GET    | Current user                                 |
| `/api/pages`                              | GET    | List published pages                         |
| `/api/pages/{path}`                       | GET    | Get one page                                 |
| `/api/pages/draft`                        | POST   | Create draft (edit or new page)              |
| `/api/revisions/review-queue`             | GET    | Pending revisions you can review             |
| `/api/revisions/{id}/review`              | POST   | accept / reject / request_changes            |
| `/api/revisions/{id}/provenance`          | GET    | Agent-author metadata (confidence, sources)  |
| `/api/graph`                              | GET    | Knowledge graph data                         |
| `/api/search`                             | GET    | Hybrid semantic + lexical search             |
| `/api/chat`                               | POST   | RAG chat (`mode: sources \| wiki`)           |
| `/api/raw`                                | GET    | List raw sources                             |
| `/api/raw`                                | POST   | Upload raw source (multipart)                |
| `/api/raw/{id}/ingest`                    | POST   | Trigger ingest plan                          |
| `/api/ingest-runs/{id}/apply`             | POST   | Approve plan, dispatch apply phase           |
| `/api/ingest-runs/{id}/dismiss`           | POST   | Reject a plan; nothing is created            |
| `/api/ingest-runs/{id}/retry`             | POST   | Resume / retry an apply run (idempotent)     |
| `/api/admin/idea-file`                    | GET/PUT| Read/write the agent playbook                |
| `/api/admin/lint/run`                     | POST   | Trigger a lint pass                          |
| `/api/admin/lint/reports`                 | GET    | List lint reports (admin)                    |
| `/api/mcp-tokens`                         | GET    | List my personal MCP tokens                  |
| `/api/mcp-tokens`                         | POST   | Create new token (returns plaintext once)    |
| `/mcp`                                    | POST   | MCP server (JSON-RPC 2.0)                    |

OpenAPI docs at <http://localhost:8000/docs>.

## What's stubbed (production TODO)

- **Auth**: OIDC scaffold exists but `/auth/callback` and Authlib wiring need
  finishing for real OIDC. Stub mode is the default.
- **Migrations**: schema is created via `Base.metadata.create_all` plus inline
  ALTER statements in `app/main.py:lifespan`. Replace with Alembic before
  production.
- **File watcher**: external edits to `vault/` are imported only on startup.
- **Reranker**: retrieval uses cosine distance only. A cross-encoder reranker
  would meaningfully improve answer quality.
- **Code-aware chunking**: paragraph-level + regex-based code-block detection.
  Tree-sitter would be more accurate.
- **Email**: in-app notifications work; SMTP/SES not wired.
- **Rate limiting**: chat / ingest / lint endpoints are unprotected. Add Redis
  per-user limits before opening to many users.
- **Observability**: no metrics or tracing. Wire OpenTelemetry → Prometheus →
  Grafana for production.
- **Backups**: document Postgres backup strategy and test restore.
- **Tests**: a test directory exists but tests aren't written; smoke tests for
  the workflow state machine are highest priority.

## Repository layout

```
backend/
  app/
    core/         # config, db, auth, permissions
    models/       # SQLAlchemy models
    routers/      # FastAPI route handlers
    services/     # workflow, ingest, lint, retrieval, rag, embeddings,
                  # chunker, vault, claude_client
    scripts/      # one-off CLI tools (export_to_disk, backfill_embeddings)
    main.py       # FastAPI app + lifespan migrations
    worker.py     # Celery worker (ingest plan/apply, lint)
  Dockerfile
  requirements.txt
frontend/
  app/            # Next.js app router (layout, page, globals)
  components/     # React components
  lib/            # api client, tabs, graph settings, custom folders
  public/         # static assets (incl. background video)
  Dockerfile
  package.json
config/agents.md   # editable agent playbook (mounted into backend at /config)
raw/               # raw input documents (mounted into backend at /raw)
vault/             # markdown source mirror of published pages (source-of-truth on disk)
docs/              # internal documentation (permissions reference, etc.)
scripts/           # operational scripts (git-export.sh)
docker-compose.yml
.env.example
```

## License

Build whatever you want with this. There's no license — treat it as a starting
point you own.
