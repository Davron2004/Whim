# Sonar round 1 dispositions — PR #309

- S1 (probes.js:156, S4138 for...of) — ACCEPT: for...of reads `Array.prototype[Symbol.iterator]`, which app code can replace before the probes run, so the oracle could be blinded; the indexed loop reads only the array's own slots (comment added at the loop).
- S2 (runtime-message-auth.ts:70, S7758 codePointAt) — ACCEPT: the compare is over UTF-16 code units at fixed indices; `charCodeAt` always returns a number, while `codePointAt` returns `number | undefined` and would need a fallback inside the constant-time loop.
- S3 (runtime-message-auth.ts:70, S7758 codePointAt) — ACCEPT: same line and reason as S2.
- S4 (runtime-message-auth.ts:252, S7747 spread in for...of) — ACCEPT: the copy is a deliberate snapshot; iterating the live Set would also call a listener subscribed during notification, which changes behaviour.
- S5 (loader.js:100, S6582 optional chain) — ACCEPT: build/build.mjs inlines src/runtime/web/*.js raw into the runtime HTML without lowering, and optional chaining is ES2020, above the es2019 sandbox floor.
- S6 (neutralize.js:45, S3776 complexity) — FIXED: `holdersOf` split into `ownDescriptor`, `readThrough` and `protoOf` helpers, with the same reads and the same failure handling.
- S7 (neutralize.js:53, S3358 nested ternary) — FIXED: replaced by the if-chain in `readThrough`.
- S8 (neutralize.js:82, S6582 optional chain) — ACCEPT: same reason as S5 (raw-inlined, es2019 floor).
- S9 (neutralize.js:84, S2486 empty catch) — FIXED: added a comment explaining why the catch is ignored (a `webkit` whose `messageHandlers` read throws has no reachable handlers); behaviour unchanged.
- S10 (probes.js:16, S3776 complexity) — FIXED: the T1 fresh-script probe moved into the nested `probeFreshScriptInjection()`, called at the same point.
- S11 (probes.js:116, S3776 complexity) — FIXED: `holdersOf` split into the same three helpers as S6.
- S12 (probes.js:124, S3358 nested ternary) — FIXED: replaced by the if-chain in `readThrough`.
- S13 (probes.js:138, S3358 nested ternary) — FIXED: the bridge-probe detail is now built in an if/else-if/else before `record`.
- S7721 (probes.js:137, protoOf) — FIXED: `protoOf` moved out of `__whimRunProbes` to a top-level `const` (lexical binding, so not a `window` property app code could overwrite); same `Object.getPrototypeOf` read at call time, same throw-ends-chain handling. neutralize.js keeps its helpers inside its IIFE (not flagged, so not moved).
