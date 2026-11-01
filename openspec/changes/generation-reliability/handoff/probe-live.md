# Live probe-shaped call (fix1, finding 1)

STATUS: RUN by the orchestrator, 2026-10-31, two calls with the production OpenRouter key read through an env-scoped gcloud account (never printed or stored).

- Code path: the breaker's own probe (`createModelProbe` over `openRouterModelClient`, `sort: throughput`, `maxTokens: 1`, `reasoning: 'off'`, 10 s deadline).
- Model: `deepseek/deepseek-v4.1-flash` (production engineer model from the operator's deploy env).
- Result: both calls `outcome: completed`; the second reported `latencyMs: 306`. So the provider accepts `maxTokens: 1` and a probe costs one tiny metered request.
- Before that, the builder ran the same code with a deliberately invalid key: `401` in 102 ms (`errorKind: auth`, `upstream: false`), which the breaker now treats as a non-upstream failure and closes on.
