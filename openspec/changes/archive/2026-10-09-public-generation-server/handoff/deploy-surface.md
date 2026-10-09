# deploy-surface (chain-12) — for chains 13, 14 and 16

## Scripts (run from a clean, pushed checkout on the operator's machine; bash 3.2-compatible)

| Command | Does |
|---|---|
| `deploy/provision.sh [--profile <name>]` | Idempotent GCP setup; VM on `standard`'s machine type unless `--profile`. Adopts the reserved address whose IP is `WHIM_STATIC_IP` (never creates one); creates secret `whim-openrouter-api-key` empty (never a version). Orchestrator-only. |
| `deploy/vm/bootstrap.sh --region <region>` | On the VM as root: Docker + compose plugin, AR credential helper, data disk, owned dirs, userns assertion, egress firewall. |
| `deploy/deploy.sh [--tag <40-hex sha>]` | Full deploy (below). No `--tag`: HEAD, Cloud Build unless the image exists. `--tag`: that image must exist; never builds (rollback, resize). |
| `deploy/deploy.sh --site-only` | Site + Caddyfile + Caddy only, then `smoke.sh --pages-only`. No secret, image, machine type or server touch. Rejects `--tag`. |
| `deploy/smoke.sh [--pages-only]` | Smoke checks (below). |
| `deploy/resize.sh --profile <name>` | Quota → drain → stop → set-machine-type → start → confirm → `deploy.sh --tag <running tag>`. |

There is no `--profile` on `deploy.sh`. Exit codes everywhere: `0` ok, `1` refusal/failure (one line per cause on
stderr, prefixed `<script>: `), `2` usage. Scripts never print a secret value.

**deploy.sh preflight, in order, before any build or VM change:** required values named one per line
(`missing required value <NAME>`), `WHIM_API_HOST == api.$WHIM_WEB_HOST`, model ids `^[A-Za-z0-9._:/-]+$`, Node major 22,
clean tree (untracked counts) and HEAD on a remote branch; then full deploys only: secret exists → has an enabled
version → non-empty/no whitespace (each message names `whim-openrouter-api-key` and `docs/deploy.md, section "OpenRouter
key"`), then the VM's machine type must match exactly one profile (else names the type); then the site build.
**Full deploy order:** image → upload → install compose/seccomp/config.env/.env + Caddyfile + site release → server.env
over stdin → `pull`, `up -d --wait --wait-timeout 1200`, `caddy reload` → `smoke.sh`. `up` uses `compose.yaml` alone, so
any override-created `whim-server` is recreated from production config.
**resize.sh recovery:** a failed drain/stop/set-machine-type/start/confirm starts the VM, redeploys `--tag <running tag>`
(profile follows the actual type) and exits 1 with `step <name> failed`. Quota shortfall exits 1 changing nothing.

## GCP names (deploy/lib.sh)

VM `whim-vm` (zone `WHIM_GCP_ZONE`, tag `whim-vm`, OS Login, IAP-only SSH), SA `whim-vm@<project>.iam.gserviceaccount.com`
(logging.logWriter, monitoring.metricWriter, artifactregistry.reader on repo `whim`; no Secret Manager), data disk
`whim-data` (device `/dev/disk/by-id/google-whim-data`), network `whim-net`/subnet `whim-subnet`, firewall
`whim-allow-web` (tcp:80,443, udp:443) and `whim-allow-iap-ssh` (tcp:22 from 35.235.240.0/20).
Image: `<WHIM_GCP_REGION>-docker.pkg.dev/<WHIM_GCP_PROJECT>/whim/server:<full sha>` (`deploy/cloudbuild.yaml`,
substitutions `COMMIT_SHA`, `_REGION`). Every remote command: `gcloud --project P compute ssh whim-vm --zone Z
--tunnel-through-iap`; compose as `sudo -H docker compose --project-directory /opt/whim --file /opt/whim/compose.yaml`.

## VM paths

| Path | Owner/mode | Holds |
|---|---|---|
| `/opt/whim/compose.yaml`, `/opt/whim/seccomp/chromium-playwright-<pw>.json` | root 0644 | from `deploy/` |
| `/opt/whim/Caddyfile` | root 0644 | rewritten in place (`cp`), because Caddy bind-mounts the file inode |
| `/opt/whim/.env` | root 0600 | compose `.env` (below) |
| `/opt/whim/loadtest/` | — | reserved for chain-16's `run.sh` upload; chain-12 never writes it |
| `/etc/whim/config.env`, `/etc/whim/server.env` | root 0600 | server env (below) |
| `/mnt/disks/whim-data/server/` | 10001:10001 0700 | `/data` in `whim-server` |
| `/mnt/disks/whim-data/caddy/` | root 0700 | Caddy `/data` (certificates) |
| `/mnt/disks/whim-data/site/releases/<UTC yyyymmddThhmmssZ>-<sha12>/` | root, a+rX | one published site (newest 5 kept) |
| `/mnt/disks/whim-data/site/current` | symlink → `releases/<id>` (relative) | swapped with `ln -sfn … current.next && mv -T` |
| `/mnt/disks/whim-data/loadtest/` | — | chain-16's data dir; not created by bootstrap (no `loadtest` string in chain-12 files) |

## Env files and variables

- `deploy/defaults.env` (committed): `WHIM_GCP_PROJECT`, `WHIM_GCP_REGION`, `WHIM_GCP_ZONE`, `WHIM_STATIC_IP`,
  `WHIM_API_HOST`, `WHIM_WEB_HOST`.
- `~/.config/whim/deploy.env` (operator; names in `deploy/operator.env.example`): `WHIM_SUPPORT_EMAIL`,
  `WHIM_ENGINEER_MODEL`, `WHIM_REWRITE_MODEL` (required, no default), `WHIM_APP_STORE_URL`, `WHIM_PLAY_STORE_URL`.
- Load order: defaults.env → operator file → process environment (later wins). Lines are literal `NAME=value`, no
  quoting or expansion; any other name in either file is refused.
- compose `.env`: `WHIM_IMAGE`, `WHIM_API_HOST`, `WHIM_WEB_HOST`, `WHIM_PROFILE`, `WHIM_SERVER_MEM_LIMIT`,
  `WHIM_SERVER_SHM_SIZE`. `compose.yaml` interpolates only these, each as `${NAME:?}`.
- `/etc/whim/config.env`: the profile's server keys, then `WHIM_ENGINEER_MODEL`, `WHIM_REWRITE_MODEL`.
- `/etc/whim/server.env`: `OPENROUTER_API_KEY` only. The image sets `NODE_ENV=production`, `HOME=/tmp`.

## Profiles (`deploy/profiles/<name>.env`)

Format: literal `NAME=value` lines. Required: `WHIM_PROFILE_MACHINE_TYPE`, `WHIM_SERVER_MEM_LIMIT`,
`WHIM_SERVER_SHM_SIZE`; any other key must be a variable `loadServerConfig` reads and never `WHIM_LIMIT_*`, `*RETENTION*`,
`NODE_ENV`, `WHIM_PIPELINE`, `WHIM_DEV_LOG_SINK` or secret-named. `standard` = e2-standard-2/6g/1gb, no server key;
`event` = e2-standard-8/16g/3gb + `WHIM_MAX_CONCURRENT_GENERATIONS=15`, `WHIM_SYNTHRUN_CONCURRENCY=6`,
`WHIM_MAX_CONCURRENT_UNARY=32`. Selection: the one profile whose machine type equals the VM's; none or two → refuse.

## Compose (`deploy/compose.yaml`, project `name: whim`)

- Services: `whim-server`, `caddy`. Network key `whim` (bridge, subnet `172.31.250.0/24`; docker name `whim_whim`).
- `whim-server`: `image ${WHIM_IMAGE:?}`; `env_file` config.env then server.env; `WHIM_DATA_DIR=/data`; `init`;
  `user 10001:10001`; `read_only`; tmpfs `/tmp:size=512m`; `shm_size`/`mem_limit` from `.env`; `pids_limit 1024`;
  `cap_drop [ALL]`; `cap_add [SYS_CHROOT]`; `security_opt` exactly `no-new-privileges:true` +
  `seccomp=/opt/whim/seccomp/chromium-playwright-<pw>.json`; `restart unless-stopped`; `stop_grace_period 11m`;
  no `ports`; healthcheck `node -e fetch('http://127.0.0.1:8787/healthz')`.
- `caddy`: `caddy:2.11.4@sha256:13ba145c…`; ports 80, 443, 443/udp; mounts Caddyfile ro, `…/caddy:/data`,
  `…/site:/srv/site:ro`; env `WHIM_API_HOST`, `WHIM_WEB_HOST`.
- An override (chain-16) must keep `cap_add`/`security_opt` identical: Chromium's sandbox needs both.
- Root `.dockerignore` excludes `deploy/` and every `*.env`; another image needs its own context or
  `<Dockerfile>.dockerignore`.

## Hostname rule

Hostnames exist only as values (`deploy/defaults.env`, overridable). No file under `server/src/` contains
`anycognition.ca` or `sslip.io`; no deploy file contains `sslip.io`; no deploy file except `deploy/defaults.env` and
`deploy/site/**` contains `anycognition.ca`. Break-glass sslip.io hosts are set only through the environment.
`deploy/Dockerfile`, `cloudbuild.yaml`, `compose.yaml`, `deploy.sh`, `resize.sh` never contain `loadtest` (any case).

## Smoke checks (`deploy/smoke.sh`), in order

1. DNS for `WHIM_API_HOST` and `WHIM_WEB_HOST` (`dig +short A/AAAA`): A set must equal exactly `WHIM_STATIC_IP`, no AAAA.
   On failure prints `FAIL  dns <host>: …`, then exits 1 with `DNS is not ready, so no HTTPS request was made…`.
2. Full mode only: `GET https://$WHIM_API_HOST/healthz` → `200` and body byte-equal to
   `{"ok":true,"service":"whim-server"}`; `POST /v1/generate` without device header → `400`; `/healthz/sse` → 3
   comment frames spanning ≥ 1.5 s; in `whim-server`, a fetch to `169.254.169.254` must fail (`blocked`);
   `/app/node_modules/react-native` must be absent.
3. Pages: `/privacy`, `/support`, `/a/x` → `200` `text/html`, no `Location`; `/nope` → `404` `text/html`, no `Location`.
4. For each `.well-known/{apple-app-site-association,assetlinks.json}`: if `site/current/.well-known/<f>` exists on the
   VM → `200`, `application/json`, no redirect, bytes equal to that file; else `404`.

Needs `dig`, `curl` and (full mode) `node` locally. Every failed check prints `FAIL  …` to stderr; exit 1 at the end.
