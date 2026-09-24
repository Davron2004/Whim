# developer-observability fix-3a (implementer) — harness feedback

- **What:** The chain block said to log `code` and query `jsonPayload.code`, but `server/src/logger.ts` redacts any field named `code`; a real-logger test caught it (the code went in `reason`). **Mechanism:** chain block vs logger redaction. **Verdict:** CAUGHT-REAL-MISTAKE. **Cost:** ~4 calls.
- **What:** ~12 full server runs (no single-suite mode). **Verdict:** DRAWBACK (T10). **Cost:** ~15 min.
- **What:** Red-checks against base hand-rolled; `plant()` throws on base files and aborts the suite, so each file had to be swapped separately. **Verdict:** DRAWBACK (T6). **Cost:** 3 extra runs.
- **What:** No local Caddy/Docker/Ops Agent; built Caddy 2.11.4 from source to `caddy validate`; the agent config stays unchecked. **Verdict:** ENV. **Cost:** ~3 min.
- **What:** zsh `nomatch`; co-author conflict; `no-shadow` on `path` locals. **Verdict:** ENV / DRAWBACK (T11) / NEUTRAL.

**What helped:** `handoff/log-shipping.md`'s notes on `move_from`/`omit_if` behaviour on the live agent; the suite's real-line helpers (`filterMatches`, `captureLogs`, `machinePipeline`); the orchestrator's F-decisions in progress.md.

**What the harness should change:**
1. Check chain blocks that name a log field against the logger's redaction list, or make a test helper fail when a logged field comes out hidden.
2. Single-suite filter for `server/test/run.mjs` (T10).
3. A cached pinned Caddy binary for in-chain `caddy validate`, and a documented on-VM dry run for Ops Agent configs.
