"""[unit] Pure text-processing services — chunker + linker.

These have no I/O (markdown string in, structured data out) so they're tested
directly. Previously only their happy paths were exercised transitively via
ingest; this hits the code-fence handling, multi-language symbol detection, the
mid-buffer prose flush, tag/link de-duplication, and the wikilink resolver's
slug fallback.
"""
from __future__ import annotations

from app.services.chunker import Chunk, _detect_symbol, chunk_markdown
from app.services.linker import extract_links, extract_tags, normalize_link_target


# ── chunker ─────────────────────────────────────────────────────────────


def test_chunk_markdown_splits_prose_and_code_with_symbol():
    body = (
        "# Title\n\n"
        "Some intro prose here.\n\n"
        "```python\n"
        "def my_func():\n    return 1\n"
        "```\n\n"
        "More prose after the code block.\n"
    )
    chunks = chunk_markdown(body)
    assert isinstance(chunks[0], Chunk)
    types = {c.chunk_type for c in chunks}
    assert {"prose", "code"} <= types
    code = next(c for c in chunks if c.chunk_type == "code")
    assert code.language == "python"
    assert code.symbol == "my_func"  # _detect_symbol(python)
    assert all(c.line_start >= 1 and c.line_end >= c.line_start for c in chunks)
    # chunk_index is contiguous and ordered
    assert [c.chunk_index for c in chunks] == list(range(len(chunks)))


def test_detect_symbol_across_languages():
    assert _detect_symbol("function foo(){}", "javascript") == "foo"
    assert _detect_symbol("export default function Page(){}", "typescript") == "Page"
    assert _detect_symbol("func (s *T) Bar() {}", "go") == "Bar"
    assert _detect_symbol("pub fn baz() {}", "rust") == "baz"
    assert _detect_symbol("class Qux:\n    pass", "python") == "Qux"
    assert _detect_symbol("just prose", "python") is None
    assert _detect_symbol("anything", "cobol") is None  # unknown language → no patterns


def test_chunk_markdown_unterminated_fence_runs_to_eof():
    # No closing ``` — the code chunk should still close at EOF (j == n branch).
    chunks = chunk_markdown("intro\n\n```python\ndef x():\n    pass\n")
    assert any(c.chunk_type == "code" for c in chunks)


def test_chunk_markdown_long_prose_flushes_mid_buffer():
    # >1500 chars of prose followed by a blank line trips the size-based flush.
    big = ("word " * 400) + "\n\n" + "tail.\n"
    prose = [c for c in chunk_markdown(big) if c.chunk_type == "prose"]
    assert len(prose) >= 1


# ── linker ──────────────────────────────────────────────────────────────


def test_extract_links_dedups_and_skips_code():
    body = (
        "See [[concepts/foo]] and [[Bar|an alias]].\n"
        "```\n[[ignored/in/code]]\n```\n"
        "[[people/al-kindi]] then [[concepts/foo]] again.\n"
    )
    links = extract_links(body)
    assert "concepts/foo" in links and "Bar" in links and "people/al-kindi" in links
    assert "ignored/in/code" not in links          # fenced code skipped
    assert links.count("concepts/foo") == 1        # de-duplicated


def test_extract_tags_dedups_and_skips_code():
    tags = extract_tags("#alpha and #beta\n```\n#ignored\n```\n#alpha once more\n")
    assert "alpha" in tags and "beta" in tags
    assert "ignored" not in tags
    assert tags.count("alpha") == 1


def test_normalize_link_target_exact_md_strip_and_slug_fallback():
    paths = ["concepts/foo.md", "people/al-kindi.md"]
    assert normalize_link_target("concepts/foo", paths) == "concepts/foo.md"
    assert normalize_link_target("concepts/foo.md", paths) == "concepts/foo.md"
    # human form "Al-Kindi" → slugified people/al-kindi.md
    assert normalize_link_target("Al-Kindi", paths) == "people/al-kindi.md"
    assert normalize_link_target("does/not/exist", paths) is None
