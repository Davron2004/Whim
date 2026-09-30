# fix-2 (the deploy smoke proves the 426), implementer, Sonnet

- **What:** The dispatch block asked me to check whether the deploy-config suite "pins the smoke script's checks... by parsing smoke.sh" — it doesn't; it runs smoke.sh for real against stubbed tools and asserts on stdout/stderr/exit code.
  **Mechanism:** `runScript`/`writeRules` spawn the actual `deploy/smoke.sh` in a git sandbox with `curl`/`dig`/`gcloud` replaced by a glob-matching stub script reading `<tool>.rules` (first match wins on `$*`). This is stronger than a text-parse, but adding a new HTTP-shaped check requires a new stub rule ordered correctly relative to any overlapping wildcard rule — easy to get wrong silently (a too-generic rule, or one after a catch-all, falls through to the old response and the new check "passes" for the wrong reason).
  **Verdict:** DRAWBACK (minor: the chain block's phrasing sent me to the wrong mechanism first) · **Cost:** ~10 minutes · **Evidence:** server/test/deploy-config.suite.ts:896-965 (stub matching), :1096-1101 (API_UP baseline stubs).

Proposal: describe this suite's smoke pinning as "a functional sandbox run with glob-matched curl/dig/gcloud stubs (see STUB_SCRIPT / StubRule)" instead of "a test that parses smoke.sh".
