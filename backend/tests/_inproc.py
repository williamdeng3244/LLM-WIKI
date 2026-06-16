"""Helpers for the *in-process* tests (FR-SRCH-003, FR-CHAT-003, FR-ING-*,
FR-LINT-*).

Most of the suite is black-box: httpx against the live :8000 backend. A handful
of requirements are documented ``[unit]`` / ``[API-mocked]`` because they need a
DB session in-hand and/or a mocked LLM — those import from here instead of
``conftest.py`` (which stays black-box-only).

Provides:
  * ``session_scope()`` — an AsyncSession on a fresh, self-disposing engine
    (same pattern as ``app.worker._task_session``), so a test can read/write the
    real DB the running backend uses.
  * ``run(coro)`` — ``asyncio.run`` shim. Tests that drive worker tasks must be
    *sync* (the tasks call ``asyncio.run`` internally), so they use this for
    their own async setup/asserts rather than being ``async def``.
  * ``mock_llm_server`` — a pytest fixture that boots ``mock_llm`` and points
    ``settings`` at it for the duration of one test, restoring the originals
    afterwards.
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import AsyncIterator

import pytest
from sqlalchemy.ext.asyncio import (
    AsyncSession, async_sessionmaker, create_async_engine,
)

from app.core.config import settings

from tests import mock_llm


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    """Yield an AsyncSession backed by a fresh engine, disposed on exit. Each
    ``asyncio.run`` block gets its own engine/loop so nothing crosses loops."""
    engine = create_async_engine(
        settings.database_url, pool_size=1, max_overflow=2, pool_pre_ping=True,
    )
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with Session() as s:
            yield s
    finally:
        await engine.dispose()


def run(coro):
    """``asyncio.run`` for sync tests that interleave async setup with the
    (synchronous, self-looping) Celery task bodies."""
    return asyncio.run(coro)


@pytest.fixture
def mock_llm_server():
    """Boot the OpenAI-compatible mock LLM and point ``settings`` at it for one
    test. Restores the original provider/url/model/key on teardown so the rest
    of the (in-process) suite is unaffected."""
    srv = mock_llm.start()
    saved = (
        settings.llm_provider, settings.openai_base_url,
        settings.openai_chat_model, settings.openai_api_key,
    )
    settings.llm_provider = "openai"
    settings.openai_base_url = mock_llm.base_url(srv)
    settings.openai_chat_model = "mock-model"
    settings.openai_api_key = "sk-mock"
    # Reset to harmless defaults; individual tests overwrite as needed.
    mock_llm.STATE["chat_text"] = "Mock answer."
    mock_llm.STATE["tool_args"] = {}
    try:
        yield srv
    finally:
        (settings.llm_provider, settings.openai_base_url,
         settings.openai_chat_model, settings.openai_api_key) = saved
        mock_llm.stop(srv)
