"""Settings loaded from env."""
from pathlib import Path
from typing import Literal
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://wiki:wiki@localhost:5432/wiki"
    redis_url: str = "redis://localhost:6379/0"

    anthropic_api_key: str = ""

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


settings = Settings()
