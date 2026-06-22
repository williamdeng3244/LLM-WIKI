"""Embeddings via an OpenAI-compatible API (no local model, no torch).

Vectors are produced by the configured embeddings endpoint
(`settings.embedding_*`) rather than an in-process model. Works with
OpenAI proper or any OpenAI-compatible server (Azure OpenAI, Together,
vLLM, LM Studio, ...). The endpoint/key fall back to the openai_* creds
so a single OPENAI_BASE_URL/OPENAI_API_KEY covers chat + embeddings.

Interface kept stable so callers don't change: `embed_texts(list[str])`
returns `list[list[float]]`, `embed_query(str)` returns `list[float]`.
"""
import logging

from app.core.config import settings

log = logging.getLogger(__name__)

# Generous timeout for large batches; embeddings calls are fast but a
# cold proxy or a 100-chunk batch can take a few seconds.
_EMBED_TIMEOUT_S = 120.0


def _get_client():
    # Fresh client per call mirrors llm_client.py (Bug #8): an httpx async
    # pool binds to the event loop alive on its first request, and Celery
    # tasks run under per-task asyncio.run() loops. A cached global pool
    # would hang on the second task. One TLS handshake per batch is cheap.
    from openai import AsyncOpenAI

    key = settings.embedding_api_key or settings.openai_api_key or "sk-no-key-required"
    base_url = (
        settings.embedding_base_url
        or settings.openai_base_url
        or "https://api.openai.com/v1"
    )
    return AsyncOpenAI(api_key=key, base_url=base_url, timeout=_EMBED_TIMEOUT_S)


async def embed_texts(texts: list[str], input_type: str = "document") -> list[list[float]]:
    # `input_type` kept in the signature for backward compatibility with the
    # old Voyage-flavored interface; the OpenAI embeddings API ignores it.
    del input_type
    if not texts:
        return []
    client = _get_client()
    # text-embedding-3-* models accept an optional `dimensions` arg. Without it,
    # text-embedding-3-large defaults to 3072 while our pgvector column is
    # sized by settings.embedding_dim (1536 by default) — mismatch 500s on
    # publish/reindex. Pass the configured dim so API output matches the DB.
    kwargs: dict = {"model": settings.embedding_model, "input": texts}
    if settings.embedding_model.startswith("text-embedding-3"):
        kwargs["dimensions"] = settings.embedding_dim
    resp = await client.embeddings.create(**kwargs)
    # Be defensive about ordering: sort by the index the API echoes back so
    # the returned vectors line up with `texts` regardless of server order.
    items = sorted(resp.data, key=lambda d: d.index)
    vecs = [list(d.embedding) for d in items]
    for i, v in enumerate(vecs):
        if len(v) != settings.embedding_dim:
            raise ValueError(
                f"embedding[{i}] has {len(v)} dims, expected {settings.embedding_dim} "
                f"(model={settings.embedding_model!r}). "
                "Set EMBEDDING_DIM to match the model output, or pick a model "
                "that supports the configured dimension."
            )
    return vecs


async def embed_query(text: str) -> list[float]:
    vecs = await embed_texts([text], input_type="query")
    return vecs[0]
