---
title: Permission model
tags: [ops, permissions, security]
---

# Permission model

Four roles, three stability levels per page, scoped editor assignments. Simple to reason about; hard to bypass.

## Roles

- **Reader** — read published pages only
- **Contributor** — read + draft + comment + flag (default for employees)
- **Editor** — contributor + review/publish in their assigned categories
- **Admin** — everything, including locking pages and managing roles

## Stability per page

- **Open** — any contributor's draft auto-publishes on submit (low-stakes brainstorm pages)
- **Stable** — drafts go to the review queue (default)
- **Locked** — only admins can publish (sensitive or canonical pages)

## How agents fit

Agents inherit their owner's role but default to contributor regardless. Agents always go through review — they cannot publish unilaterally. See [[product/personal-agents]].

## Audit

Every state change writes an `audit_log` row: who, when, what, payload. Append-only.

#permissions #security
