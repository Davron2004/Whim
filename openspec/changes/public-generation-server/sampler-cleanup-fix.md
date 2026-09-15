# Preserve sampler cleanup state until drive exits

The live 15- and 16-device reports at server `420be203` passed their capacity
predicates, but both wrapper commands exited 1 after writing JSON:
`run.sh: line 157: sampler_pid: unbound variable`.

`cmd_drive` stores the sampler PID and temporary CSV path in local variables.
Its EXIT trap runs after the function returns, when those bindings no longer
exist. With `set -u`, cleanup aborts before killing the sampler or removing the
CSV. Production restoration subsequently passed smoke; standard resize follows.

## Scope and behavior

Only `deploy/loadtest/run.sh`, `server/test/deploy-config.suite.ts` and
`handoff/loadtest.md` may change. Keep the driver, server, Compose, image, limits
and protected configuration unchanged.

Capture the driver's actual exit status without disabling shell error handling
globally. Clean up while the function's local state is still live, disarm the
completed EXIT trap, and return that driver status. Retain cleanup for early
failure paths. Do not hide the defect with empty defaults for expired variables.
No extra server operation belongs in drive cleanup.

## Regression proof

Execute the real `run.sh drive` path under its normal `set -u` behavior using
the existing deployment sandbox. A fake local sampler must expose its real PID
and CSV path. After a successful fake driver returns, assert outer exit 0,
sampler termination, CSV removal and no unbound-variable error. Repeat with a
distinct nonzero driver status and require that exact status after cleanup.
Tests must release any test-owned process even when the red assertion fails.

Run the tests before the fix to reproduce the post-function failure, then after
the fix. Preserve existing start/recovery tests. Run the server suite and fast
gate, write the short contract update, and pass independent review, integrity,
merge and full regate before a live retry. Capacity JSON alone does not prove a
successful operator command.
