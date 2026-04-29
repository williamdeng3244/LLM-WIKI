# Enflame Wiki

A self-hosted company knowledge base with markdown source-of-truth, role-based contribution workflow, force-directed knowledge graph, RAG-powered chat, and per-employee personal agents.

Inspired by Karpathy's llm-wiki (agents propose, humans review), Obsidian (markdown + graph view), and PandaWiki (AI-assisted authoring and Q&A).

## What's in the box

- **Web app** — three-pane interface: file tree, graph or page view, AI chat panel
- **API** — FastAPI backend with full draft/review/publish workflow
- **Personal agents** — every user can create AI agents that act with their permissions
- **Knowledge graph** — 2D and 3D force-directed visualization of `[[wiki-links]]`
- **RAG chat** — answers grounded in published content with clickable citations
- **Markdown export** — git-trackable snapshots via `scripts/git-export.sh`

## Quickstart

You need Docker and Docker Compose. Nothing else on your machine.

```bash
cp .env.example .env
# Edit .env: set ANTHROPIC_API_KEY (required for chat) and optionally VOYAGE_API_KEY
docker compose up --build
```

Then:

- Open http://localhost:3000
- The app starts in **stub auth mode** — you're auto-logged in as admin
- Use the role switcher in the top-right to view as different roles
- The 11 seed pages from `vault/` are imported on first boot
- Try suggesting an edit, reviewing it, or asking the chat panel a question

The git export tool is in `scripts/git-export.sh` — run it to mirror current published state to a directory you can commit.

## Architecture

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│   Next.js    │──▶│   FastAPI    │──▶│  Postgres    │
│  (frontend)  │   │   (backend)  │   │  + pgvector  │
└──────────────┘   └──────┬───────┘   └──────────────┘
                          │
                   ┌──────▼───────┐   ┌──────────────┐
                   │   Celery     │──▶│    Redis     │
                   │   (worker)   │   │              │
                   └──────────────┘   └──────────────┘
```

Five services in `docker-compose.yml`: `db`, `redis`, `backend`, `worker`, `frontend`.

## Permission model

| Role          | Read | Draft | Comment | Review (in-cat) | Lock | Manage |
|---------------|:----:|:-----:|:-------:|:---------------:|:----:|:------:|
| reader        |  ✓   |       |         |                 |      |        |
| contributor   |  ✓   |   ✓   |   ✓     |                 |      |        |
| editor        |  ✓   |   ✓   |   ✓     |       ✓         |      |        |
| admin         |  ✓   |   ✓   |   ✓     |       ✓         |  ✓   |   ✓    |

Each page has a **stability level** that controls publishing:

- **open** — drafts auto-publish on submit (low-stakes pages)
- **stable** — drafts go to the review queue (default)
- **locked** — only admins can publish

Editors are scoped per-category (engineering, product, design, operations, research). See `docs/PERMISSIONS.md` for the detailed reference.

## Personal agents

Each employee can create AI agents. Agents are real `User` rows with `is_agent=True` and an `owner_id` pointing to a human. They authenticate via API tokens and route through normal authorization.

**Two ways to use them:**

1. **Cloud (web UI)** — chat panel on the right side. The company pays for API usage.
2. **Local (Claude Code etc.)** — generate an API token via the Agents button, then point any tool at `https://your-wiki/api/chat` with `Authorization: Bearer <token>`.

Agents can read published content and submit drafts. They cannot publish without a human review — same workflow as everyone else.

## API surface

About 30 endpoints. Highlights:

| Endpoint                              | Method | Purpose                                      |
|---------------------------------------|--------|----------------------------------------------|
| `/api/auth/whoami`                    | GET    | Current user                                 |
| `/api/auth/dev-login`                 | POST   | Stub-mode login (returns JWT)                |
| `/api/auth/tokens`                    | POST   | Create personal API token                    |
| `/api/pages`                          | GET    | List published pages                         |
| `/api/pages/{path}`                   | GET    | Get one page (current published version)     |
| `/api/pages/draft`                    | POST   | Create draft (edit or new page)              |
| `/api/pages/{path}/lock`              | POST   | Lock/unlock (admin only)                     |
| `/api/revisions/my-drafts`            | GET    | Your in-progress drafts                      |
| `/api/revisions/review-queue`         | GET    | Pending revisions you can review             |
| `/api/revisions/{id}/submit`          | POST   | Submit a draft for review                    |
| `/api/revisions/{id}/review`          | POST   | accept / reject / request_changes            |
| `/api/agents`                         | GET    | List your agents                             |
| `/api/agents`                         | POST   | Create an agent (returns API token once)     |
| `/api/graph`                          | GET    | Knowledge graph data                         |
| `/api/search`                         | GET    | Hybrid semantic + lexical search             |
| `/api/chat`                           | POST   | RAG chat with citations                      |

OpenAPI docs available at `http://localhost:8000/docs` once running.

## What's stubbed (production TODO)

This is an **MVP scaffold**. The pieces that need real engineering before production:

- **Auth**: OIDC integration is stubbed in `core/auth.py`. The skeleton accepts `AUTH_MODE=oidc` and the env vars exist, but the `/auth/callback` route and Authlib wiring need to be implemented for real OIDC.
- **Migrations**: Schema currently created via `Base.metadata.create_all` in the lifespan. Replace with Alembic before any production deploy.
- **File watcher**: External edits to `vault/` are imported only on startup. Add a watchdog handler to pick up disk edits live.
- **Reranker**: Retrieval uses cosine distance only. A cross-encoder reranker (e.g., Voyage `rerank-2`) would meaningfully improve answer quality.
- **Code-aware chunking**: We split markdown by paragraphs and code blocks with regex-based symbol detection. Tree-sitter would be more accurate.
- **Email notifications**: In-app notifications work. SMTP/SES integration is not wired.
- **Rate limiting**: No protection on chat endpoint. Add Redis-based per-user limits before opening to hundreds of users.
- **Observability**: No metrics, no tracing. Wire OpenTelemetry → Prometheus + Grafana for production.
- **Backups**: Document Postgres backup strategy and test restore.
- **Tests**: A test directory exists but no tests are written. Smoke tests for the workflow state machine are the highest priority.

## Repository layout

```
backend/
  app/
    core/         # config, db, auth, permissions
    models/       # SQLAlchemy models
    routers/      # FastAPI route handlers
    services/     # workflow, indexer, RAG, embeddings, chunker, vault
    scripts/      # one-off CLI tools (export_to_disk)
    main.py       # FastAPI app
    worker.py     # Celery worker
  Dockerfile
  requirements.txt
frontend/
  app/            # Next.js app router (layout, page, globals)
  components/     # React components
  lib/api.ts      # typed API client
  Dockerfile
  package.json
vault/            # markdown source files (source of truth on disk)
docs/             # internal documentation
scripts/          # operational scripts (git-export)
docker-compose.yml
.env.example
```

## License

Build whatever you want with this. There's no license — treat it as a starting point you own.
