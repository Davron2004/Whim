# Proposal: synthetic-run-harness

## Why

The generation loop (#11) needs a "run + observe" stage: static checks (#9, done) are explicitly never authoritative for run behavior, and today nothing executes a candidate bundle between esbuild and a human's eyeballs. Roadmap #10 and decision #42 pin the design point — server-side headless Chromium reusing the invariants machinery, same generated artifacts, same trusted-vantage rule (F4); on-device remains the acceptance tier, never the per-generation smoke test. Every load-bearing precursor already exists (research.md): the boot recipe (`run-against-build.mjs`), the artifact pipeline (`build/assemble.mjs` + `runtime-artifacts.json`), the real-bridge-in-Chromium seam (`syscallSink:'exposed'` + `page.exposeFunction`, proven by the bridge-invariants suite), the `:memory:` storage binding (#40), and the diagnostics catalog whose wire shape explicitly reserved room for runtime producers. This change assembles them into a library the pipeline's stubbed `run` stage can later call.

## What Changes

- New library (plain top-level directory like `checks/` — not an npm workspace) that, given one candidate TS source string: builds it with the production esbuild contract, boots it in the **unmodified** real runtime page under headless Chromium (locked CSP, real nonce handshake), and returns a deterministic run report.
- **Synthetic interaction sweep**: enumerate interactive SDK elements from the trusted vantage (CDP/Playwright, which pierces the opaque-origin iframe), act on each once — tap buttons/cards/list items, type canonical values into inputs, toggle switches/checkboxes, select each segment, drag sliders to min/max, drive modals inside-first/dismiss-last — with fingerprint dedup, re-enumeration after each action, and a fixed action order for run-to-run determinism.
- **Screen coverage** (requires `sdk-navigation`, proposed alongside): follow real `nav.navigate` paths (observing `__whimNavDepth` hints for traversal bookkeeping only, never as authority), and cold-mount each declared screen that no nav path reached; an unreachable screen is itself a warning diagnostic.
- **Trusted-vantage observation only** (F4): nonce-authenticated `paint`/`error`/`probes`/`delivery` frames, Playwright `pageerror` (throws + unhandled rejections), console capture (SDK warnings), and gate denials read host-side off the harness's own dispatch function — never the bundle's self-report.
- **Real capabilities, ephemeral effects**: the production gate + dispatcher + registry with a real storage engine on `createNodeSqlExecutor(':memory:')` per run (schema applied pre-mount when declared); `cues`/`diag` effectors record invocations instead of acting. The gate is never faked.
- **Watchdog**: mount budget (hard `mount_timeout` diagnostic), per-action quiet-window settle (heuristic only — steady background `interval` activity is legal, never a diagnostic), total wall-clock budget (hard kill + `run_truncated` marker). No silent timeout fall-through anywhere.
- **Diagnostics**: runtime-observed kinds (`runtime_throw`, `unhandled_rejection`, `mount_timeout`, `run_truncated`, `containment_failure`, `unreachable_screen`, …) added additively to the central `DIAGNOSTIC_KINDS` vocabulary in `checks/contract.ts`; gate denials reuse the bridge's existing kind strings verbatim (`undeclared_capability` etc.). Every diagnostic carries the mandatory `hint`; `line` present when a source-mapped anchor exists.
- **Isolation lifecycle**: one long-lived Chromium browser, a fresh browser context per candidate run (strictly stronger than the T7 iframe-recreation requirement), page closed after the run; per-stage timing recorded in the report (no numeric latency budgets in v1 — #11 sets budgets from measured data).

## Capabilities

### New Capabilities
- `synthetic-run`: the run-and-observe stage — boot contract, interaction sweep semantics, screen coverage, trusted-vantage observation rules, watchdog policy, capability wiring (real gate / ephemeral storage / recording effectors), determinism guarantees, and the run-report/diagnostic surface.

### Modified Capabilities

None. `harness-diagnostics` already mandates that downstream stages extend the kind vocabulary additively through the checks contract module, and its diagnostic shape already makes `line` optional for runtime producers — this change exercises those provisions without altering any requirement. The generation-server pipeline wiring stays stubbed (#11's job).

## Impact

- **New code**: the harness library directory (builder adapter, Chromium session/lifecycle, sweep driver, observers, watchdog, report assembly) + its Node test suite and a small malformed/hostile candidate corpus (throws-on-mount, undeclared-capability call, infinite interval, never-resolving delay, dangling nav target, forged-verdict attempt).
- **Touched existing code**: `checks/contract.ts` only (additive `DIAGNOSTIC_KINDS` entries). `invariants/`, `build/*` are consumed strictly read-only (agent-protected paths). `contract/`, `server/`, runtime, SDK, bridge, storage: no changes.
- **Dependencies**: `playwright` already a root devDependency; no new packages, no new workspace (avoids the `guard:metro` surface entirely).
- **Ordering**: depends on `sdk-navigation` for the screen-coverage sweep; the boot/observe/single-screen core is independent of it.
- **Downstream**: #11 (`generation-loop`) consumes the library behind the pipeline's `run` stage; the recorded syscall traces and run reports feed eval Tier B (#12).
