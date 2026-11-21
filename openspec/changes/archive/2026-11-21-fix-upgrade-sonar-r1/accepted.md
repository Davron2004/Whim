# Accepted findings: fix-upgrade-sonar-r1

Each was commented with its reason and transitioned to Accepted in SonarCloud (PR #297) on 2026-11-21.

| Finding | Rule | Location | Reason |
|---|---|---|---|
| S3 | docker:S8431 | deploy/Dockerfile:25 | The tag+digest form is required by the deploy-config tripwire (`server/test/deploy-config.suite.ts` `PINNED_IMAGE`, enforced on both deploy Dockerfiles). The digest makes the image immutable; the tag keeps the Node version readable. Dropping either would relax the check. |
| S4 | docker:S8431 | deploy/Dockerfile:42 | Same as S3. |
| S5 | javascript:S9382 | scripts/deps-audit.mjs:61 | The await is the per-worker body of `mapLimited`, a bounded pool (`FETCH_CONCURRENCY = 8`) that keeps input order and fails fast; an unbounded `Promise.all` drops the registry concurrency cap. Same disposition as fix-beta-2-sonar-r1 S296/S300. |
