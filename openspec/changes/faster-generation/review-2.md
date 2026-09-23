# Review 2: chain-3 re-review (56e18b3..b233869)

Reviewer subagent (sonnet), 2026-09-22. Verdict: changes requested. Both findings are folded into chain-4's fix round.

1. **medium** · `server/test/deploy-config.suite.ts:930,1027` (guarding `deploy/lib.sh:27`). The new deploy tests set `WHIM_PLAN_REASONING` through the process environment, but `deploy/lib.sh` only enforces `WHIM_VALUE_KEYS` on values read from `defaults.env` and the operator's `deploy.env`; an environment value is taken as-is. The reviewer removed the key from `WHIM_VALUE_KEYS` in a scratch copy and the test still passed. The shipped code is correct (a real `deploy.env` line loads), but nothing would catch a regression of the whitelist line that closes the deploy gap. Fix: write the knob into the sandbox operator `deploy.env` file.
2. **low** · `deploy/operator.env.example` lists none of the new optional knobs, unlike the optional store URLs. Fix: add them as blank names.

Checked and clean: review 1's findings 1, 2 and 4 are resolved (the stub-mode catch is strictly narrower and its placeholder re-validation has no side effects; the CLI exit-code tests spawn the real entry and are registered; the replay-model comment matches `roleFor`), the removed `ServerConfig` fields had no readers, docs match the code, no protected config touched.
