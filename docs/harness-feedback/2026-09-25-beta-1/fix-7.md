# fix-7 (null-tolerant device reader), implementer, Opus

- **What:** Two checks gave misleading results in a chain worktree: the scratch-tsconfig typecheck and `guard:metro`. **Mechanism:** the scratch recipe reports 5 pre-existing errors, so a clean result means nothing without a base run for comparison; `guard-metro.mjs` ignores `result.error`, so a missing binary (spawn ENOENT) shows up as "A workspace dependency likely shadowed or duplicated an RN dependency". **Verdict:** DRAWBACK (no wrong verdict this time; both needed manual interpretation). **Cost:** about 3 extra tool calls. **Evidence:** base and branch have the same 5 errors; `ls …/beta-1-fix7/node_modules/.bin/react-native` → No such file.

Proposal: make `server/guard-metro.mjs` print `result.error` (e.g. "spawn ENOENT: node_modules/.bin/react-native — run from the main tree") before its shadowing message.
