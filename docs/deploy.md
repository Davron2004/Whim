# Deploying the public server

A runbook for operating `api.whim.anycognition.ca` and `whim.anycognition.ca` (design.md D6, D17,
D19–D26). Every command below is run from a clean, pushed checkout unless it says otherwise.

## 1. One-time provisioning (orchestrator, `gcloud` auth as the project owner)

```sh
deploy/provision.sh                    # VM on the standard profile
deploy/provision.sh --profile event    # or straight onto the event machine type
```

Idempotent: creates the Artifact Registry repo, a minimal service account, the VM with its
persistent disk and its daily snapshot schedule, firewall rules (80, 443/tcp+udp, IAP-only SSH),
the **empty** Secret Manager secret `whim-openrouter-api-key`, the private source-map bucket
`gs://<WHIM_GCP_PROJECT>-sourcemaps`, the alerts in `deploy/monitoring/` and the billing budget (see
Operating → Alerts). It adopts the reserved static IP whose value is `WHIM_STATIC_IP` and fails if
none exists — it never creates one, because a wrong address would move DNS. It never adds a secret
version; see "OpenRouter key" below. It needs `WHIM_ALERT_EMAIL`, `WHIM_BILLING_ACCOUNT` and
`WHIM_MONTHLY_BUDGET` in the values file, and gcloud's `beta` component for the notification
channel and the billing account's currency (`gcloud components install beta`).

Each alert resource is found by display name (the log metric by name) and carries a fingerprint of
its rendered definition, so a rerun creates what is missing, updates what changed and prints
`unchanged` for the rest; a second run with the same values changes nothing. Two resources sharing
one display name make it stop rather than guess: delete the extra one in the console. The uptime
check's host can't be edited in place, so after a host change it stops and names the check to
delete.

Then bootstrap the VM itself:

```sh
gcloud compute scp --tunnel-through-iap --recurse deploy/vm whim-vm:/tmp/whim-vm
gcloud compute ssh whim-vm --tunnel-through-iap \
  --command 'sudo bash /tmp/whim-vm/bootstrap.sh --region northamerica-northeast1'
```

`bootstrap.sh` installs Docker + the compose plugin and the Ops Agent with its log-shipping config
(see Operating → Logs), formats and mounts the data disk at
`/mnt/disks/whim-data`, creates the owned data directories, asserts unprivileged user namespaces
work (Chromium's sandbox needs them), and installs the egress firewall and the daily log age cap
("Log retention on the VM" below). Safe to rerun.

### Persistent-disk snapshots

The disk holds the usage ledger, reports, the beta waitlist and the published site — the only durable state.
`provision.sh` creates the snapshot schedule `whim-data-daily` (daily at 07:00 UTC, each snapshot
kept 14 days) and attaches it to `whim-data`. A resource policy can't be edited, so if one by that
name keeps a different number of days it stops: detach and delete that policy, then rerun.

Restoring the disk from a snapshot (the server is down from step 2 to step 6):

```sh
gcloud compute snapshots list --filter='sourceDisk~/whim-data$' --sort-by=~creationTimestamp   # pick SNAPSHOT
gcloud compute instances stop whim-vm --zone "$WHIM_GCP_ZONE"
gcloud compute snapshots create whim-data-before-restore --source-disk whim-data \
  --source-disk-zone "$WHIM_GCP_ZONE"                                # keeps today's state, just in case
gcloud compute instances detach-disk whim-vm --disk whim-data --zone "$WHIM_GCP_ZONE"
gcloud compute disks delete whim-data --zone "$WHIM_GCP_ZONE"
gcloud compute disks create whim-data --zone "$WHIM_GCP_ZONE" --type pd-balanced --source-snapshot SNAPSHOT
gcloud compute instances attach-disk whim-vm --disk whim-data --device-name whim-data --zone "$WHIM_GCP_ZONE"
gcloud compute instances start whim-vm --zone "$WHIM_GCP_ZONE"
deploy/provision.sh    # reattaches the snapshot schedule to the new disk
deploy/smoke.sh
```

The restored filesystem keeps its UUID, so the VM's `/etc/fstab` line mounts it unchanged and the
containers come back on boot (`restart: unless-stopped`). Delete `whim-data-before-restore` once
the restore is confirmed.

## DNS

At GoDaddy, two `A` records, no `AAAA`:

| Host | Value |
|---|---|
| `whim` | `34.118.191.193` |
| `api.whim` | `34.118.191.193` |

Saving a record change needs GoDaddy's SMS 2FA. `deploy/smoke.sh` resolves both hostnames before
making any HTTPS request and fails, naming the record, unless each `A` set is exactly
`WHIM_STATIC_IP` with no `AAAA` — a DNS slip then reads as a DNS error, not a certificate failure
two steps later.

## OpenRouter key

The OWNER creates the production key in OpenRouter with a provider-side credit limit, then adds it
as a new version of Secret Manager secret `whim-openrouter-api-key`. No script here creates, rotates
or reads that key into OpenRouter — `provision.sh` only creates the secret container, empty.

**Recommended starting limit: $50** (design.md D6). The global daily generation ceiling, not this
limit, is what shapes day-to-day spend; the limit is a coarse backstop against the ceiling being
misconfigured or bypassed. $50 covers roughly two worst-case days, enough to catch a bad deploy
before it costs real money. Raise it in the OpenRouter dashboard once `whim-admin usage` (below)
shows real cost per generation instead of the placeholder table in D6 — a week-1 recalibration.

Before the secret has an enabled version, `deploy/deploy.sh` (without `--site-only`) exits non-zero
naming the secret and this section, and builds, uploads or restarts nothing.

## Operator values file

`~/.config/whim/deploy.env` (outside the repo; names only in `deploy/operator.env.example`):

| Variable | Required | Notes |
|---|---|---|
| `WHIM_SUPPORT_EMAIL` | yes | rendered on the privacy and support pages |
| `WHIM_ENGINEER_MODEL`, `WHIM_REWRITE_MODEL` | yes | the model pair the server runs with (not rendered on the pages) |
| `WHIM_CLARIFY_MODEL`, `WHIM_SUMMARY_MODEL`, `WHIM_PLAN_MODEL`, `WHIM_REPAIR_MODEL` | no | optional per-role model overrides; see the roster table below |
| `WHIM_CLARIFY_REASONING`, `WHIM_REWRITE_REASONING`, `WHIM_SUMMARY_REASONING`, `WHIM_PLAN_REASONING`, `WHIM_ENGINEER_REASONING`, `WHIM_REPAIR_REASONING` | no | per-role reasoning setting: `off`, `on`, `low`, `medium`, `high` or `default` |
| `WHIM_PROVIDER_SORT` | no | OpenRouter provider order: `price`, `throughput` or `latency` |
| `WHIM_PROVIDER_QUANTIZATIONS` | no | the quantizations OpenRouter may route to, comma-separated from `int4`, `int8`, `fp4`, `fp6`, `fp8`, `fp16`, `bf16`, `fp32`, `unknown`; unset sends no preference. Set it only after a flowbench comparison |
| `WHIM_QUEUE_MAX` | no | how many generations may wait in line for a slot; unset is `50`. `0` turns the line off: a generation that finds every slot busy is refused `server_busy` at once, as before the line (see "Rolling back and rotating the key") |
| `WHIM_QUEUE_MAX_WAIT_MS` | no | how long a generation may wait in line before its stream ends in a `failure` saying Whim is busy; unset is `180000` |
| `WHIM_MIN_BUILD_IOS`, `WHIM_MIN_BUILD_ANDROID` | no | the oldest build each platform may use the AI features with; unset is `0` (off). See "Minimum supported build" |
| `WHIM_USAGE_IDLE_DAYS` | no | days a phone ID's lifetime usage totals are kept after its last request; unset is `365`, and the server refuses a value above the usage-records maximum the disclosure manifest publishes |
| `WHIM_BETA_LIMIT_PER_CLIENT_HOUR`, `WHIM_BETA_LIMIT_PER_DAY` | no | the `/beta` signup limits: signups one client address may make per hour (unset is `10`) and signups the whole list takes per day (unset is `2000`). See Operating → Beta waitlist |
| `WHIM_APP_STORE_URL`, `WHIM_PLAY_STORE_URL` | no | the app-link fallback page's store-links block, dropped when both are unset |
| `WHIM_ALERT_EMAIL` | for `provision.sh` | where every alert and the budget email go (Operating → Alerts) |
| `WHIM_BILLING_ACCOUNT` | for `provision.sh` | the billing account id (`XXXXXX-XXXXXX-XXXXXX`) the spend budget is created on |
| `WHIM_MONTHLY_BUDGET` | for `provision.sh` | the budget's monthly amount in whole units of the billing account's currency (Cloud Billing refuses any other; `provision.sh` reads it from the account, and stops if it can't); it emails at 50, 90 and 100 % |

Loaded after the committed `deploy/defaults.env` and before the process environment (later wins).

## Model roster, reasoning and provider routing (design D1–D3)

Six roles, each with its own model and reasoning setting (`server/src/generation/model.ts`'s
`modelRosterFromEnv`):

| role (call sites) | model var (fallback) | reasoning var (default) |
|---|---|---|
| clarify | `WHIM_CLARIFY_MODEL` (→ `WHIM_REWRITE_MODEL`) | `WHIM_CLARIFY_REASONING` (`off`) |
| rewrite | `WHIM_REWRITE_MODEL` (required) | `WHIM_REWRITE_REASONING` (`off`) |
| summary | `WHIM_SUMMARY_MODEL` (→ `WHIM_REWRITE_MODEL`) | `WHIM_SUMMARY_REASONING` (`off`) |
| plan | `WHIM_PLAN_MODEL` (→ `WHIM_ENGINEER_MODEL`) | `WHIM_PLAN_REASONING` (`on`) |
| engineer (generate) | `WHIM_ENGINEER_MODEL` (required) | `WHIM_ENGINEER_REASONING` (`on`) |
| repair | `WHIM_REPAIR_MODEL` (→ `WHIM_ENGINEER_MODEL`) | `WHIM_REPAIR_REASONING` (→ engineer's effective setting) |
| content-policy classifier | the rewrite role's model (no variable of its own) | always `off` |

Each role's reasoning variable takes one of `off`, `on`, `low`, `medium`, `high`, `default`; an
empty or unset model-override variable falls back as the table shows. `default` restores the exact
pre-D1 wire behavior for that role (no `reasoning` field sent, the provider's own default). An
invalid reasoning value fails server boot, naming the variable and the allowed values.

**The rewrite-side model MUST accept `reasoning: { enabled: false }`** — every content-policy
classifier call rides on it (spec content-policy "adds no new model role or model id"), and a model
that rejects the field fails every classifier call closed (`503 policy_unavailable`), which fails
every clarify, rewrite and generate request behind it. Measured refusers (`400 Reasoning is
mandatory for this endpoint and cannot be disabled`): `z-ai/glm-5.3-flash`, `stepfun/step-3.5-flash`.
Rule out a candidate `WHIM_REWRITE_MODEL` against this before deploying it.

`WHIM_PROVIDER_SORT` (optional) is `price`, `throughput`, or `latency`; when set, every request
asks OpenRouter to route by it. Unset (default) sends no provider preference.

`WHIM_PROVIDER_QUANTIZATIONS` (optional) limits every request to providers serving one of the
listed quantizations (`provider.quantizations`). Entries are trimmed and empty ones dropped; a name
outside the list above fails server boot, naming the variable. Unset or empty leaves the `provider`
object exactly as it was without it.

## First deploy

```sh
deploy/deploy.sh --site-only   # once DNS resolves — publishes the pages, builds/reads no image or secret
deploy/deploy.sh               # once the OpenRouter secret has a version — the full deploy
```

`--site-only` publishes `/privacy`, `/privacy/v1`, `/terms`, `/fr/privacy`, `/fr/terms`, `/support`, `/a/*`, the beta
waitlist pages `/beta`, `/beta/thanks` and `/beta/retry` with their fonts under `/assets/*`, uploads the
Caddyfile and reloads Caddy; it never touches the server container. The `/beta` form posts to
`https://<WHIM_API_HOST>/beta/signup`, which the full deploy's server answers; the server redirects
back to `WHIM_WEB_ORIGIN`, which the deploy writes into `config.env` as `https://<WHIM_WEB_HOST>`.
Both deploys refuse before anything is uploaded when a legal page fails its check: an empty required
value in `deploy/site/legal-identity.json`, a `{{…}}` left unresolved, a draft marker such as `[B9]`,
or a retention row that disagrees with the disclosure manifest (`server/src/site/legal-pages.ts`).
They also refuse when the `/beta` consent wording (its `data-notice` elements) isn't the notice
`server/src/waitlist/notices.ts` registers as current: register the new wording there first. The
full deploy builds the image via Cloud Build (unless `--tag` names one that already exists), uploads
compose/seccomp/config, writes the secret into `/etc/whim/server.env`, recreates `whim-server`, and
runs smoke.

## Verifying (smoke)

`deploy/smoke.sh` runs at the end of every deploy; run it standalone any time:

```sh
deploy/smoke.sh               # full: DNS, API, server container, pages, association files
deploy/smoke.sh --pages-only  # DNS + pages only
```

What each check means:

- **DNS** — both hostnames resolve to `WHIM_STATIC_IP` only, no `AAAA`.
- **`/healthz`** — `200` with a JSON body holding `"ok":true`, `"service":"whim-server"`, the
  `"commit"` the image was built from and `"minBuild":{"ios":0,"android":0}`, with the two minimums
  your values file sets in place of the zeros: the boot self-test (a real generation through the
  sandbox) passed, this isn't a stray load-test container (its `/healthz` would name
  `whim-server-loadtest`), and the minimum builds you deployed are the ones the server enforces.
  `commit` is baked into the image by Cloud Build (`WHIM_COMMIT`, from the same SHA that tags it);
  standalone, smoke accepts any full 40-character SHA and fails on `"unknown"` (an image the
  release pipeline didn't build). `deploy.sh` runs `deploy/smoke.sh --commit <sha>` with the SHA it
  rolled out, so a container still serving the previous image fails, naming both SHAs. A server
  without `minBuild` passes the minimum-build check with one `WARN` line when both minimums are `0`,
  and fails it when either is raised, since that server cannot enforce it.
- **`/v1/generate` without a device header → `400`** — the identity gate is live.
- **`/healthz/sse` frame spacing** — the proxy isn't buffering the stream.
- **metadata-server fetch blocked from inside the container** — the synthetic run's egress lock is
  still on in production, not just in dev.
- **no `react-native` under the image's `node_modules`** — the production tree never carries the
  device bundle.
- **`/privacy`, `/privacy/v1`, `/terms`, `/fr/privacy`, `/fr/terms`, `/support`, `/a/x` → `200` html, `/nope` → `404`,
  none redirected** — the pages
  host serves flat files with no directory-index redirect (a redirect would break the association
  files below).
- **each `.well-known` path** — `200` + `application/json` + no redirect + bytes equal to the
  published file, or `404` when the site shipped none (see the go-live order next).

## The pages host and going live with association files

`whim.anycognition.ca` is a second site on the same Caddy (design.md D21). Before any of the steps
below matter, the app side must already point at this domain: `WHIM_DOMAIN` in
`release/whim-release.xcconfig` and `src/host/launcher/release-config.ts` must both be
`anycognition.ca` (platform-release-readiness's precondition, held by its own lockstep suite).

1. The first server deploy publishes the legal pages, `/support` and `/a/*`. Both `.well-known` paths
   answer `404` — no fingerprint is committed yet.
2. platform-release-readiness task 14.1 commits `release/android-upload-cert.sha256`. The site is
   unaffected: the association-files command still refuses with only the upload fingerprint.
3. platform-release-readiness task 14.2 registers Associated Domains and the App Store Connect
   record. The Apple association file's content doesn't depend on this — it's fixed by the team and
   bundle ids — so serving it before or after this step is harmless.
4. platform-release-readiness task 14.3 uploads the first AAB as a draft and commits
   `release/android-play-signing-cert.sha256`. Run `deploy/deploy.sh --site-only` — both
   `.well-known` files go live together, Play signing fingerprint first.
5. Only after step 4: the closed-testing rollout (Android verifies at install) and platform-release-
   readiness task 14.6's first TestFlight build.

## Operating

Every command below runs on the VM, from a laptop as
`gcloud compute ssh whim-vm --tunnel-through-iap --command '<command>'`. Compose needs `sudo` and
the project directory: `/opt/whim/.env` is root-only (`0600`), and without it compose can't
interpolate `compose.yaml`. `$C` below stands for
`sudo -H docker compose --project-directory /opt/whim --file /opt/whim/compose.yaml` (the same
string the deploy scripts use, from `deploy/lib.sh`).

- **Logs** — in Logs Explorer (project `WHIM_GCP_PROJECT`; scope it to the `whim-logs` bucket), 30 days
  in the `whim-logs` bucket in `WHIM_GCP_REGION`, which the `_Default` sink feeds (`provision.sh`). The
  Ops Agent on the VM host (`deploy/vm/ops-agent.yaml`, installed by `bootstrap.sh`) ships both
  containers' json-file logs, 1–4 s behind. Structured JSON via `pino`, redacted at the serializer:
  no request content, ever. Each pino field is a typed `jsonPayload` field, and severity comes from
  the pino level. Save these queries:

  | Query | Filter |
  | --- | --- |
  | One request (the `x-whim-request-id` a client reports) | `log_id("docker") jsonPayload.requestId="<id>"` |
  | Terminal failures, by reason | `log_id("docker") jsonPayload.msg="terminal failure"`, plus `jsonPayload.reason="<code>"` to narrow (`reason` holds the closed failure code, e.g. `plan_failed`, never the sentence the user saw) |
  | Device errors | `log_id("docker") jsonPayload.scope="device"` |
  | Accepted reports | `log_id("docker") jsonPayload.msg="report accepted"` (its `reportId` feeds `reports show` below) |
  | Warnings and worse | `log_id("docker") severity>=WARNING` |

  `labels.compose_service="whim-server"` or `="caddy"` picks a container. Entries written before the
  `labels` option in `compose.yaml` was deployed don't have it: use `jsonPayload.pid:*` for pino and
  `jsonPayload.ts:*` for Caddy. A line that isn't JSON (a crash trace) arrives as the string
  `jsonPayload.log` with no severity, and a line over 16 KiB arrives split into unparsed pieces.
  From a terminal, pass the same filter to `gcloud logging read '<filter>' --project
  "$WHIM_GCP_PROJECT" --freshness 1d`. Fallback on the VM: `$C logs --since 24h whim-server` (or
  `logs -f`). json-file stays the logging driver so this keeps working.
  If entries stop arriving, check `systemctl is-active google-cloud-ops-agent-fluent-bit` and
  `journalctl -u google-cloud-ops-agent` on the VM.
- **Alerts** — `provision.sh` applies `deploy/monitoring/` (policy JSON, the uptime check's
  settings, the log metric) and emails everything to `WHIM_ALERT_EMAIL`. Tune a threshold by editing
  the file and rerunning `provision.sh`. What each email means and the first thing to run:

  | Alert | Fires when | Rate | First command |
  | --- | --- | --- | --- |
  | Whim: API down | `https://<WHIM_API_HOST>/healthz` (checked every 5 min from 3 regions) failed its last two checks in at least two regions | while it lasts | `deploy/smoke.sh` from a laptop: it names the failing layer |
  | Whim: new report | a user sent a report; the email names its id and reason only | at most 1 per 5 min | `$C exec -T whim-server node server/whim-admin.mjs reports show <id>` (then `reports list` for any the rate limit folded in) |
  | Whim: generation failures | more than 5 `terminal failure` lines in an hour (log metric `whim-terminal-failures`) | while it lasts | `$C exec -T whim-server node server/whim-admin.mjs usage --days 1` for counts by reason, then the "Terminal failures" query above |
  | Whim: credit exhausted | a `budget_exhausted` refusal (`jsonPayload.msg="request" jsonPayload.error="budget_exhausted"`), or a mid-generation provider `402` (`jsonPayload.msg="provider credit exhausted"`) | at most 1 per hour | check the OpenRouter credit balance at https://openrouter.ai/credits and top it up |
  | Whim: device error | a phone sent a diagnostic at `ERROR` or above | at most 1 per hour | the "Device errors" query above, plus `severity>=ERROR` |
  | Whim monthly spend (budget) | GCP spend on `WHIM_BILLING_ACCOUNT` for this project passes 50, 90 or 100 % of `WHIM_MONTHLY_BUDGET` | once per threshold per month | the Billing reports page for the project, by service |

  "While it lasts" means one email when the condition starts and one when it clears. The budget
  also emails the billing account's admins.
- **Reports** — `$C exec -T whim-server node server/whim-admin.mjs reports list [--since N] [--limit N] [--json]`,
  `reports show <id> [--json]`, `reports purge`.
- **Usage and cost** — `$C exec -T whim-server node server/whim-admin.mjs usage [--days N] [--top N] [--json]`
  — cost per generation, per device and per day, from the ledger.
- **Beta waitlist** — the signups from `/beta`, in `waitlist.db` under `WHIM_DATA_DIR`. No HTTP route
  reads it; the waitlist command inside the container is the only way in. It prints CSV
  (`email,platform,updates_opt_out,created_at,updated_at`, times in UTC) to stdout:

  ```sh
  $C exec -T whim-server node server/whim-waitlist.mjs export                        # everyone
  $C exec -T whim-server node server/whim-waitlist.mjs export --platform android     # ios | android | other
  $C exec -T whim-server node server/whim-waitlist.mjs export --updates-ok           # without the opt-out
  $C exec -T whim-server node server/whim-waitlist.mjs remove someone@example.com    # any casing
  ```

  **Android testers for Play closed testing:** run the `--platform android` export through
  `gcloud compute ssh` into a file on your laptop, keep the `email` column
  (`cut -d, -f1 android.csv | tail -n +2 > testers.txt`), and paste the addresses into Play Console →
  Testing → Closed testing → the track → Testers → the email list. Google invites each one; that
  address is why the `/beta` page asks Android people for their phone's Google account. Only mail
  the rows with `updates_opt_out=false` (`--updates-ok`) about anything other than the beta.
  A person who asks to leave the list: `remove <their email>`, which exits 1 if they aren't on it.
  Rows are also deleted 730 days after their last signup (the purge runs at boot and hourly), the
  period the privacy policy publishes. In dev, `node server/waitlist.mjs …` runs the same command
  against the local `WHIM_DATA_DIR`. The route's limits are `WHIM_MAX_BODY_BYTES_BETA` (4096, a
  default in `server/src/config.ts`), `WHIM_BETA_LIMIT_PER_CLIENT_HOUR` (10, per forwarded client
  address, held only in memory) and `WHIM_BETA_LIMIT_PER_DAY` (2000). The last two are operator
  values: set them in `~/.config/whim/deploy.env` and run a full deploy. Before an event where many
  people share one network (a venue's Wi-Fi reaches the server as one address), raise
  `WHIM_BETA_LIMIT_PER_CLIENT_HOUR`, e.g. to 200. A refused or malformed signup lands on
  `/beta/retry`; its log line (`jsonPayload.msg="beta signup"`) carries only `outcome` (`stored`,
  `updated`, `invalid`, `limited`, `trap`, `error`) and `requestId`, never the address.
- **Tuning limits** — apart from the two beta signup limits above, a capacity profile (below) is the
  only deploy-time lever, and it never carries a daily limit, a retention period or `NODE_ENV` by
  construction. Changing a daily/global limit (design.md D6's table) means editing its default in
  `server/src/config.ts` and deploying that commit — a code change, not a runtime flag, so it goes through the same review as anything else.
  Two global daily ceilings, not the per-device limits, are what actually bound a day's spend — a
  client can mint a fresh device id per request: `WHIM_LIMIT_GENERATIONS_PER_DAY` (400) for
  `/v1/generate`, and `WHIM_LIMIT_UNARY_PER_DAY` (2000) for `/v1/clarify` and `/v1/rewrite`
  together — one ceiling counted across both, not one each. Past either, that route answers
  `429 server_busy` with `Retry-After` set to the next UTC midnight. The anonymous stream probe has
  its own tiny pool, `WHIM_LIMIT_PROBE_CONCURRENCY` (2), so probe traffic can never crowd the paid
  routes; like the other limits it is a default in `server/src/config.ts`, not a profile setting.

## Log retention on the VM

The privacy policy deletes connection data and logs within 90 days (the disclosure manifest's
`connection-logs` maximum). `compose.yaml` rotates the containers' json-file logs by size only, so
at low traffic lines holding IP addresses would stay for months. `deploy/vm/log-age-cap.sh` enforces
the age: `whim-log-age-cap.timer` runs it daily (catching up after downtime). Under
`/var/lib/docker/containers` it deletes rotated files (`*-json.log.N`) last written more than 89
days ago and removes older lines from the rest in place. It never edits a container's active
`*-json.log`: the Ops Agent tails it, and a file that shrinks is re-read from the start, which would
ship every kept line to Cloud Logging again (and could trip the log-based alerts). When an active log
holds a line older than 89 days, the script recreates that compose service instead
(`docker compose up -d --force-recreate --no-deps <service>` in `/opt/whim`): the new container
starts a new log, and Docker removes the old container's directory, logs included. That service is
down for a few seconds, and it only happens after 89 days without a deploy, since every deploy
recreates the containers. A log whose lines carry no readable time never causes a recreate; a
container with old lines that is no service of the `whim` project fails the run, naming it. 89 days
plus the one-day timer period stays within 90; the server acceptance suite fails if the cap outgrows
the manifest. `bootstrap.sh` installs it, so on a VM bootstrapped earlier, rerun `bootstrap.sh` to
add it. Check it with `sudo systemctl list-timers 'whim-log-age-cap*'` (next and last run) and
`sudo journalctl -u whim-log-age-cap.service` (what each run removed or recreated).

This covers only the log files on the VM. What reaches Cloud Logging is kept 30 days in the regional
`whim-logs` bucket (`provision.sh`).

## Minimum supported build

The server turns away any `/v1` request whose build is below its platform's minimum with
`426 update_required` ("Update Whim to the latest version to keep using its AI features."), before
any admission, ledger row or model call. It covers every `/v1` route. `/healthz` stays open and
reports the live values as `minBuild`. There is one value per platform, because a bug usually
belongs to one:

| Variable | Compared with |
|---|---|
| `WHIM_MIN_BUILD_IOS` | the iOS build number (`CFBundleVersion`) the app sends |
| `WHIM_MIN_BUILD_ANDROID` | the Android `versionCode` the app sends |

Both default to `0`, which serves every build. A value is `0` or a positive whole number with no
leading zero. `deploy/deploy.sh` refuses anything else before it builds or changes anything; the
server would refuse to boot on it.

**A legacy client is refused as soon as either minimum is above `0`.** A build from before the
client envelope (TestFlight build 381237, for one) sends no platform and no build number, so the
server counts it as build `0` on both platforms. Raising only the iOS minimum also turns away every
legacy Android install, and the other way round.

To raise or lower a minimum:

1. **Check the build the stores currently serve on that platform.** iOS: App Store Connect → Whim →
   TestFlight (and the App Store tab once the app is live), the newest build testers and users can
   install. Android: Play Console → Whim → Test and release → each track in use, its newest version
   code. Never set a minimum above that number: nobody on that platform could install a build that
   passes, and every AI feature would stay locked for all of them until the rollback below.
2. **Set the value** in `~/.config/whim/deploy.env`, for example `WHIM_MIN_BUILD_IOS=382000`.
3. **Deploy.** From the commit production runs, `deploy/deploy.sh` reuses that commit's image,
   writes the new value to `/etc/whim/config.env` and restarts the server through the drain.
   `deploy/deploy.sh --tag <that commit's sha>` does the same from any clean, pushed checkout.
4. **Confirm on `/healthz`.** The deploy's smoke fails unless `/healthz` reports exactly the values
   in your values file. To check by hand:

   ```sh
   curl -s https://api.whim.anycognition.ca/healthz
   # {"ok":true,"service":"whim-server","minBuild":{"ios":382000,"android":0}}
   ```

**Rollback:** set the value back (its previous number, or `0` or no line at all to switch that
platform's gate off), redeploy the same way, and confirm on `/healthz`. It takes effect on the next
request, with no app update involved.

## Capacity profiles, resizing, and the load test

Two committed profiles tie the VM's machine type to the server's concurrency limits (design.md D25):

| Key | `standard` | `event` |
|---|---|---|
| Machine type | `e2-standard-2` | `e2-standard-8` |
| Server memory / shm | 6g / 1gb | 16g / 3gb |
| Concurrent generations | 3 (default) | 15 |
| Synthetic-run contexts | 2 (default) | 6 |
| Concurrent unary calls | 16 (default) | 32 |

The `event` numbers are **estimates** pending task 15.4's recorded load test; treat them as
provisional until `progress.md`'s "Event profile load test" entry replaces this note.

**Demo-night checklist:** resize up the day of the event, run the load test once, resize back down
after.

```sh
deploy/resize.sh --profile event      # before the event
deploy/resize.sh --profile standard   # after
```

`resize.sh` checks the region's vCPU quota first (changing nothing if it doesn't fit), then drains
and stops the server, stops the VM, changes its machine type, starts it, waits up to 180 seconds
for an IAP SSH availability probe, confirms the type, and redeploys the running image tag (which
writes the matching profile and runs smoke). Only the harmless readiness probe repeats, every five
seconds; deployment runs once after readiness. A failed step after the drain starts the VM back up
on whatever type it has, waits for SSH again, redeploys that type's profile, and exits non-zero
naming the step — the service never sits on a half-applied resize.

**Load test** (`deploy/loadtest/run.sh`, no OpenRouter key reachable from its image — design.md D26):

```sh
deploy/loadtest/run.sh start                                        # swaps in the replay-model image
deploy/loadtest/run.sh drive --devices 15 --cap 15 --queue-max 50   # at capacity
deploy/loadtest/run.sh drive --devices 16 --cap 15 --queue-max 50   # one over: it waits in line, then completes
deploy/loadtest/run.sh stop                                         # restores production and runs smoke
```

`--queue-max` is the server's `WHIM_QUEUE_MAX`: `50` unless the operator values file sets it, since
the load-test server reads the same `config.env`. With `WHIM_QUEUE_MAX=0`, pass `--queue-max 0`, and
every device past the cap is refused.

`run.sh start` passes the replay image to the VM's compose command through one effective `sudo`
transition. If startup or its health check fails after production is stopped, it restores the base
compose service, runs production smoke, and returns the original failure. A restoration or smoke
failure is reported alongside that original failure; the load-test service is never left running.

`drive` prints a report: `timeToFirstEventMs`/`totalMs` as p50/p95 (a `queued` event counts as a
device's first event); `queued`, the devices that waited in line, and `waitMs`, their wait as
p50/p95/max; `terminals` (`result`/`failure`/`none` counts); `refusals` by `ApiError` code
(`server_busy` is expected only once `devices` exceeds `cap` + `queue-max`); `leakProbe.ok` (two
rounds of `cap` fresh devices that must each get a slot at once, proving no slot leaked and the line
is empty); and `peak.peakCpuPercent`/`peakMemoryPercent` from the VM's `docker stats` sampler. It
exits non-zero on any `failure` terminal (a device that waited past `WHIM_QUEUE_MAX_WAIT_MS` is one),
an unexpected refusal, a number of waiting devices other than the ones past the cap that fit in the
line, or a failed leak probe. Each device gets 300 seconds before the driver gives up on it: a run's
own 120 plus the default longest wait in line.

## Rolling back and rotating the key

```sh
deploy/deploy.sh --tag <40-hex sha>   # redeploys a known-good image; never builds
```

`--tag` touches the server image only — it builds and publishes no site, since republishing today's
checkout's pages (privacy's model-id copy, for one) alongside a rolled-back server would serve pages
that describe a server the rollback just replaced. Run `deploy/deploy.sh --site-only` separately if
the site also needs to move.

Roll back with the **current** checkout's `deploy/deploy.sh --tag <sha>`, never by checking out the
older commit and running its `deploy.sh`: an older `deploy/lib.sh` refuses any `deploy.env` line it
doesn't know (`unknown variable WHIM_MIN_BUILD_IOS`), even an empty one.

**Never `--tag` below the beta-1 server image once beta-1 builds are installed.** A server from
before beta-1 rejects the answers beta-1 sends with its clarify questions (it requires the old
`Clarification.answer`), so every rewrite and generation carrying an answer fails with
`400 invalid_request`. No later app build can change what an installed beta-1 build sends, and no
setting on the old image can accept it. To undo a bad server release, `--tag` an earlier image that
is still beta-1 or later (the `commit` its `/healthz` reported when it was live), or roll forward:
fix on `main` and run `deploy/deploy.sh` without `--tag`.

Rolling back to an image from before the commit report (developer-observability) leaves a server
whose `/healthz` has no `commit`: the rollback is live, but smoke fails on that check, so
`deploy.sh` exits 1 without `done`. Confirm the rest of the smoke output passed, then roll forward
as soon as you can.

Rolling back to an image from before the minimum-build gate drops the gate: that server answers
`/healthz` without `minBuild` and serves every build. Such an image also predates the commit
report, so smoke fails on `commit` as above whatever the minimums; with either minimum raised it
also fails because the server "cannot enforce the configured minimums". Roll forward to an image
with the gate as soon as you can.

**Rolling back the generation line** needs no older image. Set `WHIM_QUEUE_MAX=0` in
`~/.config/whim/deploy.env` and redeploy the running image with `deploy/deploy.sh --tag <sha>`, where
`<sha>` is the `commit` that `/healthz` reports. From then on a generation that finds every slot busy
gets `429 server_busy` before any stream opens, as it did before the line. The redeploy drains the
old server, so anyone still waiting in line gets the busy `failure` on their stream. To bring the line
back, remove the line (or set a positive number) and redeploy the same way.

Rotating the OpenRouter key: add a new version to `whim-openrouter-api-key` in Secret Manager, then
run `deploy/deploy.sh` (no `--tag`) so it re-reads the latest enabled version and recreates
`whim-server`. The old key can be disabled once the new one is confirmed live via smoke.

## Hardening facts worth knowing before you change the compose file

- `cap_drop: [ALL]` plus `cap_add: [SYS_CHROOT]` — measured, not assumed: Docker's seccomp profile
  allows `chroot` only with `CAP_SYS_CHROOT`, and Chromium's namespace sandbox chroots inside its
  own user namespace to boot at all. Dropping this one capability back in fails the boot self-test;
  everything else effective (`CapEff`/`CapPrm`/`CapAmb`) stays zero.
- `no-new-privileges:true` plus the vendored, digest-matched Chromium/Playwright seccomp profile —
  Never `--no-sandbox`.
- `read_only: true` with a `tmpfs` `/tmp` — the image writes nothing to its own layer at runtime.
- No published server port — Caddy is the only ingress, and it never buffers SSE
  (`flush_interval -1`) or serves a file on the API host.
- The container has no OpenRouter key of its own during a load test, and a `fetch` trap makes any
  missed override a loud failure rather than a silent one.
