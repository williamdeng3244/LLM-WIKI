---
title: System architecture
tags: [architecture, overview]
---

# System architecture

We run a modular monolith with a clear seam at the API layer. Reads dominate writes by ~40:1, so we optimize the read path aggressively.

## Components

The web tier serves SSR pages from Next.js and proxies API calls to the Python backend. The backend uses [[engineering/authentication]] for identity and [[engineering/postgres-conventions]] for persistence. Long-running work goes to the Celery queue described in [[engineering/background-jobs]].

## Data flow

User → Next.js → FastAPI → Postgres (+ pgvector) and Redis. The vector store is colocated with the relational store; we don't run a separate vector DB.

## Why this shape

- Modular monolith keeps deploy simple while we're under 50 engineers
- Single Postgres with pgvector means one consistency story
- Async Python (FastAPI) handles our IO-bound load with one process per CPU

#architecture #infrastructure
