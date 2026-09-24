# developer-observability reviewer (whole change) — harness feedback

- **What:** A privacy leak (F1: model-written plan text through the allowlisted `reason`) passed the allowlist design, 4 chains and their gates. **Mechanism:** spec/plan/contract; the allowlist test checks key parity with the contract, never the provenance of each allowed field's value. **Verdict:** CAUGHT-REAL-MISTAKE (final reviewer). **Cost:** ~8 calls. **Evidence:** `LauncherRoot.tsx:1608`, `plan.ts:136-150`.
- **What:** RN fakes assume every fatal goes through `ErrorUtils`; React 19's `onUncaughtError` doesn't. **Mechanism:** Node suites with injected RN globals; device checks deferred to chain-8. **Verdict:** CAUGHT-REAL-MISTAKE. **Cost:** 4 calls. **Evidence:** `ErrorHandlers.js`.
- **What:** Chain-5 invented a name for chain-4's code (`diagnosticsTransport`). **Mechanism:** parallel dispatch without a seam-name contract (T1/T13). **Verdict:** DRAWBACK. **Cost:** 1 call.
- **What:** Log shipping widened where existing Caddy error lines go, and nobody reviewed their content. **Mechanism:** plan scope covered new producers only (T14). **Verdict:** CAUGHT-REAL-MISTAKE (confirmed live by the orchestrator: `X-Whim-Device` in Cloud Logging since 2026-09-15).
- **What:** The main tree was busy, so the review ran entirely on `git show <sha>:path`. **Verdict:** NEUTRAL.

**What helped:** per-chain reports and Class-A notes in the ledger; `handoff/log-shipping.md`'s field paths; server tests driving real refusals through `createApp`; host UI tests built from INV-ERRFRAME's real frames.

**What the harness should change:**
1. For any allowlist/egress design, a table per allowed field: every producer and whether its value is a closed code or free text, plus a test pushing real producer output through the projection.
2. Every RN global a Node suite fakes (`ErrorUtils`, `HermesInternal`, AppState) gets a named device check, including routes the fake doesn't model.
3. When a change widens where an existing log goes, the plan lists and reviews every existing writer of that log.
