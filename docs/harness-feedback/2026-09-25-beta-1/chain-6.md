# chain-6 (app-keyboard-shell), implementer, Opus

- **What:** lint failed twice on `sonarjs/no-nested-functions` in the new suite (callbacks nested more than 4 deep inside `on(os, …)` inside `h.test`).
  **Mechanism:** gate lint · **Verdict:** NEUTRAL · **Cost:** about 3 minutes and one extra gate run · **Evidence:** gate1 log, lines 49-50, `keyboard-shell-ui.suite.tsx:179/188`. Fixed by moving `avoiders()` and `draftLoaded()` to the top level.
- **What:** the #79 workaround of type-checking my own test files. Including `acceptance.ts` brings in about 100 existing errors from other suites, so I had to narrow the files list by hand and check the one shim error against BASE.
  **Mechanism:** launcher tests are excluded from the gate's typecheck (#79) · **Verdict:** DRAWBACK · **Cost:** about 5 minutes · **Evidence:** 103 errors across about 20 existing suites. The only one in a file I touched is the WebView stub at `native-host.tsx:26`, already present at BASE line 23.
- **What:** the base prompt says run commands one at a time with no `&&`, while the dispatcher says to use `cd <worktree> && <cmd>`. I followed the dispatcher and chained often; nothing stalled.
  **Mechanism:** conflicting instructions · **Verdict:** DRAWBACK · **Cost:** a moment's hesitation · **Evidence:** every Bash call in this run.
- **What:** decision D3 fixes two iOS mechanisms (the automatic inset and a `KeyboardAvoidingView` footer) without looking at how they interact natively. I spent time reading RN source to find that they conflict.
  **Mechanism:** the design phase and the frozen decisions in the chain block · **Verdict:** CAUGHT-REAL-MISTAKE (in the plan, found at implementation) · **Cost:** about 15 minutes · **Evidence:** `RCTScrollViewComponentView.mm:187-266`, `KeyboardAvoidingView.js:80-190`.

What helped: the chain block named exact locations (`OtherAnswerField`, the SheetModal rule), so there was no hunting. The `native-host` stub makes rendered, per-platform checks possible in Node. The worktree came pre-built with the symlinks in place.

What the harness should change:
1. Give implementers a checked-in script that type-checks only the launcher test files a chain changed, or close #79.
2. Reconcile "one command at a time" with the dispatcher's `cd && cmd` guidance.
3. Before freezing a UI decision that combines platform built-ins, have the researcher cite how their native implementations interact.
