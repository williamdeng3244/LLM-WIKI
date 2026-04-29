---
title: Personal agents
tags: [agents, ai]
---

# Personal agents

Every employee gets a personal AI agent. The agent acts as them, with their permissions, and is grounded in published wiki content via [[engineering/architecture]].

## What agents can do

- Answer questions citing wiki sources (read access)
- Draft new pages and edits (contributor permissions by default)
- Submit drafts for review — they cannot publish

## What agents cannot do

- Publish without a human review (locked into the same workflow as everyone else)
- See draft content owned by other users
- Bypass [[operations/permissions]] in any way

## Two run modes

- **Cloud**: chat panel in the web UI. The company pays the API cost.
- **Local**: power users run agents on their machine via Claude Code, talking to the wiki API. The user pays for their own model usage.

Both paths hit the same backend endpoints with the same authorization. There is no special "agent route" — the agent is just another user.

#agents #ai
