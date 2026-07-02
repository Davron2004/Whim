# Findings: fix-shakedown

- source: openspec/critic/2026-07-02-product-sweep.md (D7-CONTROL: openspec/critic/2026-06-18-triage.md)
- purpose: SHAKEDOWN batch — first exercise of the whim-fixloop OpenSpec lane (docs/parallel-fix-loop.md §6.9). Composition deliberately exercises every new mechanism: two behavioral red-checkable fixes in adjacent subsystems (post-merge regate is load-bearing), structural fixes across server/fixtures/docs, and one resurrected already-fixed finding as the NEGATIVE CONTROL for `fixloop.sh stale`.

## ST-1: checkValue('json', undefined) passes validation → raw SQLite bind error instead of structured StorageError

- severity: high
- files: src/host/storage-engine/marshal.ts:53-59, src/host/storage-engine/engine.ts:237-241
- symptom: `checkValue` only special-cases `value === null`; for `type: 'json'` it validates via `try { JSON.stringify(value) } catch`. `JSON.stringify(undefined)` does not throw — so a `json` field written as `undefined` is reported "valid," `toStorage` returns bare `undefined` (not a `SqlBindValue`), and the executor throws `Provided value cannot be bound to SQLite parameter 1.` (verified live) — a raw node:sqlite error, not a `StorageEngineError` with kind/hint. Same gap reaches `kv.set('key', undefined)` where `byteLen`'s `TextEncoder.encode()` default-argument coercion silently bypasses the size cap at 0 bytes.

## ST-3: history()'s catch-all swallows any git.log failure as "empty history"

- severity: med
- files: src/host/version-store/engine.ts:234-238
- symptom: the bare `catch { return [] }` intercepts every exception `git.log` can throw — corrupted ref, missing pack object, anything — and presents it as "brand-new app, no history yet." Fix: narrow to isomorphic-git's `Errors.NotFoundError` (the documented unborn-HEAD case) and re-throw anything else.

## RT-2: water-counter's optimistic UI update is never rolled back on syscall failure

- severity: med
- files: fixtures/water-counter.app.tsx:67-80
- symptom: `add(count)` calls `setTotal(next)` optimistically, then awaits `storage.kv.set` and a loop of `records.append`. On failure the catch only sets a status message — `total` is never reverted, and `history` only advances after the full loop, so a mid-loop failure leaves the display contradicting what a reload from storage would show. This is the §15.2 persistence-proof reference fixture.

## SRV-3: DeviceIdError contract schema exported as authoritative but never referenced by the code it describes

- severity: low
- files: contract/src/index.ts:102-108, server/src/app.ts:42-60
- symptom: the middleware hand-builds `{ error: 'missing_device_id', ... }` / `{ error: 'invalid_device_id', ... }` as bare literals with no `satisfies`/parse against `DeviceIdError`; nothing catches typo drift between app.ts and the contract.

## HL-DOCS: WebViewHost fossils (HL-1 + HL-3 batched — same rename, one worker)

- severity: med (HL-1) + low (HL-3)
- files: CLAUDE.md:64, docs/v1-roadmap.md:200,207, src/host/cue-backend.ts:5-6
- symptom: three references to the deleted `src/host/WebViewHost.tsx` (extraction recorded in decisions.md #43 D6: realm loop moved verbatim into `useMiniAppHost` + `MiniAppView`). CLAUDE.md is the most-read orientation doc; an agent sent to a nonexistent file misjudges where the one-WebView-one-realm invariant lives.

## D7-CONTROL: NEGATIVE CONTROL — resurrected already-fixed finding (staleness-tripwire test)

- severity: low (control)
- files: src/host/storage-engine/bindings/op-sqlite.ts
- symptom: the original 2026-06-18 D7 finding (the `typeof db.executeSync === 'function' ? ... : db.execute(...)` fallback ternary), FIXED in a prior run. Expected disposition: dies at `scripts/fixloop.sh stale` with exit 7 → `stale-skip`, never reaches a worktree. If it survives the stale check, that is a harness bug — STOP the batch and report. (Deliberately scoped to op-sqlite.ts only; the similar pattern in src/host/bridge/device-acceptance.ts is a DIFFERENT, still-live finding, HL-2, not in this batch.)
