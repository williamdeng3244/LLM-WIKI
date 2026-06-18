"""Vector embeddings for search / RAG.

API-only by default: the ``openai`` provider calls an external OpenAI-compatible
``/v1/embeddings`` endpoint (OpenAI, Azure OpenAI, an internal gateway, ...).
Two non-production providers exist for CI / offline dev:

  * ``none``  — embeddings disabled. Chunks are stored with a NULL vector and
                search degrades to the lexical (ILIKE) fallback (which finds
                tokens that appear in page text). No key, no network, no ML —
                this is the CI / offline default.
  * ``local`` — sentence-transformers, *if* you ``pip install`` it yourself
                (deliberately not shipped in the prod image).

Pick the provider + model via env (see ``app/core/config.py``):
``EMBEDDINGS_PROVIDER``, ``EMBEDDINGS_MODEL``, ``EMBEDDINGS_API_KEY``,
``EMBEDDINGS_BASE_URL``, ``EMBEDDING_DIM``.

Interface kept stable so callers don't change: ``embed_texts(list[str])``
returns ``list[list[float]]``, ``embed_query(str)`` returns ``list[float]``.
Callers already handle the disabled/error case (the indexer stores a NULL
embedding, search falls back to lexical ILIKE), so the ``none`` provider stores
NULL vectors on the index path and raises on the query path to take that
fallback.
"""
import asyncio
import logging

from app.core.config import settings

log = logging.getLogger(__name__)

# OpenAI accepts large input arrays; bound the batch so a huge page can't build
# one oversized request.
_BATCH = 256


class EmbeddingsDisabled(RuntimeError):
    """Raised by embed_query when EMBEDDINGS_PROVIDER=none, so rag.retrieve()
    takes its lexical fallback path."""


# ── provider: openai (default — external API) ───────────────────────────────
_client = None


def _get_client():
    global _client
    if _client is None:
        from openai import AsyncOpenAI

        key = settings.embeddings_api_key or settings.openai_api_key
        base = (
            settings.embeddings_base_url
            or settings.openai_base_url
            or "https://api.openai.com/v1"
        )
        _client = AsyncOpenAI(api_key=key, base_url=base, max_retries=2, timeout=30.0)
    return _client


async def _openai_encode(texts: list[str]) -> list[list[float]]:
    client = _get_client()
    out: list[list[float]] = []
    for i in range(0, len(texts), _BATCH):
        batch = texts[i : i + _BATCH]
        kwargs: dict = {"model": settings.embeddings_model, "input": batch}
        if settings.embeddings_use_dimensions:
            kwargs["dimensions"] = settings.embedding_dim
        resp = await client.embeddings.create(**kwargs)
        out.extend(d.embedding for d in resp.data)
    return out


# ── provider: local (optional sentence-transformers) ────────────────────────
_local_model = None


def _local_encode(texts: list[str]) -> list[list[float]]:
    global _local_model
    if _local_model is None:
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as e:  # pragma: no cover - optional dependency
            raise RuntimeError(
                "EMBEDDINGS_PROVIDER=local requires sentence-transformers, which "
                "is not in the prod image. `pip install sentence-transformers`, "
                "or use EMBEDDINGS_PROVIDER=openai (the default)."
            ) from e
        log.info("Loading local embedding model (sentence-transformers)…")
        _local_model = SentenceTransformer("all-MiniLM-L6-v2")
    arr = _local_model.encode(texts, convert_to_numpy=True, show_progress_bar=False)
    return [v.tolist() for v in arr]


_lock = asyncio.Lock()


async def embed_texts(texts: list[str], input_type: str = "document") -> list[list[float]]:
    # `input_type` kept in the signature for interface stability (some providers
    # distinguish query vs document); OpenAI ignores the distinction.
    del input_type
    if not texts:
        return []
    provider = settings.embeddings_provider
    if provider == "openai":
        return await _openai_encode(texts)
    if provider == "none":
        # Embeddings disabled → NULL vectors. The indexer stores these as-is;
        # search then has no vectors to match and uses the lexical fallback.
        return [None] * len(texts)  # type: ignore[list-item]
    if provider == "local":
        async with _lock:  # serialize CPU-bound encodes
            return await asyncio.to_thread(_local_encode, texts)
    raise RuntimeError(f"Unknown EMBEDDINGS_PROVIDER: {provider!r}")


async def embed_query(text: str) -> list[float]:
    if settings.embeddings_provider == "none":
        # Force rag.retrieve()'s lexical fallback (which finds tokens in text).
        raise EmbeddingsDisabled(
            "EMBEDDINGS_PROVIDER=none — semantic search disabled; using lexical fallback."
        )
    vecs = await embed_texts([text], input_type="query")
    return vecs[0]
