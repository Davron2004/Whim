# Sonar round 2 plan

Nested in beta-1 closure, PR #137. Current-head analysis at 46dbc32f reports three open findings. Producer reconciliation supports two false-positive transitions and one bounded behavioral fix.

- [x] S1 — resolve-only queue observer; API false-positive disposition and readback confirmed.
- [x] S2 — closed age-check producer; API false-positive disposition and readback confirmed.
- [ ] S3 — post-stream retry persistence recovery; source fix pending.

The behavioral fix owns only LauncherRoot.tsx and attempt-lifecycle-ui.suite.tsx. The DONE, exact evidence, HIGH severity and rendered Retry → consent → Agree regression are in research.md. Each checkbox closes only after its terminal disposition. No source/code suppression or dummy handler is allowed.
