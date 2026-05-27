---
title: Postgres conventions
tags: [database, conventions]
---

# Postgres conventions

We use Postgres 16 with the `vector` extension for embeddings. All schemas managed via Alembic. See [[engineering/architecture]] for where Postgres sits in the system.

## Naming

- Tables: plural snake_case (`users`, `api_tokens`)
- Foreign keys: `{singular_table}_id` (`user_id`, `page_id`)
- Indexes: implicit on PKs and FKs; explicit indexes named `ix_{table}_{cols}`

## Timestamps

Every row has `created_at`. Mutable rows have `updated_at`. Both `TIMESTAMP WITH TIME ZONE`, server-default `NOW()`.

## Soft deletes

We don't soft-delete — we use append-only patterns where retention matters (see [[engineering/audit-log]]). When a thing is "gone," we deactivate it (`is_active = false`).

#database #postgres
