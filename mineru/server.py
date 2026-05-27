"""MinerU HTTP wrapper.

Receives a PDF as multipart/form-data, returns Markdown.

Runs MinerU's CLI in a subprocess (rather than the Python API) because
MinerU's import-time setup is heavy and the CLI is the most stable
contract across the magic-pdf → mineru rebrand. CPU-only operation:
expect 30s–3min per page for a typical academic PDF. First-ever parse
downloads ~5GB of model weights to /data/.cache (persisted by the
mineru_models Docker volume); subsequent parses reuse the cache.

The endpoint is intentionally simple — one input, Markdown out. If the
parse fails (timeout, OCR couldn't read scan, MinerU crash), we return
a 5xx and let the caller (backend.services.converters) fall back to the
default Anthropic native PDF path.
"""
import logging
import shutil
import subprocess
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("mineru-wrapper")

app = FastAPI(title="MinerU wrapper")


def _find_mineru_binary() -> str:
    """The MinerU CLI is shipped as `mineru` in 2.x and as `magic-pdf` in
    earlier versions. Pick whichever is on PATH."""
    for name in ("mineru", "magic-pdf"):
        if shutil.which(name):
            return name
    raise RuntimeError(
        "Neither `mineru` nor `magic-pdf` is on PATH. Install with "
        "`pip install mineru` or `pip install 'magic-pdf[full]'`."
    )


def _find_markdown_output(out_dir: Path) -> Path | None:
    """MinerU's output layout has shifted across versions. Just walk the
    output dir and return the first .md we find; in practice there's
    only one per parse."""
    for md in sorted(out_dir.rglob("*.md")):
        return md
    return None


@app.get("/health")
def health():
    return {"status": "ok"}


_SUPPORTED_EXTS = {".pdf", ".docx", ".pptx", ".xlsx"}
_SUPPORTED_MIMES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",  # docx
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",  # pptx
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",  # xlsx
}


@app.post("/parse")
async def parse_pdf(file: UploadFile = File(...)):
    """POST a PDF/DOCX/PPTX/XLSX as multipart/form-data → JSON
    {markdown, filename}. MinerU 3.x natively handles Office formats
    via mammoth/python-docx/openpyxl plus its layout pipeline."""
    name = (file.filename or "").lower()
    mime = (file.content_type or "").lower()
    ext_ok = any(name.endswith(ext) for ext in _SUPPORTED_EXTS)
    mime_ok = mime in _SUPPORTED_MIMES
    if not (ext_ok or mime_ok):
        raise HTTPException(
            400, "Only PDF / DOCX / PPTX / XLSX are supported",
        )

    binary = _find_mineru_binary()
    with tempfile.TemporaryDirectory(prefix="mineru-") as tmp:
        tmp_path = Path(tmp)
        in_path = tmp_path / (file.filename or "input.pdf")
        out_dir = tmp_path / "out"
        out_dir.mkdir()

        # Stream the upload to disk so we don't hold the whole PDF in
        # memory for a CPU-bound parse that's about to take minutes.
        with in_path.open("wb") as f:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                f.write(chunk)
        log.info(
            "Parsing %s (%d bytes) with %s",
            file.filename, in_path.stat().st_size, binary,
        )

        # `-b pipeline` pins MinerU to its CPU-friendly backend
        # (DocLayout-YOLO layout + PaddleOCR). The default in 3.x is
        # `hybrid-auto-engine`, which transparently requires the heavy
        # `hybrid-transformers` add-on package (and ideally GPU) — it
        # fails fast on a base CPU install.
        cmd = [
            binary,
            "-b", "pipeline",
            "-p", str(in_path),
            "-o", str(out_dir),
        ]
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=1800,  # 30 min
            )
        except subprocess.TimeoutExpired:
            log.error("MinerU exceeded 30-min timeout on %s", file.filename)
            raise HTTPException(504, "MinerU exceeded 30-min timeout")

        if result.returncode != 0:
            tail = (result.stderr or result.stdout or "")[-800:]
            log.error("MinerU exit=%d on %s: %s", result.returncode, file.filename, tail)
            raise HTTPException(500, f"MinerU failed (exit {result.returncode}): {tail}")

        md_path = _find_markdown_output(out_dir)
        if md_path is None or not md_path.exists():
            log.error("MinerU produced no Markdown for %s", file.filename)
            raise HTTPException(500, "MinerU did not produce a Markdown output")

        markdown = md_path.read_text(encoding="utf-8")
        log.info("Parsed %s → %d chars of Markdown", file.filename, len(markdown))
        return {"markdown": markdown, "filename": file.filename}
