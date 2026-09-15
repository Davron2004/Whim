# Deploying the public server

A runbook for operating `api.whim.anycognition.ca` and `whim.anycognition.ca` (design.md D6, D17,
D19–D26). Every command below is run from a clean, pushed checkout unless it says otherwise.

## 1. One-time provisioning (orchestrator, `gcloud` auth as the project owner)

```sh
deploy/provision.sh                    # VM on the standard profile
deploy/provision.sh --profile event    # or straight onto the event machine type
```

Idempotent: creates the Artifact Registry repo, a minimal service account, the VM with its
persistent disk, firewall rules (80, 443/tcp+udp, IAP-only SSH), and the **empty** Secret Manager
secret `whim-openrouter-api-key`. It adopts the reserved static IP whose value is `WHIM_STATIC_IP`
and fails if none exists — it never creates one, because a wrong address would move DNS. It never
adds a secret version; see "OpenRouter key" below.

Then bootstrap the VM itself:

```sh
gcloud compute scp --tunnel-through-iap --recurse deploy/vm whim-vm:/tmp/whim-vm
gcloud compute ssh whim-vm --tunnel-through-iap \
  --command 'sudo bash /tmp/whim-vm/bootstrap.sh --region northamerica-northeast1'
```

`bootstrap.sh` installs Docker + the compose plugin, formats and mounts the data disk at
`/mnt/disks/whim-data`, creates the owned data directories, asserts unprivileged user namespaces
work (Chromium's sandbox needs them), and installs the egress firewall. Safe to rerun.

### Persistent-disk snapshots

Not automated by any script here — schedule it once, outside this repo:

```sh
gcloud compute resource-policies create snapshot-schedule whim-data-daily \
  --region "$WHIM_GCP_REGION" --daily-schedule --start-time 07:00 --max-retention-days 14
gcloud compute disks add-resource-policies whim-data \
  --zone "$WHIM_GCP_ZONE" --resource-policies whim-data-daily
```

The disk holds the usage ledger, reports and the published site — the only durable state.

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
| `WHIM_ENGINEER_MODEL`, `WHIM_REWRITE_MODEL` | yes | the model pair the server and the pages both use |
| `WHIM_APP_STORE_URL`, `WHIM_PLAY_STORE_URL` | no | the app-link fallback page's store-links block, dropped when both are unset |

Loaded after the committed `deploy/defaults.env` and before the process environment (later wins).

## First deploy

```sh
deploy/deploy.sh --site-only   # once DNS resolves — publishes the pages, builds/reads no image or secret
deploy/deploy.sh               # once the OpenRouter secret has a version — the full deploy
```

`--site-only` publishes `/privacy`, `/support`, `/a/*`, uploads the Caddyfile and reloads Caddy; it
never touches the server container. The full deploy builds the image via Cloud Build (unless
`--tag` names one that already exists), uploads compose/seccomp/config, writes the secret into
`/etc/whim/server.env`, recreates `whim-server`, and runs smoke.

## Verifying (smoke)

`deploy/smoke.sh` runs at the end of every deploy; run it standalone any time:

```sh
deploy/smoke.sh               # full: DNS, API, server container, pages, association files
deploy/smoke.sh --pages-only  # DNS + pages only
```

What each check means:

- **DNS** — both hostnames resolve to `WHIM_STATIC_IP` only, no `AAAA`.
- **`/healthz`** — `200` with body byte-equal to `{"ok":true,"service":"whim-server"}`: the boot
  self-test (a real generation through the sandbox) passed, and this isn't a stray load-test
  container (its `/healthz` would name `whim-server-loadtest`).
- **`/v1/generate` without a device header → `400`** — the identity gate is live.
- **`/healthz/sse` frame spacing** — the proxy isn't buffering the stream.
- **metadata-server fetch blocked from inside the container** — the synthetic run's egress lock is
  still on in production, not just in dev.
- **no `react-native` under the image's `node_modules`** — the production tree never carries the
  device bundle.
- **`/privacy`, `/support`, `/a/x` → `200` html, `/nope` → `404`, neither redirected** — the pages
  host serves flat files with no directory-index redirect (a redirect would break the association
  files below).
- **each `.well-known` path** — `200` + `application/json` + no redirect + bytes equal to the
  published file, or `404` when the site shipped none (see the go-live order next).

## The pages host and going live with association files

`whim.anycognition.ca` is a second site on the same Caddy (design.md D21). Before any of the steps
below matter, the app side must already point at this domain: `WHIM_DOMAIN` in
`release/whim-release.xcconfig` and `src/host/launcher/release-config.ts` must both be
`anycognition.ca` (platform-release-readiness's precondition, held by its own lockstep suite).

1. The first server deploy publishes `/privacy`, `/support` and `/a/*`. Both `.well-known` paths
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

- **Logs** — `docker compose -f /opt/whim/compose.yaml logs -f whim-server` (structured JSON via
  `pino`; no request content, ever).
- **Reports** — `docker compose exec whim-server node server/whim-admin.mjs reports list [--since N] [--limit N] [--json]`,
  `reports show <id> [--json]`, `reports purge`.
- **Usage and cost** — `docker compose exec whim-server node server/whim-admin.mjs usage [--days N] [--top N] [--json]`
  — cost per generation, per device and per day, from the ledger.
- **Tuning limits** — a capacity profile (below) is the only deploy-time lever, and it never carries
  a daily limit, a retention period or `NODE_ENV` by construction. Changing a daily/global limit
  (design.md D6's table) means editing its default in `server/src/config.ts` and deploying that
  commit — a code change, not a runtime flag, so it goes through the same review as anything else.
  Two global daily ceilings, not the per-device limits, are what actually bound a day's spend — a
  client can mint a fresh device id per request: `WHIM_LIMIT_GENERATIONS_PER_DAY` (400) for
  `/v1/generate`, and `WHIM_LIMIT_UNARY_PER_DAY` (2000) for `/v1/clarify` and `/v1/rewrite`
  together — one ceiling counted across both, not one each. Past either, that route answers
  `429 server_busy` with `Retry-After` set to the next UTC midnight.

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
and stops the server, stops the VM, changes its machine type, starts it, confirms the type, and
redeploys the running image tag (which writes the matching profile and runs smoke). A failed step
after the drain starts the VM back up on whatever type it has, redeploys that type's profile, and
exits non-zero naming the step — the service never sits on a half-applied resize.

**Load test** (`deploy/loadtest/run.sh`, no OpenRouter key reachable from its image — design.md D26):

```sh
deploy/loadtest/run.sh start                              # swaps in the replay-model image
deploy/loadtest/run.sh drive --devices 15 --cap 15         # at capacity
deploy/loadtest/run.sh drive --devices 16 --cap 15         # one over, expect one refusal
deploy/loadtest/run.sh stop                                # restores production and runs smoke
```

`drive` prints a report: `timeToFirstEventMs`/`totalMs` as p50/p95; `terminals` (`result`/`failure`/
`none` counts); `refusals` by `ApiError` code (`server_busy` is expected once `devices` exceeds
`cap`, not otherwise); `leakProbe.ok` (two rounds of fresh devices proving no slot leaked); and
`peak.peakCpuPercent`/`peakMemoryPercent` from the VM's `docker stats` sampler. It exits non-zero on
any `failure` terminal, an unexpected refusal, or a failed leak probe.

## Rolling back and rotating the key

```sh
deploy/deploy.sh --tag <40-hex sha>   # redeploys a known-good image; never builds
```

`--tag` touches the server image only — it builds and publishes no site, since republishing today's
checkout's pages (privacy's model-id copy, for one) alongside a rolled-back server would serve pages
that describe a server the rollback just replaced. Run `deploy/deploy.sh --site-only` separately if
the site also needs to move.

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
