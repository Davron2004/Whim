# log-shipping (chain-0 result for task 1.1, design D8)

**Chosen path:** the Ops Agent on the VM host, tailing Docker's json-file logs (`json-file` and `docker compose logs`
unchanged). Ops Agent 2.71.0 (fluent-bit 4.2.1), Docker 29.8.0, Debian 12. **gcplogs rejected:** on the same VM its
pino line arrived as one escaped string in `jsonPayload.message` with no severity, as D8 assumed.

## Agent config, verbatim (`/etc/google-cloud-ops-agent/config.yaml`, live, sha256 c9482216...)
```yaml
# Whim: ship Docker json-file container logs to Cloud Logging (developer-observability, design D8).
logging:
  receivers:
    docker:
      type: files
      include_paths: [/var/lib/docker/containers/*/*-json.log]
      record_log_file_path: true
      wildcard_refresh_interval: 10s
  processors:
    docker_envelope:
      type: parse_json
      time_key: time
      time_format: "%Y-%m-%dT%H:%M:%S.%L%z"
    level_text:
      type: parse_regex
      field: log
      regex: '^(?<log>\{.*?"(?:level|severity)":"?(?<level_text>[A-Za-z0-9]+)"?[,}].*)$'
    app_json:
      type: parse_json
      field: log
    severity_and_labels:
      type: modify_fields
      fields:
        severity:
          move_from: jsonPayload.level_text
          map_values_exclusive: true
          map_values: {"10": DEBUG, "20": DEBUG, "30": INFO, "40": WARNING, "50": ERROR, "60": CRITICAL,
            debug: DEBUG, info: INFO, warn: WARNING, error: ERROR, dpanic: CRITICAL, panic: CRITICAL,
            fatal: CRITICAL, DEBUG: DEBUG, INFO: INFO, NOTICE: NOTICE, WARNING: WARNING, ERROR: ERROR,
            CRITICAL: CRITICAL, ALERT: ALERT, EMERGENCY: EMERGENCY}
        labels.compose_service:
          copy_from: jsonPayload.attrs."com.docker.compose.service"
        labels.stream:
          copy_from: jsonPayload.stream
        jsonPayload.attrs:
          move_from: jsonPayload.attrs
          omit_if: 'jsonPayload.attrs."com.docker.compose.service" =~ "."'
  service:
    pipelines:
      default_pipeline: {receivers: []}
      docker:
        receivers: [docker]
        processors: [docker_envelope, level_text, app_json, severity_and_labels]
metrics:
  service:
    pipelines:
      default_pipeline: {receivers: []}
```
Load-bearing (each replaced a version that failed on the VM): `map_values` compiles to Lua `v == "30"`, which never
matches pino's number 30, so `level_text` captures the level as a string (regex captures always are; ops-agent's
`types` cast isn't user-exposed). `move_from` of a missing source and a matching `omit_if` both write nil over the
destination, so chained processors can't do "prefer severity, else level", and labels use `copy_from` (a
`move_from` wrote `attrs: {}` into every entry). `stream` is dropped after the parse, hence `labels.stream`. Both
default pipelines (built-in syslog, host metrics) are off (owner call 2026-09-24: host metrics stay off).

## Install step for `deploy/vm/bootstrap.sh` (rerun-safe; chain-1 commits it)
```sh
readonly OPS_AGENT_KEY_FINGERPRINT=35BAA0B33E9EB396F59CA838C0BA5CE6DC6315A3  # gpgv-verified signer of both suites
curl -fsSL --proto '=https' --proto-redir '=https' https://packages.cloud.google.com/apt/doc/apt-key.gpg \
  -o /etc/apt/keyrings/google-cloud-ops-agent.asc                           # ASCII-armored
fingerprint="$(gpg --show-keys --with-colons /etc/apt/keyrings/google-cloud-ops-agent.asc | awk -F: '$1 == "fpr" { print $10; exit }')"
[ "$fingerprint" = "$OPS_AGENT_KEY_FINGERPRINT" ] || fail "Ops Agent apt key has fingerprint '$fingerprint'"
chmod a+r /etc/apt/keyrings/google-cloud-ops-agent.asc
printf 'deb [signed-by=/etc/apt/keyrings/google-cloud-ops-agent.asc] https://packages.cloud.google.com/apt google-cloud-ops-agent-%s-2 main\n' \
  "$codename" >/etc/apt/sources.list.d/google-cloud-ops-agent.list
apt-get update
apt-get install -y google-cloud-ops-agent
install -m 0644 "$repo_copy_of_config" /etc/google-cloud-ops-agent/config.yaml
systemctl enable google-cloud-ops-agent
systemctl restart google-cloud-ops-agent   # the agent only: never dockerd or the containers
```
`-2` pins major 2. Google's script wrote this `.list` path (suite `-all`, no `signed-by`, trusted only via the GCE
image's `trusted.gpg.d` keyring), so overwriting it migrates tonight's install. Write the config in the same step as
the install: until it lands, a fresh install runs the default config, which shipped ~1 min of `/var/log/syslog` on
2026-09-24 (that log was deleted). Check with `systemctl is-active google-cloud-ops-agent-fluent-bit` and
`[API Check] Result: PASS` in `/var/log/google-cloud-ops-agent/health-checks.log`; config errors go to
`journalctl -u google-cloud-ops-agent`.

## compose.yaml (the service label; chain-1; owner call 2026-09-24: yes)
Add `labels: com.docker.compose.service` to `logging.options` of both services. Docker then writes
`"attrs":{"com.docker.compose.service":"whim-server"}` into each envelope, and the config turns that into
`labels.compose_service` and drops `attrs`. Verified with a throwaway container, not on the live pair. `deploy.sh`
runs `compose up -d` for caddy, so the change recreates Caddy once on the next deploy.

## Querying (Logs Explorer)
- `logName="projects/anycognition-whim/logs/docker"` (the receiver id), resource `gce_instance`. `severity>=WARNING`.
- pino fields keep native types: `jsonPayload.msg="request"`, `jsonPayload.requestId="..."`, `jsonPayload.status=400`,
  `jsonPayload.level=50`. Caddy has `jsonPayload.logger`, `jsonPayload.ts` and a string `level`.
- Server vs Caddy: `labels.compose_service="whim-server"` or `="caddy"` once the compose change ships; until then
  `jsonPayload.pid:*` (pino) vs `jsonPayload.ts:*` (Caddy), or the `agent.googleapis.com/log_file_path` label (id changes per deploy).
- `labels.stream="stdout"|"stderr"`. A non-JSON line (crash trace) is a string `jsonPayload.log` with no severity.
- `timestamp` is the Docker envelope time (ns); pino's epoch-ms `time` stays in `jsonPayload.time`. Latency 1-4 s.

## Once pino emits `severity`
No config change. If the formatter keeps numeric `level` first (pino's default position), severity comes from
`level`; if it replaces `level`, the regex takes `severity`. Both tested: `{level:40,severity:"WARNING"}` gave
WARNING and `{severity:"ERROR"}` gave ERROR. Two constraints: the first `"level":`/`"severity":` in the line
wins, so keep one of them as the first key (pino and Caddy both put `level` first today). And the values must
be Cloud Logging names (DEBUG, INFO, NOTICE, WARNING, ERROR, CRITICAL, ALERT, EMERGENCY); anything else maps to DEFAULT.

## Limits
json-file splits any line over 16 KiB into several envelope records; each piece lands as an unparsed
`jsonPayload.log` and only the first gets a severity (#83). A fresh install backfills each container's current
`*-json.log` (`Read_from_Head`); offsets survive restarts. Disk buffer `/var/lib/google-cloud-ops-agent`, capped at
2G. Every container on the host ships. Local json-file copies rotate by size, not age (#85).

## Verification (production VM, 2026-09-24)
All pass. A real `/v1/generate` 400 line arrived with `requestId`/`status`/`path` as typed fields. Severity mapped
for 20-60 and for Caddy `warn`, and Caddy lines arrived. Egress unchanged: the server container still gets
`BLOCKED UND_ERR_CONNECT_TIMEOUT` for the metadata server, WHIM-EGRESS untouched. `deploy/smoke.sh`: all checks
passed. `docker compose logs` works. Footprint: fluent-bit ~31 MiB, otel collector ~39 MiB, ~0.5% CPU each.
