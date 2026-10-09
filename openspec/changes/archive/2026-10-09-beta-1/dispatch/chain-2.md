# chain-2 dispatch block (as sent 2026-09-25 14:05; resume from WIP 6eb0e3d3 on chain/beta-1-2)

Tasks 2.1–2.3 verbatim from tasks.md. Read: specs/server-admission-control/spec.md (the line requirement and
its 5 scenarios only; the load-test requirement is orchestrator task 10.2), specs/generation-pipeline/spec.md
(quantization floor only), design.md §D8 §D12, research.md §Constraints (release() idempotent; model ids from
env), openspec/changes/public-generation-server/specs/server-admission-control/spec.md (live text),
handoff/wire-protocol.md.

Decisions made for the implementer:
1. A queued generation holds its device's exclusivity until it leaves the line or finishes; the only daily limit
   a waiter can lose while waiting is the global ceiling.
2. Pre-stream: check a unit is available (device + global) without spending. Spend when the slot is taken. If
   that spend fails (global ceiling only): one terminal `failure` with the pre-stream ceiling refusal's hint; no
   slot kept.
3. `queue_timeout` reason = `serverBusyRefusal().body.hint`; drain eviction uses the same reason.
4. Find how the ledger row relates to the daily unit before adding codes. Row created with the spend → waiters
   have no row, no new code. Row before the slot → `queue_timeout` covers timeout + drain; abort follows today's
   abort path; a global-ceiling miss at slot time gets a new server-only code in TERMINAL_FAILURE_CODES. Report
   which case, with file:line.
5. Drain: every waiter leaves, holds nothing, spends nothing, and gets one terminal failure; new requests keep
   today's drain refusal.
6. Log at info with requestId: join (position, line length) and leave (outcome slot|timeout|abort|drain|ceiling,
   waitedMs). No content.
7. `queued{position}` on entry, on every move, and at least every 5 s; keep `: keepalive`; emit through
   `eventForLevel(ev, c.get('protocolLevel'))`.
8. `WHIM_QUEUE_MAX` non-negative int, default 50, `0` = no line (today's 429; the rollback lever; document it).
   `WHIM_QUEUE_MAX_WAIT_MS` positive int, default 180000. `WHIM_PROVIDER_QUANTIZATIONS` comma list validated
   against int4,int8,fp4,fp6,fp8,fp16,bf16,fp32,unknown (trim, drop empties, unknown → boot ServerConfigError);
   unset/empty → provider object byte-identical. Use the config/roster seam.
9. Only `generate` queues; unary routes keep their synchronous refusal.
10. release() hands the slot to the head non-aborted waiter; an abort racing the handoff never leaks the slot
    (test it).
11. The load-test driver (`deploy/loadtest/`, via `bench-envelope.ts`) learns the line: `devices > cap` → queued
    then complete; a refusal is expected only past cap + WHIM_QUEUE_MAX; the report adds the queued count and
    p50/p95/max wait; the leak probe also proves the line is empty. Update docs/deploy.md "Load test".

Gate: `./scripts/gate.sh` to FAST GATE PASSED; a test for every scenario, with a fake clock for cadence and
max wait; red-check against one weaker variant (no handoff on release / spend on join / abort doesn't move
others up), naming the failing tests. End the report with HARNESS FEEDBACK (template in
docs/harness-feedback/README.md).
