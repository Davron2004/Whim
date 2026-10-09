Constraints for every task: no `CONFIG_SET` file (`package.json`, lockfile, `scripts/gate*.sh`, tsconfig, eslint, knip, `.claude/**`) is edited. New tests extend existing suites, and `server/test/acceptance.ts` is not edited. No test contacts production or a deployed server. Scale-to-zero, `min-instances 0` and `max-instances 1` stay. `/v1/*` stays gated by `x-whim-device`. Every stream still ends in exactly one terminal `GenerationEvent`.

## 1. Idempotent Firestore credit (#145)

- [x] 1.1 Extend the lost-reply harness in `server/test/firestore-conformance.ts` so that, for the duration of one case, it also replays plain commits (`WriteBatch.prototype.commit`, restored in `finally`) as well as `runTransaction`, and counts the replays it made.
  - Add the case "a credit whose commit reply is lost counts once", which asserts that the replay count is greater than 0 and that `totalTokens` grew by exactly the credited amount.
  - Red-check it against today's `credit`, and against a weaker variant that increments inside a transaction without a marker. Both must fail. Record both red runs in the chain report.
- [x] 1.2 Rewrite `FirestoreUsageStore.credit` per design D1.
  - Mint the marker id once per call, outside the transaction function.
  - Run `runTransaction` with `ADMISSION_MAX_ATTEMPTS`.
  - Read `creditMarks/{markerId}`. When it is absent, increment the totals, stamp `lastCreditedDay`, and create the marker as `{ utcDay }`.
  - Keep the `UsageStore.credit` signature and every call site unchanged.
- [x] 1.3 Add marker purging to the Firestore ledger purge path, which both the in-process hourly purge and `whim-admin purge` run. Delete markers whose `utcDay` is before the previous UTC day. Add a conformance case for that cutoff, and confirm that `firestore-index-coverage.ts` reports no missing index.
- [x] 1.4 Confirm that the existing `creditIncrements` cases (including five concurrent credits) and every other conformance case pass on in-memory, SQLite and the emulator. Run `scripts/gate.sh`, plus `npm run -s stores:firestore:test` from the main tree.

## 2. Classifier retry and line-check metering (#119, #120)

- [x] 2.1 `server/src/policy/policy.ts` and `config.ts`: add `WHIM_POLICY_ATTEMPT_TIMEOUT_MS` (default 4500, validated as an integer between 500 and `WHIM_POLICY_TIMEOUT_MS`). Implement design D2:
  - one overall deadline;
  - at most two attempts;
  - retry only on unable-to-verdict results, with at least 1000 ms left and no request abort;
  - never retry auth errors, `allow` or `refuse`;
  - both attempts' usage and generation ids are carried to the caller;
  - the `content policy check` log line gains `attempts`.
- [x] 2.2 Extend `policy.suite.ts` with the four content-policy scenarios: hung first attempt then allow; two timeouts fail closed within the deadline; refusal not retried; aborted request not retried. Use a scripted client and an injected clock or short timeouts, never a fixed tick budget. Red-check the "hung first attempt" case against today's single-attempt code.
- [x] 2.3 Add `RequestKind` `policy-check`, plus `WHIM_LIMIT_POLICY_CHECKS_PER_DEVICE_DAY` (30) and `WHIM_LIMIT_POLICY_CHECKS_PER_DAY` (800) in `config.ts`. Make every store, the usage `summary` and report, and the operator usage report accept the new kind, grouping a `<id>:policy-check` row with its request. Extend the store conformance cases so the new kind admits, limits and purges identically on in-memory, SQLite and Firestore.
- [x] 2.4 `server/src/routes/generate.ts` line path, per design D3: after the existing credit check and `generate` `unitAvailable`, admit `<requestId>:policy-check`, refusing with `429 daily_limit` on a device or global limit. Then run `checkPolicy`, settle the row (`ok` / `refused`+`content_policy` / `unavailable`+`policy_unavailable`), and resolve the row's cost through `resolveRequestUsage`. Never refund the row. Replace `recordLineRefusal`'s admit-then-refund of a `generate` row. Leave the free-slot path and the unary routes unchanged.
- [x] 2.5 Extend `routes-generate.suite.ts` and `admission.suite.ts` with the five server-admission-control scenarios: join-and-abort loop bounded; fresh ids bounded globally; unavailable in line leaves a row with tokens; refusal in line spends a check unit only; free-slot path unchanged. Each case must also assert exactly one terminal event per opened stream. Red-check the loop case against today's code.
- [x] 2.6 Write `handoff/policy-bounds.md`: the new env names, defaults and validation; the `policy-check` kind and row-id rule; the new log field; and confirmation that an older image's `summary` tolerates the unknown kind (or what it does instead).

## 3. Browser launch resilience (#139)

- [ ] 3.1 `synthrun/session.ts`: make the single launch call site (`startBrowser`) retry a failed launch up to three attempts in total, 500 ms apart, reusing the same `browserLaunchOptions()` result object on every attempt. Log each failure with its attempt number and exit signal or error message only. Boot and relaunch-after-disconnect share the loop. Keep the `synthrun/test/isolation.ts` single-call-site scan passing.
- [ ] 3.2 `server/src/lifecycle.ts`: before the first launch, log one `boot host` record with the CPU `model name`, the presence of the `pku`/`ospke` flags (from `/proc/cpuinfo`) and `os.release()`, using `unknown` when they are unavailable. After the final failed attempt, `BootError('browser_launch')` and exit 1 behave as today.
- [ ] 3.3 Tests in the existing suites that already cover launch failure (`synthrun/test/resilience.ts` for the session, and `server/test/prod-build.suite.ts` for boot's `browser_launch`), using an injected launcher that records options:
  - fail twice then succeed → boot listens, two logged failures;
  - fail three times → boot exits non-zero naming the browser launch, with no port bound;
  - every recorded attempt's options are deep-equal to the production options with `chromiumSandbox: true`;
  - the host record is logged before the first attempt.

  Red-check the "fail once then succeed" case against today's code.
- [ ] 3.4 Write `handoff/browser-launch.md`: the log message names and fields, and the attempt bound.

## 4. Cloud Run alerts and smoke (#138, #146)

- [ ] 4.1 Retarget every file in `deploy/monitoring/` per design D5:
  - log filters use `resource.type="cloud_run_revision"`, `resource.labels.service_name="whim-server"` and the `run.googleapis.com%2Fstdout` log name;
  - the threshold policy names the metric on `cloud_run_revision`;
  - no file mentions `log_id("docker")` or `gce_instance`.

  Leave `policy-purge-failed.json` as it is (already Cloud Run).
- [ ] 4.2 Move `provision.sh`'s monitoring render/apply-by-fingerprint helpers into `deploy/lib.sh`, so `provision.sh` keeps working through them. Generalise `deploy/cloudrun/deploy.sh`'s `apply_purge_alert` so that it applies the channel, the log metric, every `policy-*.json` and the uptime check on plain deploys, but not on `--tag` or `--site-only`. Forward the three env keys from `handoff/policy-bounds.md` as optional server keys.
- [ ] 4.3 Factor the shared HTTP checks (`/health` parsing with `--commit` and the minimum builds, `426`, SSE spacing, pages, and association files compared against the site build's local output) out of `deploy/smoke.sh` into `deploy/lib.sh`. The VM smoke behaves exactly as before, and its existing deploy-config cases stay green.
- [ ] 4.4 Add `deploy/cloudrun/smoke.sh` per spec and design D6:
  - domain mappings and serving revision through read-only `gcloud describe`;
  - the shared HTTP checks;
  - the `whim-purge` job and scheduler;
  - the beta signup trap only if it writes nothing;
  - one live `POST /v1/clarify` with the fixed smoke device id `5e0ce000-0000-4000-8000-00000000c1a1` unless `--no-live`;
  - a `--pages-only` mode;
  - no VM values required.
- [ ] 4.5 Make `deploy/cloudrun/deploy.sh` run the smoke at the end of every mode (pages-only after `--site-only`), exit non-zero on failure, and print the rollback command with the replaced revision's commit.
- [ ] 4.6 Extend `server/test/deploy-config.suite.ts`, using the fake `gcloud`/`curl`/DNS tools:
  - no monitoring file references Docker or GCE;
  - a plain deploy applies every policy file and leaves unchanged ones alone;
  - `--tag` applies none;
  - the smoke runs with `WHIM_STATIC_IP`/`WHIM_GCP_ZONE` unset;
  - a commit mismatch fails and prints rollback;
  - exactly one request carries the smoke device id, and it is `POST /v1/clarify`;
  - `--no-live` sends no device id;
  - `deploy.sh` invokes the smoke in each mode;
  - every new script passes the shell syntax check.

  Red-check the "deploy runs smoke" case against today's `deploy.sh`.
- [ ] 4.7 Write `handoff/cloudrun-ops.md`: the smoke CLI and modes, its check list, the smoke device id and prompt, the monitoring apply behaviour, and the exact filters used.

## 5. Firestore admission load test (#143)

- [x] 5.1 Add the harness under `server/test/` (test code, never bundled into production), per design D7:
  - drive N concurrent `FirestoreUsageStore.admit` calls in two profiles, `generate`, and a clarify+rewrite mix under the shared unary ceiling;
  - count transaction attempts by wrapping `runTransaction`'s update function;
  - output JSON with p50/p99 latency, an attempts histogram, the exhausted count, and admitted versus expected.
- [x] 5.2 Add `deploy/loadtest/firestore-admission.sh`.
  - Default: the emulator via the pinned `firebase-tools` `emulators:exec` command form used by `stores:firestore:test`.
  - `--database whim-loadtest-<suffix> --confirm-spend` runs against real Firestore with ADC, and the script:
    - refuses `(default)`, the deployed `WHIM_FIRESTORE_DATABASE`, and unprefixed names before creating any client;
    - enforces the operation cap (default 5,000, ceiling 20,000) and prints the estimated cost first;
    - creates the database in `WHIM_GCP_REGION` and deletes it in an `EXIT` trap.
  - The script never contacts a deployed server.
- [x] 5.3 Add the small-burst correctness case to `firestore-conformance.ts`: 50 concurrent admits for a global limit of 20 admit exactly 20, and none exhausts its retries.
- [x] 5.4 Extend `server/test/loadtest.suite.ts` with the script's guard cases, using a fake `gcloud`:
  - reserved and production names are refused before any `gcloud firestore databases create`;
  - a cap above the ceiling is refused;
  - a failing run still calls `gcloud firestore databases delete`.
- [x] 5.5 Write `handoff/firestore-admission-loadtest.md`: the CLI, the report fields, the cap and cost estimate, and how to read contention from the report.

## 6. Runbook, decision, capability map

- [ ] 6.1 `docs/deploy.md` "Cloud Run":
  - replace the "Logs" and "Chromium sometimes crashes" bullets with the new behaviour;
  - document the Cloud Run smoke (checks, live clarify, smoke device id, `--no-live`);
  - rewrite the Operating saved-query and alert tables with the Cloud Run filters from `handoff/cloudrun-ops.md`;
  - add the three new env vars to the limits documentation.
- [ ] 6.2 `docs/deploy.md` "Firestore stores":
  - credit markers (`creditMarks`, purge cutoff);
  - the Firestore admission load test (emulator default, the throwaway-database rules, how to read the report);
  - a note that the capacity table's caps are the VM's, carried over unmeasured on Cloud Run (#134).
- [ ] 6.3a Record in the decision entry and `docs/deploy.md` that a refusal in line writes a `policy-check` row AND a non-refunded `generate` row (ruling 3), and make the usage summary's `failureReasonCounts` count that refusal once (attribute `content_policy` to the `generate` row only), with a test that fails on the double count.
- [ ] 6.3 Append the next-numbered entry to `docs/decisions.md`, covering D1, D3 and D4 plus #134's exclusion. Update the `server-deployment` and `server-admission-control` rows in `docs/capabilities.md`.

## 7. Rollout and verification (orchestrator, attended, after merge)

- [ ] 7.1 Read-only: query production logs (`gcloud logging read`, Cloud Run filter) for every `content policy check` line in the last 14 days. Record the duration p50/p99, the `unavailable` rate, and the clarify `policy_unavailable` count in `progress.md`. Set `WHIM_POLICY_ATTEMPT_TIMEOUT_MS` in the operator values file if the measured p99 of healthy calls exceeds 4000 ms.
- [ ] 7.2 Run `deploy/loadtest/firestore-admission.sh` (emulator) at bursts of 10, 25, 50 and 100. Record the reports in `progress.md` and the runbook.
- [ ] 7.3 ONLY with the product owner's explicit approval: run one capped throwaway-database run (`--database whim-loadtest-<date>`), record the report, and confirm with `gcloud firestore databases list` that the database is gone.
- [ ] 7.4 Deploy with `deploy/cloudrun/deploy.sh` (plain). Smoke must pass, including its one live clarify. Then confirm with `gcloud monitoring policies list` that no policy filter mentions `docker`/`gce_instance`, and confirm the ledger row for the smoke device id in Firestore.
- [ ] 7.5 Read-only: run each alert and metric filter through `gcloud logging read --freshness=30d`. Record matched or "no history, unverified" per filter in `progress.md`.
- [ ] 7.6 Comment the evidence on #145, #119, #120, #138, #139 (keep open for root cause), #143 (close or keep open for sharding per 7.2/7.3) and #146. Re-aim #134 at Cloud Run with the cost-approval note.
