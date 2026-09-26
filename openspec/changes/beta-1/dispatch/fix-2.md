# fix-2 dispatch block: the deploy smoke proves pre-beta builds are refused

Found during 10.6 (orchestrator): after deploying beta-1's server, nothing in `deploy/smoke.sh` checks that a
request without `x-whim-protocol` gets `426 update_required`. Every smoke probe sends the header
(`smoke.sh:183-186`). That 426 is how builds 381237/382511 (and any future pre-D16 build) are retired (design
D16 layer 2, D17), so every deploy should prove it.

Task: add one smoke check that sends a `/v1` request shaped like an old build: the four envelope headers
(`x-whim-platform: ios`, `x-whim-app-version: 1.0.0`, `x-whim-build: 382511`, `x-whim-consent: 2`) and an
`x-whim-device` id in the format the server's device gate accepts (find it), with NO `x-whim-protocol`. The
check asserts the status is 426 and the body's `error` is `update_required`. Pick a build number that passes the
minimum-build gate on its own (the current production minimum is iOS 382000; don't hardcode anything that the
gate would refuse first, or the check proves nothing). Use the unary route that is cheapest and spends
nothing: the 426 runs before admission, so no model call or ledger row happens. Confirm that in the code and
say where.

Follow `smoke.sh`'s existing probe idiom and output format (`ok    …` lines). If the deploy-config suite pins
the smoke script's checks (look for a test that parses `smoke.sh`), extend it so removing the check fails a test.
Red-check that test by removing the check. Only `deploy/smoke.sh` and its test are in scope. Self-gate with
`./scripts/gate.sh`.
