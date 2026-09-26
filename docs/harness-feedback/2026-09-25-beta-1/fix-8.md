# fix-8 (upgrade-check flows on iOS; first end-to-end iOS pass), implementer, Opus

- **What:** the block named one cause (tile labels), but reaching PASS meant fixing six blockers, five of which only showed up by running the flows. **Mechanism:** a scratch simulator plus short flows cut out of the seed at the failing step, with a hierarchy dump after each failure, then full script runs. **Verdict:** CAUGHT-REAL-MISTAKE (chain-9's flows were never run against 382511; `read-water-counter` and the ignored `--port` would have failed on Android too). **Cost:** about 8 partial runs and 2 full script runs, ~50 minutes of device time. **Evidence:** full run 1 failed at `read-water-counter` on 382511; full run 2 passed (evidence committed).
- **What:** a stray `maestro hierarchy` while a `maestro test` was running on the same device killed the test run and left stuck xcodebuild/Maestro processes. **Mechanism:** Maestro's driver restarts per command. **Verdict:** ENV (a trap). **Cost:** one lost run and about 5 minutes of cleanup. **Evidence:** run2.log ended in NoSuchFileException, then "iOS driver not ready".

Proposals:
1. A device-flow chain can't report "validated" until the real script has run end to end on each platform it claims.
2. `docs/harness.md` gotchas: one Maestro command per device at a time; `env:` defaults must use `${X || default}` (Maestro 2.6 lets a flow's plain `env:` value override `-e`).
