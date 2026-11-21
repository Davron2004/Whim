# plan: fix-upgrade-sonar-r1

Nested Sonar round 1 of `upgrade-to-latest-dependencies` (PR #297), run on `integration/upgrade-to-latest-dependencies`. Findings: findings.md (SonarCloud gate already OK; 6 open issues on new code). Planner: read-only researcher (sonnet); its full DONE specs are summarised here.

- [x] S1 deploy/Dockerfile:44 docker:S7031: FIX, structural-no-test, low. Chain the `groupadd`/`useradd` RUN onto the preceding Playwright install RUN (no comment or check needs them split). Regression: deploy-config suite (playwright pin regex must still see `playwright@1.65.1`); the worker also builds the runtime stage locally and checks `id whim` = uid/gid 10001 and that Chromium's headless shell is present. Allowlist: `deploy/Dockerfile`.
- [x] S2 scripts/release/lib/storage-dump.ts:123 typescript:S6551: FIX, structural-no-test, low. `sql: typeof row.sql === 'string' ? row.sql : null` (sqlite_master.sql is TEXT or NULL; `DumpObject.sql` is `string | null`). Regression: checks/test/release/storage-dump.suite.ts. Allowlist: `scripts/release/lib/storage-dump.ts`.
- [x] S3 deploy/Dockerfile:25 docker:S8431: ACCEPT. The tag+digest form is required by the tripwire `server/test/deploy-config.suite.ts:184` (`PINNED_IMAGE = /^[\w./-]+:[\w.-]+@sha256:[0-9a-f]{64}$/`, enforced by `fromProblems` :195-196 on both deploy Dockerfiles); the tag keeps the Node version readable next to the immutable digest (Dockerfile header lines 6-8). Dropping it means relaxing a checker (harness §8).
- [x] S4 deploy/Dockerfile:42 docker:S8431: ACCEPT, same reason as S3.
- [x] S5 scripts/deps-audit.mjs:61 javascript:S9382: ACCEPT. The await is the per-worker body of `mapLimited`, a bounded pool (FETCH_CONCURRENCY = 8) that keeps input order and fails fast; an unbounded Promise.all would drop the registry concurrency cap. Precedent: fix-beta-2-sonar-r1 accepted.md S296, S300 ("deliberate sequencing").
- [x] S6 scripts/lib/dependency-pins.mjs:21 javascript:S7776: FIX, structural-no-test, low. `ENTRY_FIELDS` → `new Set([...])`, `.includes(key)` → `.has(key)` (only use :247). Regression: checks/test/repo/dependency-pins.suite.ts:115-116 (unknown field fails). Allowlist: `scripts/lib/dependency-pins.mjs`.

Lane: S1, S2, S6 in one fix-worker (three one-line structural fixes, disjoint files), one worktree `fix-upgrade-sonar-r1-lane1`.
