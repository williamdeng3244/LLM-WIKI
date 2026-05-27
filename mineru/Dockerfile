# MinerU sidecar — CPU-only, runs as a separate service from the wiki
# backend. First boot pulls ~5GB of model weights to /data/.cache;
# subsequent boots reuse the mineru_models volume.

FROM python:3.11-slim

# System deps for PDF rendering, OCR runtime, image ops.
RUN apt-get update && apt-get install -y --no-install-recommends \
        poppler-utils \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
        git \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU-only PyTorch first. MinerU pulls in torch as a dep; without this
# we'd get the default CUDA wheel and the image would balloon to ~5GB
# of unused GPU libraries.
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir torch torchvision \
        --index-url https://download.pytorch.org/whl/cpu

# Install MinerU with the `pipeline` extra. The bare `mineru` package is
# the CLI scaffolding only — the pipeline backend (DocLayout-YOLO +
# transformers OCR) needs the extra to pull in `transformers`,
# `tokenizers`, `albumentations`, `safetensors`. Without it, the parse
# call fails fast with `No module named 'transformers'`. Older versions
# shipped as `magic-pdf[full]`; keep that as a fallback.
RUN pip install --no-cache-dir "mineru[pipeline]" \
 || pip install --no-cache-dir "magic-pdf[full]"

# HTTP wrapper deps.
RUN pip install --no-cache-dir fastapi "uvicorn[standard]" python-multipart httpx

# MinerU's model cache lives under $HOME by default — point it at the
# /data volume so models persist across container recreates.
ENV HOME=/data
ENV MINERU_DEVICE_MODE=cpu
RUN mkdir -p /data/.cache

COPY server.py /app/server.py

EXPOSE 8080
# Long keep-alive so backend HTTP clients can wait on slow CPU parses
# without proxy resets.
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080", \
     "--timeout-keep-alive", "1800"]
