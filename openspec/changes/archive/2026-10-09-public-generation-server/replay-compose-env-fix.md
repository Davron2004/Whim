# Replay Compose environment correction — 2026-09-15

## Observed failure

During attended task 15.4 at deployed `1e02aa3b319623e986e9b1faedd0835033c375fb`,
the replay image built and started but Compose reported `whim-server` unhealthy. The
post-stop cleanup restored production and smoke passed; no drive ran.

`deploy/compose.yaml` supplies both `/etc/whim/config.env` and
`/etc/whim/server.env`. Compose's ordinary sequence merge retains the latter when
the replay override names only `config.env`; `server.env` contains the production
`OPENROUTER_API_KEY`, and `runLoadtestServer` correctly refuses to start when it
sees that key. The inherited health check accepts the replay service identity, so
it is not the identified cause. Recovery removed the replay container, so its
container log is unavailable.

## Chosen boundary

Change only these implementation files:

1. `deploy/loadtest/compose.loadtest.yaml` replaces, rather than appends to, the
   inherited `env_file` list using Compose `!override`, retaining only
   `/etc/whim/config.env`.
2. `server/test/loadtest.suite.ts` keeps a fast, Docker-free structural guard for
   that explicit replacement tag and config path. It must fail for a fixture that
   downgrades the tag to an ordinary sequence; it does not claim to prove Compose
   merge semantics.
3. `handoff/loadtest.md` documents the merge rule and the no-daemon two-receipt
   operator proof below.

No production service, runtime refusal, load-test driver, deployment script,
profile, Docker image, or gate configuration changes. `runLoadtestServer` must
continue refusing a present `OPENROUTER_API_KEY` before it calls `start`.

## Compatibility and proof

The operator observed Docker Compose `v5.5.1` on the VM through the documented
read-only SSH helper. Local Docker Compose `v5.4.0` parses `!override`; the same
Compose v2 directive is used by the VM's newer version. `!reset` is insufficient:
it removes `config.env` and its non-secret capacity values. An empty environment
override would mask a value but still makes the real `server.env` file available.

Before retrying task 15.4, run the exact no-daemon receipt in
`handoff/loadtest.md` from the repository root. It copies the real base and
override, substitutes only temporary synthetic env-file paths, and supplies every
base interpolation. It creates `WHIM_CONFIG_SENTINEL=kept` and a synthetic
`OPENROUTER_API_KEY`; it never reads, prints, or references a real key. The
ordinary-list downgrade must exit nonzero because the synthetic key appears in
the merged model. The corrected override must exit zero because the config
sentinel remains and that key is absent. Save both statuses and the single
success/failure labels with the attended evidence; do not print Compose JSON.

## Dispatch and acceptance

`chain-replay-compose-env` performs tasks 19.1–19.3, runs `npm run server:test`
and `./scripts/gate.sh`, writes the updated load-test handoff, and is independently
reviewed and integrity-checked against its three-file allowlist. Docker is not a
fast-gate dependency: the structural tripwire is part of the Node suite, while
the two Compose receipts are an attended preflight after merge.

Task 19.4 remains attended and pending: deploy the exact repaired tip, repeat
the two receipts, start replay and observe its load-test health identity, then
run the original 15- and 16-device drives and restore production. A successful
local model does not satisfy task 15.4.
