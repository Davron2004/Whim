# chain-3 harness feedback (health-probe-path)

- [worked] The dispatcher's terrain list (file:line for every `/healthz` user) made the edit pass mechanical; `git grep` confirmed nothing else pins the path.
- [worked] The handoff contract named the load-test wrapper's behavior on both paths, which settled the stubbed load-test smoke fixture without reading server/src.
- [friction] The uptime assertion in deploy-config.suite.ts used `includes('--path /healthz')`; after the rename to `/health` a substring match would still pass on the old `/healthz`. Only a red-check against the old value exposed it; tightened to a regex with a trailing-boundary lookahead. Lesson: when renaming a path to a prefix of its old form, red-check each pin against the OLD value.
- [friction] A `git checkout <file>` meant to undo one red-check line reverted all of that file's edits; use targeted `sed` to undo a red-check mutation, not checkout.
- [gap] No gate check ties docs/deploy.md's health path to smoke.sh; the doc edits are unverified by any suite.
