# Agent playbook for Enflame Wiki

This file is the **schema layer** for the LLM Wiki. It is injected into the
agent's context whenever it ingests a raw source or runs a lint pass.
Edit it to change how the agent structures and curates the wiki.

## Page taxonomy

Wiki pages live in these top-level folders. Pick the one that fits; create
a new folder only if none of these are reasonable.

- `concepts/` — abstract ideas, definitions, frameworks, patterns
- `people/` — humans (employees, authors, public figures) referenced more than once
- `sources/` — short summary pages for raw input documents (one per RawSource)
- `examples/` — concrete cases, walkthroughs, anecdotes
- `engineering/`, `product/`, `design/`, `operations/`, `research/` — existing functional areas

## Wiki-link rules

- Every named entity (concept, person, source, example) on second mention should be linked: `[[name]]`.
- Use `[[name|display text]]` to link with custom display text.
- Prefer linking to a concept page over duplicating its definition.

## Ingest rules

When ingesting a raw source:

1. Read the entire raw source.
2. Identify entities: concepts, people, sources, examples.
3. For each entity:
   - If a wiki page exists, append a section with new information, preserving prior content.
   - If not, create a new page in the appropriate folder.
4. Always create a `sources/<slug>.md` page summarizing the raw source itself (≤ 250 words). Link this page from every other page that draws on the source.
5. Cross-link aggressively: where two pages reference the same concept, both should `[[link]]` to the concept page.
6. Flag contradictions inline with `> [!conflict]` callouts; do not silently overwrite existing claims.
7. Submit all changes as drafts through the existing review workflow — never bypass it.

## Lint rules

When running a lint pass:

- Find pages with no inbound `[[wikilinks]]` (orphans). Either link them from a related page or recommend deletion.
- Find broken `[[wikilinks]]` (target not found). Either fix the target or convert to plain text.
- Find pages that reference the same fact differently — flag as `[!conflict]`.
- Find `sources/<slug>.md` pages with no corresponding RawSource row (or vice versa).
- Output a structured report; do not auto-edit.

## Answer formatting

When answering a user's question from the wiki:

- Synthesize from full wiki pages, not from raw chunks.
- Cite the wiki page (not the raw source) using `[[page-path]]`.
- If the wiki has no good answer, say so explicitly and recommend a raw source to ingest.
- Do not invent facts. If contradictions exist, surface them.

## Authority

You are an agent operating under one user's permissions. Drafts you create
go through the same review queue as human drafts. Editors and admins must
approve before content publishes. Do NOT attempt to bypass `submit_for_review`.
