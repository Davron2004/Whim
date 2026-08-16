# Research digest: close the remaining unguarded Playwright host binding and the research primitive that missed it

## The bug: an unguarded host binding in the bridge invariants suite

`invariants/sandbox-isolation/bridge/runner.mjs:72` is `await page.exposeFunction('whimHostDispatch', host.dispatch);` — unguarded. Playwright's `exposeFunction` installs the binding on the global of every execution context in the page, including the opaque-origin sandboxed `srcdoc` iframe, and discards the `{context,page,frame}` source; it is `exposeBinding` plus a wrapper that throws the source away. `host.dispatch` is wired to the real `Dispatcher.handle` over a real `:memory:` engine (`invariants/sandbox-isolation/bridge/host-shim.ts:48-49,73-79`). A hostile bundle running in the sandboxed iframe can call `globalThis.whimHostDispatch(frame)` directly and receive an authoritative sysret from the real gate, bypassing the outer-page relay entirely.

## Why scenario 1 does not catch it

Scenario 1, "STORAGE REACHABLE ONLY AS SYSCALLS" (`runner.mjs:88-101`), asserts a round-trip succeeded by regexing the iframe's rendered DOM (`/loaded from storage|saved/`, `/Glasses[\s\S]*\b1\b/`). It never asserts which frame called the dispatcher. A grep of `runner.mjs` for `mainFrame` and `source.frame` returns zero hits. The invariant is vacuous against the exact adversary it claims to model.

## The legitimate call path is already main-frame

The legitimate path is already main-frame-only, so a provenance guard is behaviour-preserving, not a redesign. `build/assemble.mjs:185-210` defines `buildOuterHtml`; `syscallSink` has exactly two legal values, `'rn'|'exposed'` (`build/assemble.mjs:182-183`). The `'exposed'` branch is `relaySyscall` (`build/assemble.mjs:121`), inside `orchestrationScript`, which per the file's own comment (`build/assemble.mjs:87`) runs "in the WebView page, NOT the iframe" — reachable only from the outer page's message listener, which already checks `ev.source !== (iframe && iframe.contentWindow)` (`build/assemble.mjs:143`). Sysret returns via outer-page `postMessage` into the iframe (`build/assemble.mjs:120`). The sandbox-side emitter (`src/runtime/web/syscall.js:32-52`) only ever uses `window.parent.postMessage` — the bundle has no legitimate reference to `whimHostDispatch`. This is the operative rule from decision #41: syscall authority is `ev.source === window.parent`, never a nonce.

## The proven fix pattern from the parent change

`synthrun/observe.ts:492-502` and `synthrun/capability.ts:145,153-154` already ship the fix, red-checked in the parent change: `exposeBinding` (not `exposeFunction`) with a first-statement guard — `source.frame !== page.mainFrame()` at page level, `source.frame !== source.page.mainFrame()` at context level — that refuses before `JSON.parse` and before `dispatcher.handle`. `source` is typed structurally since Playwright does not re-export `BindingSource`. Refusal returns `null`, the dispatcher's own no-result shape, deliberately not an error string, because Playwright's `deliverBindingResult` evaluates the return expression back inside the caller's own realm.

## Existing detection: none, and ESLint is structurally blind

Zero hits for `exposeFunction`/`exposeBinding` in `scripts/gate.sh`, `scripts/gate-full.sh`, or `knip.json`. `.eslintrc.js`'s one `no-restricted-syntax` array (lines 5-19) covers three unrelated selectors. `.eslintignore` excludes `invariants/` (plus `fixtures/adversarial/`, `src/runtime/web/`, `build/generated/`) by design, because those are adversarial fixtures that reach for forbidden globals on purpose — so an ESLint rule provably cannot see the one vulnerable file. `checks/` is not ESLint and is not in `.claude/hooks/protect-harness.sh`'s protected list, so a new pass there reaches `scripts/gate.sh:63`'s `checks:test` step (Class-1, no gate-script edit).

## Pattern census: every Playwright host binding in the repo

| site | API | classification | test applied |
|---|---|---|---|
| `invariants/sandbox-isolation/bridge/runner.mjs:72` | `page.exposeFunction('whimHostDispatch', host.dispatch)` | **UNSAFE** | no frame-provenance check exists; grep for `mainFrame`/`source.frame` in file → zero hits |
| `synthrun/observe.ts:492` | `page.exposeBinding(RELAY_BINDING_NAME, …)` | SAFE | first-statement `source.frame !== page.mainFrame()` rejection, `observe.ts:493` |
| `synthrun/capability.ts:145` | `context.exposeBinding('whimHostDispatch', …)` | SAFE | first-statement `source.frame !== source.page.mainFrame()` rejection returning `null`, `capability.ts:153-154` |

Not-a-binding (read-only sinks, no host capability reachable from page JS, out of this census's scope): `invariants/sandbox-isolation/run-against-build.mjs:40,241` and `invariants/sandbox-isolation/bridge/runner.mjs:71` (`page.on('console')`), `synthrun/observe.ts:543` (`page.on('console')`), `synthrun/observe.ts:538` (`addInitScript` name scrub — defence-in-depth, not the guarantee). `evaluateHandle` has zero occurrences repo-wide; `run-against-build.mjs` exposes no binding at all.

## How the research primitive failed across three runs

The failure was a wrong comparison axis, not "assumed owner-authored code is correct" and not name pattern-matching. `harden-synthrun-binding-isolation/research.md:85-88` cited `runner.mjs:72` only to explain why synthrun's exposure is context-level versus its precedent's page-level — comparing `page.` vs `context.` and stopping — while the same document had, at `:55-60`, independently established that `exposeFunction` discards the source. The two facts were never crossed. This propagated across three runs: `synthetic-run-harness/research.md:5,46` baptised `runner.mjs:72` as "the precedent" and "the load-bearing precedent" — once labelled a recipe, later reads consult it for shape, not soundness. `harden-containment-observation/research.md:45` read the line with the vulnerability class already established and still closed it as out of scope: "No edit to `invariants/` is implied by anything I found." `harden-synthrun-binding-isolation/progress.md:222-224` names the mechanism directly: the citation "shares the flaw" it was compared against. The classification "owner-authored / out of scope" (decision #28) was applied *before* the soundness question, removing the incentive to ask it.

## No mandated sink for out-of-scope findings

`openspec/critic/open-follow-ups.md:1-14` self-describes as the backlog for findings deliberately not fixed, but nothing in `.claude/commands/opsx/apply.md`, `.../propose.md`, `.claude/agents/researcher.md`, or the `whim-harness` schema requires writing to it — `apply.md:40,57` cover only implementer-sourced deviations, not researcher-sourced ones. The finding survived three runs only as prose in `research.md`/`progress.md` files and needed a human to hand-carry it forward. `.claude/agents/researcher.md:15` scopes "docs, not code, is truth" to settled decisions only, saying nothing about code cited as an exemplar; `.claude/agents/reviewer.md:13-14` scopes the reviewer to the diff, so no later pass re-audits a research citation's soundness.

## Constraints and invariants

Decision #28: `invariants/` is owner-authored, and the suite's non-vacuity is load-bearing — so a new scenario added here carries its own recorded red-check (neuter the guard, confirm the hostile write lands pre-fix), exactly as the existing negative control does for the scenarios it covers. A scenario whose red-check is not recorded is not evidence. Decision #41: bridge syscall authority is `ev.source === window.parent`, registry append-only, dispatcher generation-fenced — a frame-provenance guard on the test harness's own binding is an *additional* necessary condition for the test to be sound, never a change to the product's own authority rule. Nonce-authenticated verdicts (spike2 §3, finding F4) are unrelated to this guard and must not be conflated with it.

## Risks and unknowns

The census above is repo-wide as of this branch: `exposeFunction`, `exposeBinding`, `addInitScript` and `evaluateHandle` were swept across `scripts/`, `invariants/`, `build/`, `src/`, `server/`, `contract/`, `synthrun/`, `checks/`, `openspec/`, `docs/`, `.claude/` and `.codex/`, and the three rows are the complete set of live host↔page bindings (`evaluateHandle`: zero occurrences; hits under `openspec/changes/archive/**` are historical prose, not live code). What is *not* durable is the sweep itself — it is a one-time claim that rots on the next commit. Workstream A's AST check is what converts it into a standing property.

Unverified: that `page.exposeBinding` behaves identically under the invariants suite's Playwright entry path (`runner.mjs` does `chromium.launch()` + `newPage()` per scenario, where synthrun goes through a session wrapper). Chain B's red-check is what settles it — if the guard misbehaves there, the new adversarial scenario fails loudly rather than silently passing.
