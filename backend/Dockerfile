# Multi-stage build: heavy install in stage 1, slim runtime in stage 2.
# The wiki is API-only — embeddings go to an external OpenAI-compatible endpoint
# (app/services/embeddings.py), so there is NO torch / sentence-transformers in
# the image. Combined with dropping gcc/git from the runtime stage, the final
# image is ~700 MB instead of the old ~3 GB.

# ── Stage 1: build environment ─────────────────────────────────────────────
FROM python:3.12-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc git \
    && rm -rf /var/lib/apt/lists/*

# Install into a venv so the runtime stage picks it up via a single COPY.
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir --retries 5 --timeout 120 -r requirements.txt


# ── Stage 2: slim runtime ─────────────────────────────────────────────────
FROM python:3.12-slim

COPY --from=builder /opt/venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH

WORKDIR /app
COPY . .

# Production default — no --reload, multiple workers, real logs.
# The dev docker-compose.yml overrides this with `--reload` (single worker)
# for hot-reload on bind-mounted source.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
