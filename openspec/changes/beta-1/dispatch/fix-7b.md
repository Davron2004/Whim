# fix-7b: the last oldest-reader gaps fix-7 found (progress.md R17)

1. **`compat.notice: null` reads as "no notice"**, not as unreadable compat. Today it fails, so a future server
   sending `{fallback:'skip', notice:null}` would end the flow instead of continuing. Change the device
   (`wire-compat.ts#gateMessage`) AND the contract's `WireEnvelope`/`Compat` `notice` to accept null as absent
   (`.nullish()` or equivalent that strips null to undefined), so the corpus lockstep test in
   `wire-future-frames.suite.ts` stays a lockstep, not a special case. `fallback: null` and `min: null` stay
   unreadable → `fail` (the frozen set must be explicit). Tests both sides.
2. **`result.summary` and the rewrite response's `plan` are shape-checked by the device**, and a malformed value
   is DROPPED (treated as absent) rather than rejecting the message or reaching rendering. Log the drop at warn
   on the generation channel (no content). The known message still decodes: a result with a bad summary still
   installs the app; a rewrite with a bad plan falls back to the single `rewrittenPrompt` row, as the contract
   already specifies for an absent plan. Use the contract's shapes (`RunSummary`, the plan row `{label,text}`)
   as the reference for hand-rolled guards (no zod in Metro). Tests: a malformed summary (wrong types, missing
   fields) → installed with no summary; a malformed plan → the one-row fallback; valid ones unchanged.
3. **`openspec/changes/beta-1/handoff/wire-protocol.md` §Device:** state the null rules (null optional = absent;
   `compat: null` and `compat.notice: null` = absent; a malformed optional summary/plan is dropped). Keep it ≤ 120
   lines.
Scope: `src/host/launcher/generation-client.ts`, `src/host/launcher/wire-compat.ts`, `contract/src/index.ts`
(notice only), the handoff, and tests. Red-check each item against the current code and one weaker variant
(e.g. dropping `fallback: null` as absent too).
