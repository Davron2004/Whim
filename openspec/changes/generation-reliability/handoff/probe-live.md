# Live probe-shaped call (fix1, finding 1)

STATUS: NOT RUN. The builder could not read the production OpenRouter key.

- Engineer model (from `~/.config/whim/deploy.env`): `deepseek/deepseek-v4.1-flash`, `WHIM_PROVIDER_SORT=throughput`.
- The only key store is Secret Manager `whim-openrouter-api-key` (project `anycognition-whim`). Reading it as the
  active gcloud account (`jamila@anycognition.com`) fails with `PERMISSION_DENIED` on
  `secretmanager.versions.access`; no OpenRouter key exists in the environment or in `~/.config/whim`.
  Granting access is outside this chain, so no call was made with the real key.
- Tooling check: the same code path as the breaker's probe (`createModelProbe` over `openRouterModelClient`
  with `sort: throughput`, `maxTokens: 1`, `reasoning: 'off'`, 10 s signal) was run once with a deliberately invalid
  key. It reached OpenRouter and answered `401` in 102 ms (`errorKind: auth`, `upstream: false`). That proves the
  harness, not that `maxTokens: 1` is accepted: a 401 comes before parameter validation.

To finish: run the script below once with the real key in the environment (it prints one JSON line: model, outcome,
latencyMs, and on a failure errorKind/status; never the key or any content), then paste the line here.

    OPENROUTER_API_KEY=... /private/tmp/claude-501/-Users-davrondjabborov-Work-other-Whim/36a9d384-f075-4c4c-a2e1-525156d710b4/scratchpad/probe-live.sh

If the provider answers `400` to `maxTokens: 1`, the new code already closes the breaker on it (a non-upstream probe
failure), so it cannot lock admission; raise the probe's `maxTokens` in `createModelProbe` to the smallest accepted value.
