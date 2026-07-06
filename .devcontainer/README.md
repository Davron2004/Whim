# Fix-loop dev container

Runs the Whim parallel fix loop (`/fix-loop`) inside a Docker container whose
**network egress is locked to Anthropic only**. The container is the loop's
Threat-C boundary — see `docs/parallel-fix-loop.md` §6.7.

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

```sh
# once on the HOST: mint a subscription OAuth token (needs Claude Pro/Max).
# This uses your subscription — NOT the pay-per-token API. Do NOT set
# ANTHROPIC_API_KEY; it would outrank the token and bill the API.
export CLAUDE_CODE_OAUTH_TOKEN="$(claude setup-token)"   # or paste a saved token

# once: build image + hydrate the node_modules volume (needs network)
.devcontainer/run-loop.sh setup

# each run: subscription auth, node_modules read-only, egress firewalled, no prompts
.devcontainer/run-loop.sh run '/fix-loop openspec/critic/2026-06-18-triage.md'
```

`run` forwards **only** `CLAUDE_CODE_OAUTH_TOKEN` (and warns if it sees
`ANTHROPIC_API_KEY` in your shell, which it refuses to forward). It mounts
`node_modules` **read-only** (replacing the host's old
`denyWrite:["./node_modules"]` rule — the one node_modules-poison guard lost when
the sandbox goes off) and passes `--dangerously-skip-permissions`. That flag is
safe *here* only because the container bounds Threat C; never use it on the host.

## Known limitations

- **Anthropic IPs rotate behind a CDN.** `init-firewall.sh` resolves + pins them
  at start; a multi-hour run could see the set go stale (Anthropic calls start
  failing). Re-run the script to refresh. Fine for the minutes-to-an-hour the
  loop normally takes.
- **Repo is bind-mounted RW**, so a container escape could touch host `.git` /
  `.claude` — same exposure as running the loop on the host today, now *plus*
  network isolation. (The stronger clone-into-container variant was deferred.)
- **node_modules volume is shared** across runs. `npm install` is hook-denied and
  the volume is `:ro` during `run`, so it can't be poisoned mid-loop; rebuild it
  with `run-loop.sh setup` if a dependency genuinely changes.
