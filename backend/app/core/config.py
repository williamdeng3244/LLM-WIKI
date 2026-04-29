"""Settings loaded from env."""
from pathlib import Path
from typing import Literal
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://wiki:wiki@localhost:5432/wiki"
    redis_url: str = "redis://localhost:6379/0"

    anthropic_api_key: str = ""
    voyage_api_key: str = ""

    vault_path: Path = Path("/vault")

    auth_mode: Literal["stub", "oidc"] = "stub"
    jwt_secret: str = "dev-secret-change-in-prod"
    oidc_issuer: str = ""
    oidc_client_id: str = ""
    oidc_client_secret: str = ""

    cors_origins: list[str] = ["http://localhost:3000"]

    chat_model: str = "claude-sonnet-4-6"
    embedding_dim: int = 1024
    embedding_model: str = "voyage-3"


settings = Settings()
