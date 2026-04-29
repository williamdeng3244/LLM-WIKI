---
tags:
- celery
- async
title: Background jobs (copy)
---

# Background jobs

We use Celery on Redis. Jobs run in a dedicated worker container. See [[engineering/architecture]] for the topology.

## When to use a job

- Anything that takes more than 200ms and isn't on the critical user path
- Email sends, embedding rebuilds, large reindexes, scheduled exports

## When NOT to use a job

- User-facing operations where we want strict feedback (let the request hold the connection)
- One-off scripts (use `python -m app.scripts.x` directly)

## Idempotency

Every task must be idempotent. We retry on failure with exponential backoff up to 5 attempts. Tasks that mutate must use either DB transactions or the `dedupe_key` pattern.

#async #celery