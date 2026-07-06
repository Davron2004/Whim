# Critic report 2026-07-02 — product-surface sweep (jurisdiction fan-out)

Scope: the product half of the repo AS IT STANDS at HEAD (597f298) — a coverage sweep, not a diff review; prior reports only covered changed ranges. Method: four jurisdiction-scoped read-only critic subagents run in parallel (server+contract · launcher/bridge/host · storage-engine+version-store · sdk/runtime/fixtures), findings compiled verbatim by the orchestrator. All four cross-checked 2026-06-18-triage.md, the 2026-06-30-fixloop-summary follow-up, and 2026-07-02.md to avoid re-flagging dispositioned items.

Purpose: source the shakedown batch for the whim-fixloop OpenSpec lane. Every finding states mechanical-lane eligibility (independently fixable · decision-free · spec-silent · no protected files).

**Totals: 17 findings — 3 high, 8 med, 6 low. Mechanical-lane eligible: SRV-2, SRV-3, HL-1, HL-2, HL-3, ST-1, ST-3, ST-5, ST-7, RT-2, RT-3 (11), plus RT-1's write-protect half.**

---

## Jurisdiction: server/ + contract/ (SRV)

### [severity: high] SRV-1 — `ReadableStream.cancel()` clears the keepalive timer but never stops the underlying generator — a disconnected client leaves the pipeline running to completion server-side
- Where: `server/src/sse.ts:38-67` (`buildSseStream`), consumed by `server/src/routes/generate.ts:31-32` (`interceptUsage` wrapping `pipeline.run()`)
- Category: 5 (REAL-BUT-HARD)
- What: `cancel()` (sse.ts:64-66) only calls `clearInterval(keepaliveInterval)`. The `for await (const event of source)` loop in `start()` (line 51-54) is never told to stop — nothing calls `source[Symbol.asyncIterator]().return()`, and there is no `AbortController`/`AbortSignal` anywhere in `server/src` or the `Pipeline` interface (`server/src/pipeline.ts:7-9`) to propagate cancellation into `pipeline.run()`. The server's own test for this exact code path (`server/test/server-core.test.ts:300-364`, added for F1) uses a source (`neverYields`) that awaits a promise that never resolves — which incidentally demonstrates rather than tests that the abandoned generator is left dangling forever after `cancel()`.
- Why it matters: today `Pipeline` is a stub with a fixed `delayMs`, so the leak is bounded. The moment the OpenRouter-backed pipeline (`server/src/openrouter.ts`, "wired in #11" per its own header) is mounted behind this same `Pipeline` interface, the identical code path means a client that disconnects mid-generation does **not** abort the live OpenRouter `fetch` — the real LLM call keeps streaming to completion server-side, burning real API cost with no listener. `interceptUsage` will still credit it (no metering *gap*), but there is no cost-control lever at all.
- Suggested approach: add an optional `AbortSignal` parameter to `Pipeline.run`, wire `buildSseStream`'s `cancel()` to abort it, and pass the signal through to `fetchFn` in `OpenRouterClient.stream()`.
- Mechanical-lane eligible: **NO** — interface-level design decision spanning `pipeline.ts`/`openrouter.ts`/`routes/generate.ts`.

### [severity: med] SRV-2 — near-duplicate ~25-line SSE-chunk-parsing block in the OpenRouter client
- Where: `server/src/openrouter.ts:164-190` (per-line loop) vs `server/src/openrouter.ts:196-226` ("flush remaining buffer" tail case)
- Category: 4 (STRUCTURAL SMELL)
- What: both blocks do the identical sequence — parse a `data:` payload as JSON, extract `usage` into `capturedUsage`, extract `choices[0].delta.content` and yield it if non-empty — with only the surrounding control flow differing. The second copy duplicates the `try/catch` around `JSON.parse` and both extraction blocks verbatim.
- Why it matters: two independent code paths implementing the same wire-parsing logic will drift silently — a future field addition (`reasoning_content`, tool-call deltas) or a bugfix to the usage-extraction fallback applied to only one site.
- Suggested approach: extract a `parseChunkLine(payload: string): { usage?: Usage; content?: string } | undefined` helper used by both the main loop and the trailing-buffer flush. Pure refactor, no behavior change.
- Mechanical-lane eligible: **YES**.

### [severity: low] SRV-3 — `DeviceIdError` contract schema is exported and documented as authoritative but never referenced by the code it describes
- Where: `contract/src/index.ts:102-108` (`DeviceIdError`, doc comment: "the structured `400` body the device-identity middleware returns") vs `server/src/app.ts:42-60` (the middleware hand-builds the same two object literals inline, no import of or type-check against `DeviceIdError`)
- Category: 1 (DEAD PATTERN, partial) / 6 (STALE MAPS)
- What: `DeviceIdError` is never imported anywhere in `server/src` or `server/test`. The middleware constructs `{ error: 'missing_device_id', hint: ... }` / `{ error: 'invalid_device_id', hint: ... }` as bare literals, with no `satisfies DeviceIdError` and no runtime parse. Distinct from the already-escalated F2 (the `invalid_request` literal outside the enum) — even the two error kinds the schema *does* cover are unenforced.
- Why it matters: nothing catches a typo drift between `app.ts` and the contract; the contract's "single source of truth for every wire shape" claim is untrue for this shape. The existing tests assert literal strings independently of the contract.
- Suggested approach: annotate the two response bodies `satisfies DeviceIdError` (or construct via `DeviceIdError.parse`). Purely additive, leaves F2's open enum question untouched.
- Mechanical-lane eligible: **YES**.

SRV not-findings: `server/.data/usage.db` is gitignored (fine); `openrouter.ts` unmounted is documented + spec-matching; prompt max-length absence noted but LAN-dev-only scope makes it a product-policy call, not filed.

---

## Jurisdiction: launcher + bridge + host shell (HL)

### [severity: med] HL-1 — CLAUDE.md and v1-roadmap.md point at `src/host/WebViewHost.tsx`, which was deleted
- Where: `CLAUDE.md:64`; `docs/v1-roadmap.md:200,207`
- Category: 6 (stale maps)
- What: CLAUDE.md's Containment section says the runtime HTML is "loaded into the WebView" by `src/host/WebViewHost.tsx`; v1-roadmap.md twice cites it as read-first material. The file does not exist — `docs/decisions.md:503` (D6) records the extraction: realm loop moved **verbatim** into `useMiniAppHost` + `MiniAppView`, `WebViewHost.tsx` removed.
- Why it matters: CLAUDE.md is the most-read orientation doc for every agent; an agent told to read `WebViewHost.tsx` before runtime/sandbox work fails to find it and may misjudge where the "one WebView == one realm" invariant lives now.
- Suggested approach: replace both citations with `src/host/launcher/useMiniAppHost.ts` (+ `MiniAppView.tsx` for the RN-facing half).
- Mechanical-lane eligible: **YES**.

### [severity: low] HL-2 — `src/host/bridge/device-acceptance.ts:71` still carries the dead `executeSync` fallback ternary that D7 already fixed everywhere else
- Where: `src/host/bridge/device-acceptance.ts:71` (`resetAppDb`'s `exec` helper)
- Category: 1 (dead patterns) / 2 (scaffolding residue)
- What: `typeof db.executeSync === 'function' ? db.executeSync(sql, []) : db.execute(sql, [])` — the exact D7 pattern, in a sibling file D7's file list missed. On pinned op-sqlite v16.2.0 (JSI-only) `executeSync` is always present; the `db.execute` branch is dead and would silently misbehave (`res?.rows` on a Promise is `undefined`) if it ever executed.
- Why it matters: the same class of bug the codebase already paid to fix once, reappearing because the fix targeted call sites by file path rather than by pattern.
- Suggested approach: call `db.executeSync(sql, [])` directly, matching the canonical pattern in `storage-engine/bindings/op-sqlite.ts`.
- Mechanical-lane eligible: **YES**.

### [severity: low] HL-3 — `cue-backend.ts` comment still says "WebViewHost injects it" (present tense, file gone)
- Where: `src/host/cue-backend.ts:5-6`
- Category: 2 (scaffolding residue)
- What: "(`WebViewHost` injects it into `createDefaultRegistry`)" — but the call now lives at `src/host/launcher/useMiniAppHost.ts:35`. The comments in `DevProbeScreen.tsx:4` and `useMiniAppHost.ts:4` correctly use past tense; this one is the odd one out.
- Suggested approach: update to name `useMiniAppHost.ts`.
- Mechanical-lane eligible: **YES**.

### [severity: low] HL-4 — `onMessage`'s `paint`/`probes`/`ui-event` cases are not generation-fenced, unlike `syscall`/`nav-depth` in the same switch
- Where: `src/host/launcher/useMiniAppHost.ts:192-209` vs `:169-190`
- Category: 4 (structural smell) / 5 (real-but-hard)
- What: `case 'paint'` unconditionally overwrites `paintMs`/`generation` state; `case 'probes'` checks `m.trusted === true` but not generation freshness. A prior realm's late `paint`/`probes` message after a `bind()` reset can transiently attribute the previous app's diagnostics to the new app's label.
- Why it matters: cosmetic-only today (DevProbeScreen diagnostics, never read by product code or the gate) — but it's an inconsistency in a file whose stated purpose is generation-fence discipline, and a future feature trusting these inputs would inherit an unfenced surface by surprise.
- Suggested approach (sketch): either add a `generation` field to the `paint`/`ui-event` relay frames (mirroring `nav-depth`) and fence in the handler, or explicitly document the three cases as diagnostic-only and deliberately unfenced.
- Mechanical-lane eligible: **NO** — protocol/design decision (frames don't carry a generation field today).

HL not-findings: HomeScreen dead-space (B7) re-verified still fixed; `rows.ts` shallow `vList` validation is correct layering (deep validation is the engine's job); `recordFor()` zero-capability fallback is the intentional cap-intruder design. Omitted as not worth a line: seedFirstRun catch-and-log (intentional), repoLineage process-lifetime cache (documented), probe-screen duplication (dispositioned E4).

---

## Jurisdiction: storage-engine + version-store (ST)

### [severity: high] ST-1 — `checkValue('json', undefined)` passes validation, then the SqlExecutor throws an unstructured low-level error instead of the engine's own structured `StorageError`
- Where: `src/host/storage-engine/marshal.ts:53-59` (`checkValue`'s `json` branch), consumed by `src/host/storage-engine/engine.ts:237-241` (`assertValue`), reached via `records.append`/`records.update`/`kv.set`
- Category: 3 (spec drift vs D8 "every refusal carries a machine-actionable fix hint") — the classic validation-guard-vs-TS-type watch-item.
- What: `checkValue` only special-cases `value === null`; for `type: 'json'` it validates via `try { JSON.stringify(value) } catch`. `JSON.stringify(undefined)` does not throw — it returns `undefined` — so a `json` field written as `undefined` is reported "valid," `toStorage` returns bare `undefined` (not a `SqlBindValue`), and the executor throws. **Verified live** (esbuild probe against `engine.ts` + real `node:sqlite`, `:memory:`): `records.append` throws `Provided value cannot be bound to SQLite parameter 1.` — a raw node:sqlite error, not a `StorageEngineError` with kind/hint. Same gap reaches `kv.set('key', undefined)`, where `byteLen`'s `TextEncoder.encode()` default-argument coercion also silently bypasses the size cap at 0 bytes.
- Why it matters: (1) breaks the structured-refusal contract; (2) node:sqlite and op-sqlite are not guaranteed to fail identically on an `undefined` bind — the exact binding-divergence D1 is supposed to rule out, untested on-device; (3) reachable from mini-app data crossing the bridge, where `JsonValue` is aspirational, not enforced (structured clone can carry `undefined` where `JSON.parse` never would).
- Suggested approach: explicit `value === undefined` check at the top of `checkValue` (alongside the `null` check) → uniform `type_mismatch` rejection for every field type; audit `byteLen` for the same coercion.
- Mechanical-lane eligible: **YES** — ~2-line decision-free fix in `marshal.ts`.

### [severity: high] ST-2 — DIY compaction packs loose *objects* but never touches loose *refs* — snap/pin tag count (and the O(n) tag scans on every verb) grows without bound
- Where: `src/host/version-store/compaction.ts:74-104` vs `src/host/version-store/engine.ts:132-139` (`nextSnapId`, full `listTags` scan on every `snapshot()`), `:149-158` (`oidToId`, same scan for `history`/`listPins`/`active`/`getSnapshot`/`getPinned`)
- Category: 5 (REAL-BUT-HARD) / 6 (stale map — "the pressure point is loose-object count, not bytes" is only half true)
- What: isomorphic-git writes one loose ref file per tag and exposes **no packRefs/ref-consolidation** (confirmed against `node_modules/isomorphic-git/index.js:16496-16532` and `index.d.ts`). Every snapshot mints a never-deleted tag; compaction's reachability walk starts from every tag by design (D6) but nothing ever reduces ref *count*. `nextSnapId`/`oidToId` do a full tag scan per verb, so per-verb latency degrades linearly with lifetime generation count — in tension with the "operations feel interactive" spec requirement. No test measures ref/KV-key count post-compaction (only `looseObjectCount` around objects).
- Suggested approach (sketch): (a) hand-roll a `packed-refs` writer (isomorphic-git *reads* packed-refs, per `index.js:2149-2162`, it just never writes one) and migrate loose tag files during `compactRepo`; or (b) decide a snap-tag retention policy for un-pinned generations — a product decision touching the "rollback to any previous snapshot" guarantee.
- Mechanical-lane eligible: **NO** — retention/format decision.

### [severity: med] ST-3 — `history()`'s catch-all swallows any `git.log` failure as "empty history," not just an unborn HEAD
- Where: `src/host/version-store/engine.ts:234-238`
- Category: 4 (structural smell) — masks real errors as normal empty state.
- What: the bare `catch { return [] }` intercepts every exception `git.log` can throw — corrupted ref, missing pack object, anything — and presents it as "brand-new app, no history yet" to every caller.
- Why it matters: actual repo corruption (a compaction defect, a bad restart interleave) would present as "no history" rather than a diagnosable error — the worst failure mode for a data-integrity store, undermining the same confidence the C8 loud-invariant fix built in this same file.
- Suggested approach: narrow the catch to isomorphic-git's own `Errors.NotFoundError` (exported, `index.d.ts:700`, the library's documented pattern for exactly this) and re-throw anything else.
- Mechanical-lane eligible: **YES**.

### [severity: med] ST-4 — the `where` filter grammar can't distinguish a JSON-field equality value from a `RangeFilter` when the value happens to have `gt`/`gte`/`lt`/`lte` keys
- Where: `src/host/storage-engine/engine.ts:306-308` (`isRangeFilter`), `:246-269` (`compileWhere`); grammar at `src/host/storage-engine/contract.ts:85-87`
- Category: 5 (REAL-BUT-HARD) / 3 (spec drift — the spec's filter scenarios never cover a `json`-typed field, so the ambiguity is undocumented)
- What: any plain object containing `gt|gte|lt|lte` is treated as a `RangeFilter`. For a `json`-typed field (the one type whose values are legitimately arbitrary objects), an equality filter like `{ where: { config: { gt: 5, other: 'x' } } }` is silently reinterpreted as a numeric range — extra keys discarded, wrong rows returned, no error.
- Suggested approach (sketch): forbid `where` on `json`-typed fields (documented restriction + error) or make the range discriminator unambiguous (`{ $range: {...} }`) — both contract decisions.
- Mechanical-lane eligible: **NO** — spec-governed filter contract.

### [severity: low] ST-5 — `TXN_CONTROL` regex and the `transaction()`/`close()` boilerplate are copy-pasted verbatim between the two `SqlExecutor` bindings
- Where: `src/host/storage-engine/bindings/node-sqlite.ts:15,37-40` and `src/host/storage-engine/bindings/op-sqlite.ts:17,58-62`
- Category: 4 (structural smell)
- What: identical regex text and near-identical `transaction()`/`close()` glue in two files whose own header says they must be "kept boring on purpose so the two SQLite builds cannot drift" — `sql-executor.ts` already centralizes `runInTransaction` but not the regex or the glue.
- Suggested approach: export `TXN_CONTROL` from `sql-executor.ts` (or a small `makeStandardExecutor` factory) and import it from both bindings.
- Mechanical-lane eligible: **YES** — pure dedup, zero behavior change.

### [severity: med] ST-6 — `rollback()` doesn't verify the target snapshot is reachable from the current lineage before moving the branch ref
- Where: `src/host/version-store/engine.ts:283-290`
- Category: 5 (REAL-BUT-HARD) / 3 (spec drift — "roll back to any previous snapshot" is ambiguous about lineage scope)
- What: snapshot ids live in a repo-wide tag namespace shared across lineages (by design, for fork history). `rollback` resolves the id globally, then unconditionally force-writes the *current* branch's ref to that oid — no reachability check. A fork-lineage id passed while `main` is active silently grafts unrelated history onto the current branch. Correctness rests entirely on callers only offering ids from the active lineage's own `history()` — no engine-side backstop.
- Suggested approach (sketch): ancestry check before `writeRef`, plus a decision on the error surface (or route intentional cross-lineage moves through `switchLineage`).
- Mechanical-lane eligible: **NO** — ancestry-semantics decision.

### [severity: low] ST-7 — `TYPICAL_CODE_ARTIFACTS` is exported from two files but has zero consumers anywhere in the repo
- Where: `src/host/version-store/engine.ts:33` (declared, commented "Documentation only... NOT enforced"), re-exported at `src/host/version-store/index.ts:29`
- Category: 1 (dead pattern) / 2 (scaffolding residue)
- What: no import outside its own declaration/re-export — public surface with no consumer and no test locking its shape, silently drifting from what `build/assemble.mjs` actually produces.
- Suggested approach: delete it, or add the minimal consuming assertion (a snapshot's artifact keys match) so drift gets caught.
- Mechanical-lane eligible: **YES**.

ST not-findings: `defaultSqlLiteral` explicitly handles null/undefined before `checkValue` (does NOT share ST-1's gap); `quoteIdent`'s BURNED_ID_RE re-check is intentional defense-in-depth; op-sqlite `raw?.rows?._array ?? []` fallback covers real cross-version result shapes, not dead code.

---

## Jurisdiction: sdk + runtime + fixtures (RT)

### [severity: med] RT-1 — the module-isolation probes trust a bundle-tamperable `require`, undermining the trusted-vantage guarantee for exactly that probe category
- Where: `src/runtime/web/resolver.js:25,45` (`window.__whimRequire = ...`; `window.require = window.__whimRequire;` — both plain assignments) and `src/runtime/web/probes.js:87-96,151-169` (module-isolation + T3/T5 probes call the live global, not a closure-captured reference)
- Category: 3 (spec drift vs spike2 constraint #3 "judge containment from a trusted vantage the bundle cannot overwrite") / 5 (real-but-hard)
- What: `loader.js` correctly closure-captures the top-level probe pointer (`trustedRunProbes`), but the module-resolution sub-probes resolve through the live `require`/`window.__whimRequire` — neither write-protected (contrast `syscall.js:94-101`, hardened by A6 with `Object.defineProperty(..., writable:false, configurable:false)` for exactly this reason). Bundle module-top-level code can reassign the resolver before probes fire, falsifying the `module` probe category's verdict; and `loader.js:158` re-captures `var require = window.__whimRequire` fresh at *each* delivery, so a gen-1 swap poisons gen-2's bundle-scope resolver too (the T7 known-poisoned class, closed for `__whimSyscall`, open for the more foundational global).
- Why it matters: no *new* escape (no real `fs` to reach in a browser), but it lets a bundle falsify the one probe category whose job is proving the resolver allowlist held.
- Suggested approach: (1, **mechanical**) wrap `window.__whimRequire`/`window.require` in `Object.defineProperty(..., writable:false, configurable:false)`, mirroring `syscall.js` — note `src/runtime/web/` is regenerated into `src/runtime/generated/*` by `npm run build`, and probe/loader halves are owner territory; (2, **owner-authored**) capture the genuine `__whimRequire` before first delivery (alongside `trustedRunProbes`) and have the module probes assert against the captured ref.
- Mechanical-lane eligible: **half** — the write-protect (1) is mechanical; the trusted-capture (2) is a runtime-owner design change.

### [severity: med] RT-2 — water-counter's optimistic UI update is never rolled back on syscall failure
- Where: `fixtures/water-counter.app.tsx:67-80` (`add()`)
- Category: correctness defect
- What: `add(count)` computes `next = total + count`, calls `setTotal(next)` optimistically, then awaits `storage.kv.set` and a loop of `records.append`. On failure the catch only sets a status message — `total` is never reverted, and `history` is only advanced after the full append loop, so a mid-loop failure leaves the display contradicting what a reload from storage would show.
- Why it matters: this is the §15.2 acceptance/reference fixture whose whole point is proving storage correctness — and its optimistic-update shape is exactly what future generations will pattern-match.
- Suggested approach: capture the pre-add value, revert `setTotal` on catch; advance `history` only by appends that actually landed.
- Mechanical-lane eligible: **YES**.

### [severity: low] RT-3 — `ListQuery` is force-cast through `unknown` to reach `JsonValue` in the storage facade
- Where: `src/sdk/index.tsx:212-217` (`records.list`): `query as unknown as JsonValue`
- Category: 4 (structural smell)
- What: the double cast exists because `ListQuery`'s optional properties aren't provably assignable to the closed `JsonValue` union — so a future non-JSON-safe field (function, `Date`) added to `ListQuery` would compile silently at the one call site supposed to guarantee wire-safety.
- Suggested approach: a narrower helper type tolerating optional properties at the call boundary (or an explicit documented safety note). Type-only, no runtime change.
- Mechanical-lane eligible: **YES**.

RT not-findings: latency-probe's direct `__whimSyscall` access (dispositioned B5); adversarial fixtures in the release bundle (dispositioned E8, defer); tip-splitter's advisory `min` attribute (guarded by `safePeople` derivation, not a bug).

---

## Patterns worth a tripwire (compiled)

- **A grep for the A6 pattern's completeness**: `grep -n "^\s*window\.[A-Za-z_]* = " src/runtime/web/*.js | grep -v defineProperty` — flags any security-relevant window global installed via plain assignment instead of `Object.defineProperty(..., writable:false, configurable:false)`. Would have caught RT-1 mechanically; widen the 2026-06-18 report's proposed `window\.__whim[A-Za-z]* =` grep to cover `resolver.js`'s `window.require` too.
- **`JSON.stringify(value)` doesn't throw for `undefined`** — any `json`-type validator calling it inside a bare try/catch without a preceding `value === undefined` check is ST-1's bug class. `JSON.stringify` only throws on circular refs/BigInt, never on `undefined`.
- **Bare `catch { return <empty/fallback> }` around an isomorphic-git call is a smell** unless the specific error class is checked (`err instanceof git.Errors.NotFoundError`). `version-store/engine.ts` + `compaction.ts` have several (lines 106, 144, 221, 237, 321, 370, 407); most are legitimately scoped, but any commented "unborn HEAD" should check the class.
- **`grep -rn "WebViewHost" CLAUDE.md docs/ src/`** — three independent post-rename fossils this sweep (CLAUDE.md, v1-roadmap.md, cue-backend.ts). A gate-tripwire grep (excluding past-tense "used to" phrasing) would catch regressions.
- **`grep -rn "typeof db.executeSync === 'function'"` across `src/host/**`** — the D7 fossil reappeared in a sibling file because the original fix enumerated call sites by path. Pattern-based tripwires beat file-list-based acceptance criteria.
- **Duplicated constants/wiring across the two `SqlExecutor` bindings** — the design goal for those files is "cannot drift"; duplication (ST-5) actively works against it.

## Mechanical-lane roll-up (fix-loop candidates)

| id | sev | files | test-class guess |
|----|-----|-------|------------------|
| ST-1 | high | storage-engine/marshal.ts (+test) | behavioral (red-checkable) |
| ST-3 | med | version-store/engine.ts (+test) | behavioral (red-checkable) |
| RT-2 | med | fixtures/water-counter.app.tsx | behavioral (fixture; suite-green + inspection) |
| SRV-2 | med | server/src/openrouter.ts | structural-no-test (dedup; existing openrouter tests are the regression) |
| SRV-3 | low | server/src/app.ts | structural-no-test (type-level; tsc is the check) |
| HL-1 | med | CLAUDE.md, docs/v1-roadmap.md | structural-no-test (doc fix) |
| HL-2 | low | src/host/bridge/device-acceptance.ts | structural-no-test (dead-branch removal, device-only path) |
| HL-3 | low | src/host/cue-backend.ts | structural-no-test (comment) |
| ST-5 | low | storage-engine/sql-executor.ts + bindings/*.ts | structural-no-test (dedup; suites are the regression) |
| ST-7 | low | version-store/engine.ts + index.ts | structural-no-test (deletion) or invariant (consuming assertion) |
| RT-3 | low | src/sdk/index.tsx | structural-no-test (type-only) |
| RT-1(a) | med | src/runtime/web/resolver.js | invariant-adjacent — **flag: runtime-web is sensitive; verify against the invariants suite; RT-1(b) is owner-only** |

Escalation lane (not fix-loop): SRV-1, ST-2, ST-4, ST-6, HL-4, RT-1(b) — all need product/design/owner decisions.
