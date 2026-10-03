# fix-14: integrated-review fixes for D20 (task 12.6)

From the final integrated review of `c76191d3..bea2f2c8` (chain-11). Product source is otherwise accepted.

1. **Policy encryption claim (MED).** `deploy/site/privacy.html:188` and `deploy/site/fr/privacy.html:189` say
   everything the app sends is encrypted in transit. Scope it to Whim's server ("Everything the app sends to our
   server…" / French twin), and add one sentence to the "If you point Whim at your own server" section (both
   languages): a plain `http://` address on your own network is not encrypted. Legal-page checks and
   `server/test/web-site.suite.ts` stay green.
2. **Acknowledgement list (LOW-MED).** `src/host/launcher/copy.ts:388` (FR `:616`): the confirm-sheet list of what is
   sent omits what an edit sends (app name, code, description, data layout; see `consentSentEdit`). Add "the apps
   you change" (natural French) so the list is complete. Update any test that pins the exact sheet body.
3. **Rate-limit pause crosses servers (LOW).** `src/host/logging/diagnostics.ts` `discard()` (~:220) clears the
   queue but not `pausedUntil`; a 429 without `Retry-After` sets it to Infinity (~:239), so after a server switch
   the new server gets no diagnostics all session. Clear the pause in `discard()`. Red-first suite case in
   `src/host/logging/test/diagnostics.suite.ts`: 429 → discard → next record uploads.
4. **Self-hoster `minBuild` (docs).** The update check rides on the chosen server's `/healthz`, so a self-hosted
   server's `WHIM_MIN_BUILD_*` can open the update screen, which points to the store. Document in
   `docs/deploy.md` (the min-build section) that a self-hosted server's minimum must stay at or below the store
   build. No code change.

Scope: exactly those five files plus the one diagnostics suite (and any copy-pinning launcher test). Run the
affected suites and `./scripts/gate.sh` to FAST GATE PASSED, commit, report with exit codes and red receipts.
