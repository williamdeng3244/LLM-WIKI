"""Split markdown into prose+code chunks with line-span metadata.

Code blocks are chunked separately; symbol extraction via regex.
"""
import re
from dataclasses import dataclass
from typing import Optional

PROSE_MAX_CHARS = 1500
FENCE_RE = re.compile(r"^```([A-Za-z0-9_+-]*)\s*$")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+)$")


@dataclass
class Chunk:
    chunk_index: int
    content: str
    chunk_type: str  # 'prose' | 'code'
    language: Optional[str]
    symbol: Optional[str]
    line_start: int
    line_end: int


def _detect_symbol(code: str, language: str) -> Optional[str]:
    patterns = {
        "python": [r"^\s*async\s+def\s+(\w+)", r"^\s*def\s+(\w+)", r"^\s*class\s+(\w+)"],
        "javascript": [r"^\s*function\s+(\w+)", r"^\s*const\s+(\w+)\s*=", r"^\s*class\s+(\w+)"],
        "typescript": [r"^\s*export\s+(?:default\s+)?function\s+(\w+)",
                       r"^\s*function\s+(\w+)", r"^\s*const\s+(\w+)\s*=", r"^\s*class\s+(\w+)"],
        "go": [r"^\s*func\s+(?:\([^)]+\)\s+)?(\w+)"],
        "rust": [r"^\s*pub\s+fn\s+(\w+)", r"^\s*fn\s+(\w+)", r"^\s*struct\s+(\w+)"],
    }
    for pat in patterns.get((language or "").lower(), []):
        m = re.search(pat, code, re.MULTILINE)
        if m:
            return m.group(1)
    return None


def chunk_markdown(body: str) -> list[Chunk]:
    lines = body.splitlines()
    n = len(lines)
    chunks: list[Chunk] = []
    idx = 0
    prose_buf: list[str] = []
    prose_start: Optional[int] = None
    current_heading: Optional[str] = None

    def flush_prose(end_line: int):
        nonlocal idx, prose_buf, prose_start
        text = "\n".join(prose_buf).strip()
        if text and prose_start is not None:
            chunks.append(Chunk(
                chunk_index=idx, content=text, chunk_type="prose",
                language=None, symbol=current_heading,
                line_start=prose_start, line_end=end_line,
            ))
            idx += 1
        prose_buf.clear()
        prose_start = None

    i = 0
    while i < n:
        line = lines[i]
        fence = FENCE_RE.match(line.strip())
        if fence:
            flush_prose(i)
            lang = fence.group(1) or ""
            code_start = i + 1
            j = i + 1
            while j < n and not FENCE_RE.match(lines[j].strip()):
                j += 1
            code_end = (j + 1) if j < n else n
            content = "\n".join(lines[i:code_end])
            chunks.append(Chunk(
                chunk_index=idx, content=content, chunk_type="code",
                language=lang or None,
                symbol=_detect_symbol(content, lang) if lang else None,
                line_start=code_start, line_end=code_end,
            ))
            idx += 1
            i = code_end
            continue
        heading = HEADING_RE.match(line)
        if heading:
            flush_prose(i)
            current_heading = heading.group(2).strip()
            prose_start = i + 1
            prose_buf.append(line)
        else:
            if prose_start is None:
                prose_start = i + 1
            prose_buf.append(line)
            if not line.strip() and sum(len(s) + 1 for s in prose_buf) > PROSE_MAX_CHARS:
                flush_prose(i + 1)
        i += 1
    flush_prose(n)
    return chunks
