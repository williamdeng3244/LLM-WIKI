# Multi-stage build: heavy install in stage 1, slim runtime in stage 2.
# Drops ~300 MB (gcc + git + apt caches) from the final image. Embeddings
# now go through an external API (no torch / sentence-transformers), so the
# runtime image is only a few hundred MB and pulls in zero CUDA libraries.

# ── Stage 1: build environment ─────────────────────────────────────────────
FROM artifact.enflame.cn/enflame_docker_images/ci/python:3.12-slim-gcc AS builder

RUN rm -rf /etc/apt/sources.list.d/* && \
    echo "deb [trusted=yes] http://data-oceanus.enflame.cn:80/artifactory/debian_virtual/ bookworm main" > /etc/apt/sources.list && \
    # 删除可能引起错误的 Post-Invoke 清理脚本
    rm -f /etc/apt/apt.conf.d/* && \
    apt-get update && apt-get install -y --no-install-recommends \
        gcc git \
    && rm -rf /var/lib/apt/lists/*

# Install into a venv so the runtime stage picks it up via a single COPY.
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH

COPY requirements.txt .
RUN pip install --no-cache-dir --index-url http://artifact.enflame.cn/artifactory/api/pypi/pypi-remote/simple --trusted-host artifact.enflame.cn --upgrade pip \
 && pip install --no-cache-dir --index-url http://artifact.enflame.cn/artifactory/api/pypi/pypi-remote/simple --trusted-host artifact.enflame.cn -r requirements.txt


# ── Stage 2: slim runtime ─────────────────────────────────────────────────
FROM artifact.enflame.cn/enflame_docker_images/ci/python:3.12-slim-gcc

ENV OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    NUMEXPR_NUM_THREADS=1 \
    VECLIB_MAXIMUM_THREADS=1

COPY --from=builder /opt/venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH

WORKDIR /app
COPY . .

# Production default — no --reload, multiple workers, real logs.
# The dev docker-compose.yml overrides this with `--reload` (single worker)
# for hot-reload on bind-mounted source.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--loop", "asyncio", "--http", "h11"]
