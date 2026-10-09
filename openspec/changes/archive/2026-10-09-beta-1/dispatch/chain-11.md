# chain-11: your own server (tasks 12.1–12.4, decision D20)

The owner reverses legal-surface-v2 D10: Whim is open source, so every build lets the user point it at their own
backend, on their own responsibility. Read `design.md` D20, `research-self-hosted.md` (file:line map of every
affected site), and the two server-address requirements at the end of `specs/app-launcher/spec.md` plus
`specs/native-release-config/spec.md`. Those spec deltas are the acceptance text.

1. **Delete the internal-build flag end to end (12.1).** It exists only for D10. Remove the native constant on
   both platforms, `WHIM_INTERNAL_BUILD` (keep every other build-type setting), the TurboModule spec field, the
   JS readers and every prop/argument. Advanced renders in every build. Delete tests that only test the flag;
   update hosts that pass it.
2. **Acknowledgement gate (12.2).** Advanced holds a "Use your own server" action that opens the existing
   `ConfirmSheet`. The sheet says, in plain words: that server sees everything Whim sends (prompts, answers,
   reports, diagnostics, this phone's ID), whoever runs it decides what it keeps, and Whim's privacy policy
   doesn't cover it. Confirming persists a once-per-install acknowledgement under a new versioned KV key next
   to `whim.server-url:v1`, then shows the field. `serverOverride` honours the saved address only when the
   acknowledgement is recorded. The saved address is never deleted by this gate. An active override shows a
   short responsibility caption under the field. "Use Whim's server" clears the address and keeps the
   acknowledgement. Add English and French copy in `copy.ts`'s tables (no hardcoded strings).
3. **Address rule and Android cleartext (12.3).** Validate at save: `http://` only for IP literals (v4 and
   bracketed v6), `localhost`, `.local` and single-label hosts; anything else needs `https://`. A refused
   address shows an inline note and is not saved (the debounced save must not persist it). Switch the Android
   main network config to a base-config cleartext permit. Update `checkMainNetworkConfig` and its suite to
   assert this shape, with a discriminating failing case. Do not touch `invariants/` or the sandbox CSP; run
   the existing invariant suites to confirm bundles stay off the network.
4. **Policy and docs (12.4).** In `deploy/site/privacy.html` and `deploy/site/fr/privacy.html`, add a section
   "If you point Whim at your own server" (French twin): what goes there, that AnyCognition receives nothing
   from the app while it's set, that the operator's own rules apply and this policy doesn't, how to switch back.
   Add a dated bullet under "Changes to this policy" using the existing slot conventions. No manifest change,
   no `AI_CONSENT_VERSION` bump; the legal-page checks and `server/test/web-site.suite.ts` must stay green.
   Update `docs/store/review-notes.md` (a short paragraph: optional, defaults to Whim's server, same sandbox
   for any server's output, guideline 4.7), `docs/release/mobile.md:202-204,323-326`, and append a
   `docs/decisions.md` entry reversing D10 (follow that file's numbering and format).
5. **Tests (red first).** Rendered tests against the current tip must fail before your change and pass after:
   a saved address with no acknowledgement routes every request to the compiled-in server and hides the field;
   cancel leaves no field and no override; confirm, type a LAN `http://` address, and clarify/generate/report
   target it; `http://example.com` is refused and not saved; "Use Whim's server" keeps the acknowledgement.
   Assert observable behaviour (requests made, rendered text), never source text. Await every promise.
6. Run the affected suites and `./scripts/gate.sh` until green, commit, and report with actual exit codes, the
   red-check receipts, and the list of files touched.

Scope: exactly the product/test and docs/legal paths in chains.md chain-11. Exclusions: `invariants/`, runtime/
sandbox, SDK, `server/`, `contract/`, `release/store/**`, gate/config files, live specs, tasks.md, progress.md.
Before editing `.mm`/`.kt`/`build.gradle`, note that the root rebuilds and checks native builds after merge; keep
native edits to the flag removal only.
