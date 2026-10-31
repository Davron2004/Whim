# Review (Opus high): chain-3 + #181 option 1 (saved by the orchestrator; reviewer has no Write tool)

## chain-3 (`9ec4bd3b..255d9b92`): VERDICT findings
Passed: one predicate (`grid-composition.ts:83`, `HomeScreen.tsx:366` passes PROTOCOL_LEVEL, `failureFromRecord` LauncherRoot.tsx:3188); ruling 13 paths keep the update screen (1076, 1647, 1835, 2030, 2504); background landing via `updateMayInterrupt` (Home, Describe; mini-app + Plan left alone) as before; grid case covers L-1/L/L+1 + menus; 4 rewritten flow-messages cases assert kind, copy, buttons, no update screen, remedy, nothing installed, Not now → Home; red-check claim fits; no attribution.
- [MEDIUM] `LauncherRoot.tsx:2560-2562`: a background run's update fallback landing while the user types on Describe discards the text: old route (`updateScreenFrom(prev, notice)`) kept a non-empty Describe prompt in `heldPrompt`; new target replaces Describe with no `keepDraft(prev)` (no draft saved, in-flight compose/plan requests not aborted). Done: `keepDraft`/`heldPromptRef` when the replaced screen is describe/plan (or don't interrupt a Describe page with text) + launcher test (close sheet, open Describe, type, push update frame, text comes back in the composer).
- [LOW] `LauncherRoot.tsx:2561`: if the record persisted but `pending.get()` is undefined, target is null and the attached Making page is never replaced (old code always routed). Done: fall back to `genericAttemptFailure(...)` or `updateScreenFrom`.
- [LOW] `handoff/chain-3.md` "no assertion removed": the mid-build case replaced two assertions. Done: say "replaced".

## #181 option 1 (`00cba787..8f152588`): VERDICT findings
Passed (probed with payloads): main, bypassPermissions, auto, dontAsk, missing mode, malformed JSON, no jq, kill switch → exit 0 silent; default/acceptEdits/plan deny + one 4-field log line; failed log write can't block; dangerous compounds (`git status; rm -rf x`, `&&`, multi-line) denied via bash-policy; never emits allow; `WHIM_BASH_POLICY_NO_CLAIM` only in the classification subprocess; tests real; `.codex/**` untouched; no attribution.
- [MEDIUM] `.claude/hooks/subagent-deny.sh:31-44`: all-allowed compounds still denied in default mode: `git status && git diff`, `cd <wt> && git status` (the brief-rules pattern) → breaks "deny ONLY a command that would prompt". Done: for `&&`/`||`/`;`/`|` chains without `$(`, backtick or redirect, pass when every segment matches `permissions.allow` (treat `cd <path inside the project>` as allowed) + tests; or the PO accepts the misfire and the brief stops recommending `cd … &&`.
- [LOW] Claude's built-in read-only commands (`echo hi`, `pwd`) denied in default mode.
- [LOW] no tests pin the fail-safe paths (malformed JSON, jq missing, bash-policy non-zero).
- [LOW] `subagent-deny.sh:28`: empty `tool_input.command` denied and logged (noise). Done: pass through.
Probe copies: scratchpad `h181/`.
