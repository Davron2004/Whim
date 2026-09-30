# DONE: sonar-r1-detached-resolution-routes
Findings: S8, S23-S24, S26, S51-S59, typescript:S9383, MAJOR.
Explicitly discard each ResolveTracker.track return. Preserve each resolver call's request id, generation ids, credit ownership, route response timing, and drain tracking. ResolveTracker registers the same promise and installs fulfilment/rejection untracking handlers. Structural only; no new test. This cohort exclusively owns generate.ts and must run before or after, never alongside, line-wakes.
