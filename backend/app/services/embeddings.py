"""Local embeddings via sentence-transformers (no external API).

Uses `all-MiniLM-L6-v2` (384-dim). The model is downloaded once on first
use (~90 MB) and cached inside the backend container, then runs on CPU
inside the same process — no network calls per chunk.

Interface kept stable so callers don't change: `embed_texts(list[str])`
returns `list[list[float]]`, `embed_query(str)` returns `list[float]`.
"""
import asyncio
import logging

log = logging.getLogger(__name__)

_model = None
_lock = asyncio.Lock()


def _load_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        log.info("Loading local embedding model: all-MiniLM-L6-v2 (384-dim)…")
        _model = SentenceTransformer("all-MiniLM-L6-v2")
        log.info("Embedding model ready.")
    return _model


def _encode_sync(texts: list[str]) -> list[list[float]]:
    model = _load_model()
    arr = model.encode(texts, convert_to_numpy=True, show_progress_bar=False)
    return [v.tolist() for v in arr]


async def embed_texts(texts: list[str], input_type: str = "document") -> list[list[float]]:
    # `input_type` kept in the signature for backward compatibility with the
    # old Voyage-flavored interface; sentence-transformers ignores it.
    del input_type
    if not texts:
        return []
    async with _lock:  # serialize CPU-bound encodes; cheap given small batches
        return await asyncio.to_thread(_encode_sync, texts)


async def embed_query(text: str) -> list[float]:
    vecs = await embed_texts([text], input_type="query")
    return vecs[0]
