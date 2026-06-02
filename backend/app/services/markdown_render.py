"""Server-side Markdown → HTML rendering for artifact bodies.

The wiki itself renders markdown client-side (the frontend ships its own
markdown component). Artifacts need a server-side renderer because the
viewer route at `/a/<short_id>` returns a fully-rendered HTML page — no
React bundle is loaded for the minimal artifact shell, so the markdown
has to be HTML by the time it leaves the server.

Uses `markdown-it-py`, which is already in `backend/requirements.txt:12`
for the chunker/indexer side of the codebase.

Safety: `html=False` blocks raw `<script>` and event-handler attributes
in the source markdown. Markdown artifacts are therefore safe to inline
in the outer shell page; only HTML artifacts get the iframe sandbox.
"""
from markdown_it import MarkdownIt

# Module-level singleton — MarkdownIt is thread-safe for `.render()` and
# constructing it per request adds noticeable overhead under load.
_md = (
    MarkdownIt("commonmark", {
        "html": False,        # do NOT pass raw HTML through; strips <script> etc.
        "linkify": True,      # bare URLs auto-link
        "typographer": True,  # smart quotes / dashes / ellipses
    })
    .enable(["table", "strikethrough"])
)


def render_markdown_to_html(body: str) -> str:
    """Render a markdown string to safe HTML."""
    return _md.render(body)
