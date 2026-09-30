# Maestro 2.6.0 log isolation check

## Verdict

The installed Maestro CLI has no supported per-invocation, home-independent
override for its global diagnostic-log root.

`maestro test --debug-output <path>` does isolate the test debug-output tree.
It does **not** isolate the separate JVM diagnostic archive writer that uses
the macOS user log directory. `--test-output-dir` is also insufficient: its
help explicitly says it excludes debug output. Neither `maestro test --help`
nor `maestro hierarchy --help` exposes a diagnostic-log-root option, and local
CLI/JAR inspection found no `MAESTRO_LOG_*`, `MAESTRO_HOME`, or equivalent
supported override.

Do not repurpose `HOME` or JVM `user.home`: that changes the home-derived
global path rather than using a supported Maestro isolation interface.

## What the existing upgrade runner already isolates

`scripts/release/upgrade-check.sh` invokes each flow as:

```sh
maestro --device "$DEVICE" test --debug-output "$RAW/maestro/$name" ...
```

(`run_flow`, lines 130–142). The run's stdout/stderr and hierarchy output are
also under the candidate evidence directory (lines 145–150, 265). In Maestro
2.6.0, `TestDebugReporter` builds the supplied tree as
`<debug-output>/.maestro/tests/<session>`, which matches the existing beta-1
raw evidence convention. This is the correct per-run evidence isolation.

## Why it does not cover the prior failure

The CLI has a separate `maestro.debuglog.DebugLogStore` in
`maestro-client-2.6.0.jar`. At JVM startup it obtains a user log directory via
`AppDirs.getUserLogDir("maestro", null, "mobile_dev")`, creates a
timestamp-and-PID child directory, and at `finalizeRun()` closes it, archives
it, and removes that child. The bundled macOS AppDirs implementation derives
its user-log location from Java `user.home` and `Library/Logs`; current local
archives are under `$HOME/Library/Logs/maestro/`.

That writer has no connection to the test command's `--debug-output` path.
Every Maestro JVM shares the same parent directory and runs retention/finalize
lifecycle work there. The prior `NoSuchFileException` for a path below
`~/Library/Logs/maestro/<timestamp>_<pid>` is therefore consistent with a
cross-process lifecycle collision. The timestamp/PID children make a simple
same-name collision unlikely; this inspection did not reproduce the deletion
or identify which other process caused it.

## Bounded safe-run rule when another project is active

There is no atomic, cross-project lock exposed by Maestro. The practical
boundary is a quiet window for all Maestro CLI processes sharing this macOS
user account:

1. Inspect only, without touching devices or processes:

   ```sh
   ps -axo pid=,etime=,command= | rg 'maestro\.cli\.AppKt|/maestro( |$)' || true
   find "$HOME/Library/Logs/maestro" -maxdepth 1 -type f -mmin -1 -print 2>/dev/null
   ```

2. Require two clear scans 60 seconds apart. If a Maestro command appears, or
   a new global archive appears in that interval, restart the quiet interval.
   Stop waiting after ten minutes and record the external QA activity as the
   blocker; do not kill, message, or reconfigure that project.

3. Recheck immediately before starting the canonical upgrade checker. This
   reduces the race but cannot prove exclusivity; a coordinated quiet window
   is the only supported protection while all clients share the global log
   directory.

4. Once started, let `upgrade-check.sh` be the sole Maestro client for its
   owned device. Do not run a standalone `maestro hierarchy` or another flow
   beside it. This also preserves the existing same-device rule recorded in
   `docs/harness-feedback/2026-09-25-beta-1/fix-8.md`: a concurrent hierarchy
   command can restart the driver and terminate a test run.

The script serializes its own flows, but it cannot serialize an unrelated
project's Maestro JVM. No shipping-code, test, device, or global setting change
is needed for this rule.
