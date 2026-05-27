"""Extract [[wiki-links]] and #tags from markdown."""
import re

WIKI_LINK_RE = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]")
TAG_RE = re.compile(r"(?:^|\s)#([A-Za-z][A-Za-z0-9_-]+)")


def extract_links(body: str) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    in_code = False
    lines = body.splitlines()
    for line in lines:
        if line.strip().startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            continue
        for m in WIKI_LINK_RE.finditer(line):
            t = m.group(1).strip()
            if t and t not in seen:
                seen.add(t)
                out.append(t)
    return out


def extract_tags(body: str) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    in_code = False
    for line in body.splitlines():
        if line.startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            continue
        for m in TAG_RE.finditer(line):
            t = m.group(1)
            if t not in seen:
                seen.add(t)
                out.append(t)
    return out


def normalize_link_target(raw: str, all_paths: list[str]) -> str | None:
    """Resolve a wikilink target string to an existing page path.

    Bug #12 fix: strip the `.md` suffix from *both* sides of the
    comparison. Previously we only stripped it from `raw`, so a link
    like `[[concepts/foo]]` could never match the page stored at
    `concepts/foo.md` — every cross-page link landed in the `links`
    table with `target_id=NULL`, the graph view had zero edges, and
    backlinks were always empty.
    """
    raw_norm = raw.strip().lower()
    raw_no_md = raw_norm[:-3] if raw_norm.endswith(".md") else raw_norm

    def _strip(p: str) -> str:
        pl = p.lower()
        return pl[:-3] if pl.endswith(".md") else pl

    # Exact path match (preferred).
    for p in all_paths:
        if _strip(p) == raw_no_md:
            return p
    # Fallback: slugified human-readable form like [[Al-Kindi]] →
    # people/al-kindi(.md).
    slug = raw_no_md.replace(" ", "-")
    for p in all_paths:
        ps = _strip(p)
        if ps.endswith("/" + slug) or ps == slug:
            return p
    return None
