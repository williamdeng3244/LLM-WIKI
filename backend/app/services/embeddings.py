"""Embeddings: Voyage AI when configured, sentence-transformers fallback otherwise.

The interface is identical so callers don't care which is used.
"""
import logging
from typing import Optional

from app.core.config import settings

log = logging.getLogger(__name__)

# Lazy imports — neither library is required at module import time
_voyage_client = None
_st_model = None


def _provider() -> str:
    return "voyage" if settings.voyage_api_key else "local"


async def embed_texts(texts: list[str], input_type: str = "document") -> list[list[float]]:
    if not texts:
        return []
    if _provider() == "voyage":
        return await _embed_voyage(texts, input_type)
    return _embed_local(texts)


async def embed_query(text: str) -> list[float]:
    vecs = await embed_texts([text], input_type="query")
    return vecs[0]


async def _embed_voyage(texts: list[str], input_type: str) -> list[list[float]]:
    global _voyage_client
    import voyageai
    if _voyage_client is None:
        _voyage_client = voyageai.AsyncClient(api_key=settings.voyage_api_key)
    out: list[list[float]] = []
    for i in range(0, len(texts), 128):
        batch = texts[i:i + 128]
        result = await _voyage_client.embed(
            batch, model=settings.embedding_model, input_type=input_type,
        )
        out.extend(result.embeddings)
    return out


def _embed_local(texts: list[str]) -> list[list[float]]:
    """sentence-transformers fallback (~384-dim by default model).

    We pad/truncate to settings.embedding_dim so the same Vector column works
    regardless of provider. This is crude but lets the schema stay stable.
    """
    global _st_model
    from sentence_transformers import SentenceTransformer
    if _st_model is None:
        _st_model = SentenceTransformer("all-MiniLM-L6-v2")
        log.warning(
            "Using local sentence-transformers (384-dim, padded to %d). "
            "Set VOYAGE_API_KEY for production-quality embeddings.",
            settings.embedding_dim,
        )
    raw = _st_model.encode(texts, convert_to_numpy=True, show_progress_bar=False)
    out = []
    target = settings.embedding_dim
    for v in raw:
        v = v.tolist()
        if len(v) < target:
            v = v + [0.0] * (target - len(v))
        elif len(v) > target:
            v = v[:target]
        out.append(v)
    return out
