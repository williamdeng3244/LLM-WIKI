"""Settings loaded from env."""
from pathlib import Path
from typing import Literal
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

    auth_mode: Literal["stub", "oidc"] = "stub"
    jwt_secret: str = "dev-secret-change-in-prod"
    oidc_issuer: str = ""
    oidc_client_id: str = ""
    oidc_client_secret: str = ""

    cors_origins: list[str] = ["http://localhost:3000"]

    chat_model: str = "claude-sonnet-4-6"
    # Local embedding model (sentence-transformers all-MiniLM-L6-v2 = 384-dim).
    embedding_dim: int = 384

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


settings = Settings()
