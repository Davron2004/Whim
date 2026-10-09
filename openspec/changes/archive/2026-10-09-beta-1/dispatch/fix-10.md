# fix-10: the scoped reviewer's lows worth fixing before merge (progress.md: scoped review of fix-2..fix-7b)

1. **L1: the `compat: null` lockstep.** The device (`src/host/launcher/wire-compat.ts:85`) reads `compat: null` as
   absent (fix-7), but the contract's `WireEnvelope.compat` (`contract/src/index.ts:88`) is `.optional()` and
   refuses null: `WireEnvelope.safeParse({type:'token', compat:null})` is false. Make the contract's `compat`
   nullish the same way fix-7b made `notice` nullish (`.nullish().transform(v => v ?? undefined).optional()` or
   equivalent), on `WireEnvelope` AND on every message schema's `compat?`. Fix the corpus test so it can't be blind:
   `wire-future-frames.suite.ts:272,299` runs every compat value on an unknown type (`eta`), where "no compat" and
   "unreadable compat" both end in `fail`. Run each value on BOTH a known type and an unknown type, each with its
   own expected outcome. Red-check: with the contract change reverted, the new known-type case fails.
2. **L2: R17's tolerance rules in the spec.** Add to `openspec/changes/beta-1/specs/generation-contract/spec.md`,
   under "Every wire message carries a forward-compatibility envelope…", these scenarios (SHALL/MUST leading line 1
   of any new requirement text): null on an optional field reads as absent (including `compat: null` and
   `compat.notice: null`); `fallback: null` or `min: null` is unreadable → `fail`; a malformed optional
   `result.summary` or rewrite `plan` is dropped and the message still used. Keep `openspec validate beta-1
   --strict` green.
3. **L3: the Water Counter few-shot.** `fixtures/water-counter.app.tsx:52,77` added two
   `eslint-disable-next-line no-restricted-syntax` comments naming host internals ("useMiniAppHost `lastSyscall`"),
   and every fixture is sent verbatim to the model as a few-shot example
   (`server/src/generation/prompts/inputs.ts#loadFewShotExamples`). Rewrite those lines so they need no disable
   and name no host internals (e.g. `catch (_error)` if the rule is about bare catch; check which rule fires and
   why), keeping the visible copy ("Tap a button after each glass.", "Saved.") byte-identical because the
   upgrade-check flows read it. `server/test/machine.suite.ts` edits this fixture by matching a line; keep it green.
4. **L6: listener removal is pinned.** Add a test (the `native-host.tsx` Keyboard stub keeps a listener set) that
   mounts and unmounts the keyboard frame and asserts every Keyboard subscription it added is removed; red-check by
   dropping one `remove()`.
5. **L7: stale comments.** `server/src/routes/clarify.ts:133` and `server/test/wire-v2.suite.ts:307` say the
   device refuses `limit: null`; fix-7 made that false. Correct them (the server still leaves the key out).
Scope: exactly these files and their tests. Don't touch `scripts/release/*`, `docs/release/*` or
`checks/test/release/*` (fix-8 runs in parallel), or `server/src/loadtest/*`, `deploy/loadtest/*` or
`docs/deploy.md` (fix-9).
