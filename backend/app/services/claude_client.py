"""Anthropic client singleton."""
from typing import Optional
from anthropic import AsyncAnthropic
from app.core.config import settings

_client: Optional[AsyncAnthropic] = None


def get_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        _client = AsyncAnthropic(api_key=settings.anthropic_api_key or None)
    return _client
