# Enflame Wiki — Performance Test Report

**Date:** 2026-06-11  **Scope:** single-client API latency + the 2D graph. **Dataset:** the live dev DB — **2,475 published pages**.

> §1–4 measure **single-client latency** (one request at a time). §5 adds a **concurrent load test** (30 simultaneous clients) — the key result: zero failures under load, but throughput-limited (p95 ~5.7 s), so multiple workers + pagination are needed before many concurrent users.

---

## 1. API endpoint latency (p50 / p95, n=25 each)

Measured against the running backend with 2,475 pages in the database.

| Endpoint | p50 | p95 | max | Verdict |
|---|---:|---:|---:|---|
| `GET /api/auth/config` | 2 ms | 2 ms | 3 ms | ✅ trivial |
| `GET /api/pages/{path}` | 8 ms | 9 ms | 10 ms | ✅ fast |
| `GET /api/notifications` | 9 ms | 11 ms | 13 ms | ✅ fast |
| `GET /api/revisions/review-queue` | 20 ms | 23 ms | 24 ms | ✅ fast |
| `POST /api/pages/draft` (write) | 22 ms | 26 ms | 29 ms | ✅ fast |
| `GET /api/search?k=10` (vector) | 33 ms | 43 ms | 64 ms | ✅ acceptable |
| **`GET /api/pages` (list ALL)** | **98 ms** | **503 ms** | 554 ms | ⚠️ **slow, O(n)** |
| **`GET /api/graph` (2,475 nodes)** | **109 ms** | **525 ms** | 567 ms | ⚠️ **slow, O(n)** |

---

## 2. Key finding — the two "list everything" endpoints don't scale

`GET /api/pages` and `GET /api/graph` return **all** pages/nodes with **no pagination**, so their cost grows linearly with the wiki size. At 2,475 pages they're already **~100 ms typical / ~500 ms p95**, and they will keep getting slower as the wiki grows. They're also the heaviest part of first paint (the sidebar list + the graph both call them).

**Recommendations:**
- **Paginate or cap** `GET /api/pages` (e.g., return a page of results; the quick-switcher can lazy-load / server-side filter).
- For `GET /api/graph`, **prune server-side** for large graphs — e.g., return the top-N nodes by backlinks, or cluster folders into super-nodes — instead of shipping every node.
- Consider a short **cache** on both (they change only on publish).

---

## 3. 2D knowledge graph (the reported lag) — fixed

**Symptom:** the 2D graph was laggy. **Cause (confirmed in `GraphView.tsx`):** with 2,475 nodes it was

1. **redrawing forever** — `cooldownTicks/cooldownTime = Infinity` kept the force simulation + canvas redraw running permanently, even when idle;
2. doing **two `createRadialGradient` calls + 4 arc fills + text per node, every frame** (halo + inner highlight) — a per-frame cost that scales with node count;
3. animating **directional link particles** continuously.

**Fix (shipped):** a node-count-gated **performance mode** (>200 nodes):
- **lite rendering** — a single solid circle per node, no per-node gradients (the focused node + its neighbours still render richly, so interaction stays pretty);
- **finite, tiered cooldown** — the simulation settles and **stops** instead of ticking forever; the tick budget scales *down* with size (≈90 ticks at 2,475 nodes vs 400 for mid-size) with faster cooling (`alphaDecay` 0.06 vs 0.018) + heavier damping for huge graphs, so the initial settle and every reheat are short; slider changes re-warm it via `applyPhysics`, dragging a node auto-reheats;
- **no particles** in perf mode.

Small graphs are unchanged (they keep the rich, perpetually-live look).

> Further headroom for very large graphs: server-side graph pruning (§2) so the client renders hundreds, not thousands, of nodes.

---

## 4. Observation (not perf, but flagged) — the graph has **0 resolved links**

`GET /api/graph` returns 2,475 nodes and **0 links** — the graph is a disconnected cloud. This is a *data/linking* matter, not performance, but it makes the graph far less useful. Worth investigating whether `[[wikilinks]]` resolution (`resolve_all_links`) is running / whether the content actually cross-links. Tracked separately from this report.

---

## 5. Concurrent load test — 30 simultaneous clients, 600 requests

Mixed read/write load (search, page-get, list-all, draft-create) at 30 concurrency:

| Metric | Value |
|---|---|
| Throughput | **~22 req/s** |
| Latency p50 | 127 ms |
| Latency **p95** | **5,726 ms** |
| Latency p99 | 6,571 ms |
| Errors / 5xx | **0 (0.0%)** — all 200 |

**Read this carefully:** the system stays **correct under concurrency** — *zero* errors, no 5xx, no DB connection-pool exhaustion, no race-condition corruption. But it is **throughput-limited**: p95 latency blows out to **~5.7 s** under 30 concurrent users. Causes:

1. **Single uvicorn worker** — one process, one event loop; CPU-bound work (vector math, large serializations) doesn't parallelize across cores.
2. **Embedding `asyncio.Lock`** — `embed_texts` serializes all encodes behind one lock, so concurrent `/api/search` calls queue.
3. The **unpaginated heavy endpoints** (§2) — every `/api/pages` / `/api/graph` in the mix is an O(n) scan.
4. Default **DB connection pool** (~5) — concurrent DB ops queue.

**Recommendations (in priority order):**
- **Run multiple workers** in production — `gunicorn -w <2–4×cores> -k uvicorn.workers.UvicornWorker` (or several replicas behind the reverse proxy). Biggest single win.
- **Paginate** `/api/pages` + prune `/api/graph` (§2).
- **Raise the DB pool** (`pool_size`/`max_overflow`) to match worker concurrency.
- Move embeddings to a **thread/worker pool** so search doesn't serialize on one lock.

> Verdict: safe for a **modest internal user base** today (no failures under load), but **address workers + pagination before many concurrent users** or the experience degrades to multi-second responses.

---

## 6. Multi-worker validation + soak (2026-06-12, on the cleaned 47-page DB)

After clearing ~5,400 QA test pages (graph 5,467 → 47 nodes), I re-ran a **search-heavy** read load (≈60% `/api/search`, which serializes on the embedding `asyncio.Lock`) to isolate the *concurrency* bottleneck from the now-moot unpaginated-endpoint one, and to validate the headline recommendation (multiple workers).

**1 worker vs 4 workers — 30 concurrent clients, 600 requests, identical mix:**

| Metric | 1 worker | 4 workers | Δ |
|---|---:|---:|---:|
| Throughput | 10.2 req/s | **41.2 req/s** | **4.0×** |
| Latency p50 | 1,304 ms | **55 ms** | **24× faster** |
| Latency **p95** | **39,369 ms** | **2,282 ms** | **17× faster** |
| Latency p99 | 41,615 ms | 12,908 ms | 3.2× |
| Errors | 0 | 0 | both correct |
| Backend RSS | 0.66 GB | 2.24 GB | ~4× (one model per worker) |

**Running multiple workers is the single biggest win** — near-linear throughput scaling and a p95 collapse from ~39 s to ~2.3 s. (Measured with `uvicorn --workers 4`; production should use `gunicorn -w <2–4×cores> -k uvicorn.workers.UvicornWorker` for proper process supervision.)

**Soak — 4 workers, 20 concurrent, 3 min sustained (1,669 requests):**

| Signal | Result |
|---|---|
| Errors / 5xx | **0** — stable, no crashes under sustained load |
| Backend RSS | 2.239 → 2.25 GB — **no memory leak** |
| DB connections | 73 → 73 — **no connection leak** |
| Latency under sustain | p50 ~700 ms, p95 ~11 s — still embedding-lock-bound |

**Two follow-ups this surfaced:**
- **The embedding `asyncio.Lock` is the residual bottleneck even with 4 workers** — the lock is *per-worker*, so 20 concurrent searches over 4 workers still queue ~5-deep each (~700 ms p50 / ~11 s p95 under sustained search load). The deeper fix is to move `embed_texts` off the lock onto a **thread pool** (or a dedicated embedding service) so encodes parallelize within a worker too.
- **Multiple workers multiply DB connections** — the 4-worker instance alone drove ~73 live connections (Postgres default `max_connections = 100`). In production, **tune `pool_size`/`max_overflow` per worker** to stay under the cap, or front the DB with **pgbouncer**.

---

## 6.5 Capacity sizing for the 700–900-staff deployment (2026-06-12)

Graduated load on the 4-worker instance, plus a 6-minute soak, to size the real deployment. Two traffic mixes: **search-heavy** (worst case — `/api/search` serializes on the per-worker embedding lock) and **real** (poll-heavy — the three 30-second SWR polls + page reads + occasional searches, i.e. what staff actually generate).

| Mix | Concurrency | Throughput | p95 | Errors |
|---|---:|---:|---:|---:|
| real | 25 (6-min soak, 122,692 req) | **340 req/s** | **231 ms** | **0** |
| real | 50 | 179 req/s | 1.4 s | 0 |
| real | 100 | 192 req/s | 1.5 s | **19 %** (knee) |
| search | 30 | 41 req/s | 2.3 s | 0 |
| search | 50 | 18 req/s | 18 s | 0 |
| search | 100 | — | — | **18 %** |

**6-min soak: 0 errors, RSS 2.072 → 2.077 GB (no leak), DB conns 82 → 82 (no leak).**

**Key finding — load is bounded by *visible* tabs, not headcount.** The app polls 3 endpoints every 30 s per open tab, but `refreshWhenHidden` is unset, so **SWR's default pauses polling on hidden/backgrounded tabs** — a user who leaves the wiki in the background generates ~0 requests. Only actively-*visible* tabs poll (~0.1 req/s each). So even a generous 200 simultaneously-viewing staff ≈ **20 req/s** baseline — ~6 % of the 340 req/s the 4-worker stack sustains. The real constraint is *concurrent search* (the embedding lock), which realistically stays < 10 at any instant for this population.

**Deployment requirements (700–900 staff):**

| # | Item | Spec |
|---|---|---|
| 1 | **Workers** | `gunicorn -w 4 -k uvicorn.workers.UvicornWorker` is comfortable; **4–8** (≈ CPU cores) for search-burst margin. |
| 2 | **Backend RAM** | ~**2.2 GB** at 4 workers (one ~500 MB embedding model each), ~4 GB at 8. Host **8–16 GB** including Postgres + Redis + MinerU. |
| 3 | **CPU** | **4–8 cores** (workers are CPU-bound on embedding for search). |
| 4 | **🔴 DB connections** | 4 workers + the stack drove **~82** live connections (Postgres default cap **100**). **Raise `max_connections` to ~200**, tune `pool_size`/`max_overflow` per worker, or front with **pgbouncer**. Do *not* add workers without this — you will exhaust connections. |
| 5 | **Warmup** | Pre-warm the embedding model on deploy (~8–10 s/worker first-load). |
| 6 | Optional | If search becomes hot, move `embed_texts` off the per-worker lock to a thread pool / dedicated service. |

---

## 7. Not covered (recommended next)

- **Embedding model warmup** — the local model loads ~8–10 s on first use; pre-warm on deploy.
- **Frontend bundle / first-paint** profiling under a throttled network.
- ✅ **Sustained / soak test** — done (§6): 3 min sustained, no memory/connection leak, 0 errors. A longer multi-hour soak before launch would further de-risk slow leaks.
