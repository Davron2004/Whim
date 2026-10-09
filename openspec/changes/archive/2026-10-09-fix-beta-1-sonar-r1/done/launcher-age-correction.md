# Launcher-age corrective scope addendum

The root expands this cohort's existing four-file allowlist by exactly one test-only module: `src/host/launcher/test/native-storage.ts`. The immutable BASE stays `100d71f79c45f6d2e8509f85fa8e9bd492b73b50`; previous source commit and rejected review remain in the audit trail. This is a same-subsystem, nonprotected scope amendment.

Add an opt-in, resettable write-failure predicate to the shared MMKV-shaped test backend. It must affect all adapters over the same test data, leave default behavior unchanged, and be cleared in finally. Do not expose this seam to product/native modules or weaken assertions. Preserve existing fixture interfaces.

Required regressions: guardian acknowledgment persistence rejects before its write; journal-key writes persistently reject after pending recreation; pending order-key writes reject after a record write. Exercise the actual shared backend across both adapters. Preserve the original failed ghost and journal bytes, issue no request, and show the existing generic content-free failure. Failed restoration of one sibling must not prevent recovery of the other. The tests must still fail against the earlier rejected candidate and/or BASE for real observable behavior.

The updated canonical allowlist will be committed once the current hermetic gate restores the staging checkout; use `/tmp/whim-beta1-sonar-plans/launcher-age-expanded-allowlist.txt` for the immediately authorized worker scope. No config/harness files are added. Independent review, new fast gate, root RED/integrity and full gate remain mandatory.
