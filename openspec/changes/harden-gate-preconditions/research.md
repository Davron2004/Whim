# Probe: why does `gatefull` run sandboxed? (2026-07-26)

Root-cause probe run before drafting `harden-gate-preconditions`. Purpose: confirm or refute the
hypothesis that `sandbox.excludedCommands` failed to match the invocation *form*
(`./` prefix / env-var assignment prefix / `cd` compound).

**Verdict: hypothesis REFUTED. `sandbox.excludedCommands` is inert — no entry takes effect.**

## Fixture

Branch `probe/sandbox-carveout` at `cccbf45` (pre-merge `main`), with the primary tree on `main`
at `c8da79f`. Checking the fixture out changes **9** protected files, so it reproduces exactly the
condition that triggers the bug. Deleted after the probe; no residue in `.git/config`.

Discriminator: `gatefull` pins `GATE_BASE` to the merge-base and `gate.sh` then diffs the WORKING
TREE against it. A fully-applied checkout ⇒ tree == base ⇒ tripwire silent. A half-applied
checkout ⇒ the unwritten files differ ⇒ tripwire fires and names them.

## Runs

| # | Command (all sandboxed — no `dangerouslyDisableSandbox`) | Result |
|---|---|---|
| A | `cd <root>; ./scripts/fixloop.sh gatefull probe/sandbox-carveout` | tripwire fired — 6 `.claude/**` files stranded |
| B | `cd <root>; scripts/fixloop.sh gatefull probe/sandbox-carveout` | identical |
| C | `scripts/fixloop.sh gatefull probe/sandbox-carveout` (no `cd`; string starts with the exact list entry) | identical |
| D | `gh pr view 6 --json number,state` (matches the `"gh "` entry) | network blocked: `tls: failed to verify certificate: x509: OSStatus -26276` |

Runs A–C: invocation form is NOT the variable. Run D is decisive — a second, independent command
family that also matches the list is likewise not exempted, and the failure is network rather than
filesystem, so it cannot be explained by any `.claude/**`-specific rule.

All of these succeed when the tool call sets `dangerouslyDisableSandbox: true`, so the commands
themselves are fine. Only the declared exclusion fails to apply.

## Ruled out

- `.claude/settings.local.json` — contains only `permissions.allow` + `outputStyle`, no `sandbox` key.
- `/Library/Application Support/ClaudeCode/managed-settings.json` — does not exist.
- Wrong key path — the list is at `sandbox.excludedCommands`, and `scripts/fixloop.sh` is in it.

## Observed sandbox behaviour (empirical, independent of cause)

- Writes under `<repo>/.claude/**` are denied; writes under `<repo>/scripts/**` succeed.
- `<repo>/.git/config` writes are denied too — `git branch -D` prints
  `could not lock config file .git/config` / `warning: update of config-file failed`,
  then reports `Deleted branch` and **exits 0**. The ref is deleted; the config section survives.
- Network egress is blocked (`allowedHosts: []`).

## Why this matters beyond `gatefull`

`CLAUDE.md` states the three Chromium-dependent commands "are carved out of the host sandbox via
`excludedCommands`", and that claim is the stated justification for routing unattended runs through
the devcontainer. If the list is inert, that carve-out has never worked: every green gate-full has
depended on an explicit override or the container. A document asserting a mechanism works when it
does not is worse than no document, because downstream decisions are built on it.

## The recurring defect class (6 instances)

Every one is the harness acting on an assumption it could have checked in one line, and in four of
them a **partial success was reported as success**:

1. `gatefull`'s `git checkout --detach` half-applies, exits 0 → gate reports it as *tamper*.
2. `gatefull` without `FIXLOOP_INTEGRATION_BRANCH` merge-bases against `main` → wrong baseline,
   confident wrong verdict.
3. Round 1: `gatefull` orphaned a commit made in the tree it detached, via its forced restore.
4. Previous run left an un-torn-down grant + owners marker; the next lane refused to start.
5. `git-cleanup-check.sh` prints an apply command (`git checkout <TARGET> && git reset --hard …`)
   that cannot work when TARGET is checked out in a run worktree — i.e. always, under the staging lane.
6. `git branch -D` exits 0 after failing to update `.git/config`, leaving a stale section.

Also observed: `fixloop.sh` sends the checkout's stderr to `/dev/null`, discarding the ONE signal
that would have diagnosed #1 immediately. And its `FAILED TO RESTORE` message fires even when the
tree did restore correctly — a false alarm that trains people to ignore a genuinely serious warning.

## Documentation check (claude-code-guide, 2026-07-26)

Separating stated fact from inference, because this question has already produced one wrong answer:

- **DOCUMENTED.** `sandbox.excludedCommands` is a real, currently-supported key
  (https://code.claude.com/docs/en/sandboxing.md).
- **DOCUMENTED.** "The sandbox automatically denies write access to Claude Code's `settings.json`
  files at every scope and to the managed settings directory, so a sandboxed command can't modify
  its own policy." This is architectural: it is NOT controlled by `excludedCommands`, and it still
  applies with `sandbox.filesystem.disabled: true`.
- **INFERRED, not documented.** That the denial extends to all of `.claude/**`. The docs name only
  `settings.json`. It is nonetheless empirically true here — this session's effective deny list
  includes `.claude/hooks`, `.claude/commands`, `.claude/agents`, `.claude/settings.json`.
- **UNDOCUMENTED.** Matching semantics for `excludedCommands` (prefix vs exact vs glob; the effect
  of `./`, an assignment prefix, or a compound). The docs show both bare names (`"gh "`) and globs
  (`"docker *"`) without specifying the rule.
- **UNRESOLVED.** Why the `gh` *network* exclusion did not apply. This is filesystem-independent, so
  the built-in `.claude/**` guard cannot explain it. Left as an open question — NOT guessed at.
- **DOCUMENTED GAP.** There is no supported way to detect that a declared exclusion failed to apply.
  A harness must verify the effect itself (e.g. assert the write landed), which is precisely Tier 1.

### The load-bearing consequence

Tier 2 was **doubly void**: even with perfect matching, the `.claude/**` denial would still have
blocked the checkout. No settings change could ever have fixed this.

The root collision: **this repo versions its control plane inside `.claude/`** — `hooks/`,
`commands/`, `agents/` are tracked source files. The sandbox reserves that same path as
configuration a sandboxed command may not touch. Therefore `git checkout` of ANY branch that
changes the harness is sandbox-incompatible by construction, permanently. This single fact explains
every `.claude`-related failure observed today: the half-applied `gatefull` checkout, `worktree add`
needing an override, and the lane worktrees under `.claude/worktrees/` needing one.

## Consequence for the proposal

- Tier 1 (assert preconditions/postconditions) is unaffected and is now the ENTIRE safety story:
  it is the only remedy that works regardless of why the sandbox behaves as it does.
- Tier 2 as originally scoped (normalize the entries) is void — normalizing an inert list is a no-op.
  Replaced by: correct the false carve-out claims in `CLAUDE.md` / `docs/harness.md` and record the
  measured behaviour above.
- Tier 2 as originally scoped is not merely broken but **impossible**. The doc correction must say
  so plainly: no configuration can grant this, so harness operations touching `.claude/**` require
  an attended explicit override or the devcontainer — permanently, not pending a fix.
- Tier 3 gains a concrete candidate that only emerged from the documentation check: **relocate the
  versioned harness sources out of `.claude/`** (e.g. `harness/hooks/`, `harness/commands/`, with
  `.claude/` retaining only thin pointers or symlinks). That would make the harness
  sandbox-compatible outright, rather than requiring an override forever. Bigger than the
  gate-worktree idea and it subsumes it — a lane worktree under a non-`.claude` path stops being a
  special case too. Spike it with a kill criterion; do not adopt blind, since `.claude/` paths are
  what Claude Code itself discovers hooks/commands/agents from, and symlink resolution there is
  unverified.
