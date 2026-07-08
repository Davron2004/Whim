# Fix-loop dev container

Runs the Whim parallel fix loop (`/fix-loop`) inside a Docker container whose
**network egress is locked to Anthropic only**. The container is the loop's
Threat-C boundary — see `docs/archive/parallel-fix-loop.md` §6.7.

## Why this exists

Background / auto-mode Claude Code sessions show **no permission prompts**, so
the loop runs de-facto unattended. On the host, Threat C (arbitrary execution /
exfil) leaned on the macOS Seatbelt sandbox — but Chromium can't run under
Seatbelt, so the three Chromium suites and `fixloop.sh` ran via `excludedCommands`
*outside* the sandbox. That boundary was Swiss cheese.

This container replaces Seatbelt with a single clean boundary: **default-deny
egress, Anthropic allowlisted.** Chromium running freely inside no longer matters
— there is nowhere to exfil to. Threats A (hooks) and B (integrity / redcheck /
fresh-gate / reviewer) are unchanged; they run inside exactly as on the host.

| Layer | Host (macOS) | Container |
|-------|--------------|-----------|
| A — honest mistakes | hooks | **same hooks** |
| B — reward-hacking | integrity / redcheck / fresh-gate / reviewer | **same** |
| C — exec / exfil | Seatbelt + `excludedCommands` holes | **egress firewall (Anthropic only)** |

With the OS sandbox off inside (managed settings, baked into the image — the
host's `.claude/settings.json` stays `sandbox:true` and untouched), `git worktree
add` writing `.claude/` just works: the `dangerouslyDisableSandbox` override dance
that the no-prompt finding exposed as illusory is **gone**.

## What's in the image

Node 22 · the repo's `node_modules` (incl. workspaces `contract`, `server`) ·
Playwright Chromium (in `/ms-playwright`, outside `node_modules`) · `git` · the
Claude Code CLI. **No** Android SDK / JDK / emulator — the loop never builds the
device app. `openspec` and `playwright` come from `node_modules` (both are repo
devDependencies); nothing is globally installed beyond the Claude CLI.

## Two ways to run

### Interactive (attended) — VS Code / `devcontainer` CLI

Open the repo in the dev container (VS Code "Reopen in Container", or
`devcontainer up --workspace-folder .`). On first create it runs `npm ci` +
`npx playwright install chromium` (full network), then locks the firewall.
Permission prompts **still fire** — you're attended. Authenticate with `/login`
(uses your Claude Pro/Max **subscription** — no per-token API billing), then run
`/fix-loop <findings>`.

### Unattended (headless) — `run-loop.sh`

**Auth is a once-a-year manual step.** The token is long-lived (~1 year); you mint
it by hand on the host and drop it in a file. The run script only reads + validates
it — no minting automation.

```sh
# ONE-TIME (and once a year after): mint a subscription OAuth token on the HOST.
# Uses your Claude Pro/Max subscription, NOT the pay-per-token API.
claude setup-token
#   → setup-token prints a BANNER around the token. Copy ONLY the sk-ant-oat01-...
#     value. (Do NOT do `$(claude setup-token)` — capturing the banner produces an
#     "invalid Bearer header" error.)

# Put it in the token file. Line 1 = token; line 2 = expiry date (mint date + 1yr),
# which lets `run` fail fast once it's stale.
mkdir -p ~/.config/whim
cat > ~/.config/whim/oauth-token <<'EOF'
sk-ant-oat01-PASTE_THE_TOKEN_HERE
2027-06-30
EOF
chmod 600 ~/.config/whim/oauth-token

# once: build image + hydrate the node_modules volume (needs network)
.devcontainer/run-loop.sh setup

# each run: subscription auth, node_modules read-only, egress firewalled, no prompts
.devcontainer/run-loop.sh run '/fix-loop openspec/critic/2026-06-18-triage.md'
```

`run` reads `~/.config/whim/oauth-token` (override with `WHIM_OAUTH_TOKEN_FILE`),
**rejects** a line-1 value that doesn't start with `sk-ant-oat` (catches the
banner-capture mistake), **rejects** an expired token if line 2's date has passed,
forwards **only** that token, and warns + refuses to forward `ANTHROPIC_API_KEY` if
it's set. It mounts `node_modules` **read-only** (replacing the host's old
`denyWrite:["./node_modules"]` rule — the one node_modules-poison guard lost when
the sandbox goes off) and passes `--dangerously-skip-permissions`. That flag is
safe *here* only because the container bounds Threat C; never use it on the host.

### Rotating the token (once a year, or after a leak)

1. Try to revoke the old token (best-effort — see below).
2. `claude setup-token` on the host → copy the new `sk-ant-oat01-...` value.
3. Overwrite line 1 of `~/.config/whim/oauth-token` with the new token and line 2
   with the new expiry date (today + ~1 year). Keep it `chmod 600`.

### Revoking a token (best-effort — no clean self-serve path today)

`claude setup-token` is mint-only: there is no `--revoke`/`--list`, no confirmed
console page that lists `sk-ant-oat01-...` tokens, and a known issue
(anthropics/claude-code#43801) reports these tokens can survive "log out all
sessions." So treat revocation as best-effort:

1. claude.ai → **Settings → Account → Log out all sessions** (terminates sessions).
2. **Verify it took**: outside the container, run `CLAUDE_CODE_OAUTH_TOKEN=<old> claude -p hi`.
   If it still answers, the token was NOT revoked.
3. If it survives and you need it dead now, contact Anthropic support
   (support.claude.com) and request revocation of that specific token.
4. Regardless, mint a fresh token and rotate (above). Worst case the leaked one
   expires on its own (~1 year) — don't rely on that if it truly leaked.

## Monitoring a run

`run` streams to `.claude/fixloop/run-<timestamp>.log` (gitignored) and tees it to
your terminal. The container's `claude -p` runs with `--verbose --output-format
stream-json`, so the log is a live JSONL event stream — every tool call and message
as it happens, not just a final dump.

Watch the latest run from another terminal:

```sh
LOG="$(ls -t .claude/fixloop/run-*.log | head -1)"
tail -f "$LOG"                                   # raw JSONL

# readable: assistant text + each tool call + the final result
tail -f "$LOG" | jq -rc '
  if .type=="assistant" then (.message.content[]?
       | if .type=="text" then .text
         elif .type=="tool_use" then "→ "+.name
         else empty end)
  elif .type=="result" then "RESULT: "+(.result // .subtype)
  else empty end'
```

The other live signal needs no log at all — because the repo is bind-mounted, the
loop's git state updates on the host in real time:

```sh
watch -n2 'git worktree list; echo; git log --oneline -8 dev/v1; \
  echo; git branch --list "wip/*"; ls -1 .claude/fixloop/*.log 2>/dev/null'
```

Worktree appears → a fixer is working it; new `fix:` commit on `dev/v1` → merged;
`wip/<id>` branch + a note in `.claude/fixloop/` → parked (the note says why).

## Known limitations

- **No literal domain wildcard.** iptables/ipset filter by IP, not hostname, so
  `*.anthropic.com` can't be matched by name. `init-firewall.sh` resolves
  api/console.anthropic.com and allows the containing **/24** (Anthropic's own
  registered block — not a shared CDN), which covers all `*.anthropic.com`
  endpoints on that block and absorbs IP rotation within it. If Anthropic ever
  serves from a different /24, add the host (or its block) to the script and
  re-run. `statsig.anthropic.com` is omitted (NXDOMAIN; Claude Code runs without
  feature flags).
- **Repo is bind-mounted RW**, so a container escape could touch host `.git` /
  `.claude` — same exposure as running the loop on the host today, now *plus*
  network isolation. (The stronger clone-into-container variant was deferred.)
- **node_modules volume is shared** across runs. `npm install` is hook-denied and
  the volume is `:ro` during `run`, so it can't be poisoned mid-loop; rebuild it
  with `run-loop.sh setup` if a dependency genuinely changes.
