# Multi-stage build: heavy install in stage 1, slim runtime in stage 2.
# Drops ~300 MB (gcc + git + apt caches) from the final image. Combined with
# CPU-only torch (saves another ~500 MB), the runtime image is ~1.2 GB instead
# of ~3 GB.

# ── Stage 1: build environment ─────────────────────────────────────────────
FROM python:3.12-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc git \
    && rm -rf /var/lib/apt/lists/*

# Install into a venv so the runtime stage picks it up via a single COPY.
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH

# Install CPU-only PyTorch from pytorch.org's wheel index first. The default
# `torch` wheel on PyPI bundles ~500 MB of CUDA runtime libraries we never
# use; pinning it here means transitive resolution for sentence-transformers
# finds torch already satisfied and never pulls the CUDA build.
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Bake the embedding model (all-MiniLM-L6-v2, ~90 MB) into the image so the
# container NEVER needs to reach huggingface.co at runtime. First publish /
# search are then instant, and it works where HF is blocked/throttled.
# Non-fatal: if the build host can't reach HF or its mirror, the image still
# builds (the model just loads/falls-back at runtime). CI builds have good
# network, so released images always include it. Try HF, then the China mirror.
ENV HF_HOME=/opt/models
RUN mkdir -p /opt/models && ( \
        python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')" \
     || HF_ENDPOINT=https://hf-mirror.com python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')" \
     || echo 'WARN: embedding model not baked (no network at build time)' )


# ── Stage 2: slim runtime ─────────────────────────────────────────────────
FROM python:3.12-slim

# libgomp1 is OpenMP, needed by torch + numpy for threaded ops. ~250 KB vs
# the ~250 MB cost of gcc that we just dropped.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv
# The baked embedding model. Combined with the offline flags below, the
# container loads it from disk with zero network calls (no HF HEAD check,
# so no multi-minute retry when huggingface.co is unreachable).
COPY --from=builder /opt/models /opt/models
ENV PATH=/opt/venv/bin:$PATH \
    HF_HOME=/opt/models \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1

WORKDIR /app
COPY . .

# Production default — no --reload, multiple workers, real logs.
# The dev docker-compose.yml overrides this with `--reload` (single worker)
# for hot-reload on bind-mounted source.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
