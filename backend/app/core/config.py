"""Settings loaded from env."""
from pathlib import Path
from typing import Literal, Optional
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://wiki:wiki@localhost:5432/wiki"
    redis_url: str = "redis://localhost:6379/0"

    # ── LLM provider selection ─────────────────────────────────────────
    # 'anthropic' uses the Anthropic Messages API.
    # 'openai' uses the OpenAI Chat Completions API — also compatible
    # with any provider that mirrors that surface (Azure OpenAI, Together
    # AI, Groq, Ollama, vLLM, LM Studio, OpenRouter, ...). Set
    # OPENAI_BASE_URL to point at the alternate endpoint.
    llm_provider: Literal["anthropic", "openai"] = "anthropic"

    anthropic_api_key: str = ""

    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_chat_model: str = "gpt-4o-mini"

    vault_path: Path = Path("/vault")
    raw_path: Path = Path("/raw")  # immutable raw input documents
    config_path: Path = Path("/config")  # idea file, lint config, future agent state

    # Opt-in demo content (Engineering/Product/Design/Operations/Research
    # sample pages). Mounted read-only at `examples_vault_path` and only
    # imported on first boot if `seed_examples=true`. Fresh installs are
    # empty by default; users who want a populated wiki for evaluation
    # set SEED_EXAMPLES=true in .env.
    seed_examples: bool = False
    examples_vault_path: Path = Path("/examples/vault")

    # URL-ingest knobs (issue #6). `POST /api/raw/url` fetches a public
    # http/https resource and feeds it through the existing pipeline.
    # The defaults below are safe; tighten or loosen per deployment.
    url_ingest_timeout_seconds: int = 60     # per-request fetch timeout
    url_ingest_max_bytes: int = 50 * 1024 * 1024  # 50 MB hard cap
    # Default-deny private / loopback / link-local destinations. Flip to
    # true for self-hosted intranet docs (Confluence, internal wikis).
    url_ingest_allow_private: bool = False

    auth_mode: Literal["stub", "oidc"] = "stub"
    jwt_secret: str = "dev-secret-change-in-prod"

    # Static admin (issue #5). When set, anyone POSTing to /api/auth/login
    # with these credentials gets an admin-role session JWT — works in
    # any auth_mode. This is the bootstrap account: use it the first
    # time you log in, before any OIDC user has been onboarded, or as
    # an emergency break-glass account if OIDC breaks. ADMIN_PASSWORD
    # is stored plaintext in env — keep .env file-permissioned tightly.
    admin_email: str = ""
    admin_password: str = ""

    # OIDC (issue #5). Requires authlib in requirements.
    oidc_issuer: str = ""
    oidc_client_id: str = ""
    oidc_client_secret: str = ""
    # Where the IdP redirects back to after consent. Must be registered
    # at the IdP. Defaults to the frontend's /auth/callback route.
    oidc_redirect_uri: str = "http://localhost:3000/auth/callback"
    oidc_scopes: str = "openid email profile"
    # Default role for users created via OIDC. The hand-coded admin
    # (admin_email above) always overrides this.
    default_oidc_role: Literal["reader", "contributor"] = "reader"

    cors_origins: list[str] = ["http://localhost:3000"]

    # DB connection pool sizing (issue #10). SQLAlchemy defaults are
    # 5 + 10 = 15 connections per process, which an ingest workload
    # blows through quickly if a single endpoint starts 500-ing and
    # the frontend retries hold connections. Raise the ceiling here
    # so a failing endpoint can't cascade into pool exhaustion.
    db_pool_size: int = 20
    db_max_overflow: int = 20
    db_pool_recycle: int = 1800     # 30 min — bounce stale connections

    chat_model: str = "claude-sonnet-4-6"

    # ── Embeddings ─────────────────────────────────────────────────────
    # Vector embeddings for search / RAG. Default provider is the EXTERNAL
    # OpenAI-compatible /v1/embeddings API (the wiki is API-only in prod;
    # the legacy local sentence-transformers model is no longer shipped).
    #   openai → hosted OpenAI-compatible API (OpenAI, Azure OpenAI, an
    #            internal gateway, ...). Set EMBEDDINGS_API_KEY + _BASE_URL.
    #   fake   → deterministic, dependency-free pseudo-vectors. For CI / dev
    #            without a key. NOT semantic — never use in production.
    #   local  → sentence-transformers, if you `pip install` it yourself
    #            (deliberately not in the prod image).
    embeddings_provider: Literal["openai", "fake", "local"] = "openai"
    # The embedding model id ("可指定模型"). text-embedding-3-small (1536) and
    # -3-large (3072) both honour the `dimensions` param below.
    embeddings_model: str = "text-embedding-3-small"
    # Embedding creds. Blank → fall back to the OpenAI *chat* creds, so one
    # OpenAI account serves both. Set these to point embeddings at a
    # different endpoint (e.g. Azure) than the chat LLM.
    embeddings_api_key: str = ""
    embeddings_base_url: str = ""
    # Send the OpenAI `dimensions` request param (supported by
    # text-embedding-3-*). Set false for models/providers that reject it —
    # then make embedding_dim equal the model's native output dimension.
    embeddings_use_dimensions: bool = True
    # pgvector column width. MUST equal the embedding model's output dim
    # (1536 = text-embedding-3-small). Changing it requires a re-embed:
    # `python -m app.scripts.backfill_embeddings`.
    embedding_dim: int = 1536

    # Global MCP server kill switch. Defaults to enabled; flip to false in
    # .env (MCP_ENABLED=false) to instantly cut all external MCP traffic
    # without revoking individual user tokens.
    mcp_enabled: bool = True

    # MinerU sidecar — high-fidelity PDF parsing (layout-aware, OCR,
    # table extraction). When enabled, every uploaded PDF is sent to the
    # MinerU service for Markdown extraction BEFORE the agent sees it;
    # the LLM then receives clean Markdown text instead of the native
    # PDF document block. Disabled by default because the first boot
    # pulls multi-GB of ML model weights and CPU parsing is slow.
    mineru_enabled: bool = False
    mineru_url: str = "http://mineru:8080"

    # Public-facing base URL used for share links returned by the API
    # and MCP tools (e.g. https://wiki.enflame.internal). Defaults to the
    # dev frontend origin. Behind a reverse proxy this is whatever the
    # user types into their browser — `/a/<short_id>` lives at this host.
    public_base_url: str = "http://localhost:3000"

    # ── Gated artifact publishing (display.dev / Flowershow style) ─────
    # Self-contained HTML / Markdown / plain-text payloads published
    # behind the wiki's auth boundary, addressable at /a/<short_id>.
    # See backend/app/models/artifact.py.
    artifacts_storage_dir: Path = Path("/data/artifacts")
    # 10 MB per artifact body. The viewer's outer shell adds ~2 KB on
    # top; the iframe sandbox isolates large client-side JS payloads so
    # users can publish D3 dashboards, Observable embeds, etc.
    artifacts_max_body_bytes: int = 10 * 1024 * 1024
    # Public visibility (viewable with no auth) is ON by default so anyone can
    # share artifacts publicly or move private/wiki ones to public. An admin
    # can set ARTIFACTS_ALLOW_PUBLIC=false to disable it, in which case the
    # publish endpoint returns 403 when visibility=public is requested.
    artifacts_allow_public: bool = True
    # Blank = artifacts never auto-expire. Set to an int to apply a
    # default expiry to artifacts whose creator didn't pick one.
    artifacts_default_expiry_days: Optional[int] = None

    # The docker-compose default for ARTIFACTS_DEFAULT_EXPIRY_DAYS is
    # `${VAR:-}` → empty string when the operator hasn't set it. Pydantic
    # can't coerce "" into Optional[int]; coerce the empty case to None
    # explicitly here so the container boots cleanly with the default
    # config.
    @field_validator("artifacts_default_expiry_days", mode="before")
    @classmethod
    def _empty_str_to_none(cls, v: object) -> object:
        if isinstance(v, str) and v.strip() == "":
            return None
        return v


settings = Settings()
