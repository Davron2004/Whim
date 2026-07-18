# Human-bootstrap contract

## SDK acceptance lane

- Command: `npm run sdk:test`.
- Runner: `src/sdk/test/run.mjs`.
- Discovery: every direct child matching `src/sdk/test/*.acceptance.ts` or `*.acceptance.tsx`, sorted by filename.
- Each suite is bundled and imported independently; a suite executes its assertions at module load and exits non-zero by throwing or setting failure through the imported module.
- Zero discovered suites is a hard failure.
- Bundling uses Node ESM, `tsconfigRaw: '{}'`, and external React / `react-test-renderer` so all suites share one installed React instance.
- `scripts/gate.sh` runs the lane as the `SDK` check. SDK feature chains add suites without editing any shared acceptance aggregator.

## Codex worktree Git location

- Supported alternate location signal: `git -C <absolute-repo-root>/.claude/worktrees/<worktree-id> <git-command>` as one simple, unquoted command.
- The path must end exactly at one worktree id. Whitespace ambiguity, traversal, missing ids, and nested suffixes do not qualify.
- The hook normalizes the Git command before tier-1/tier-2, read-only, and mutating checks. `git -C ... push`, `config`, shared-ref operations, and history operations therefore retain their existing denials.
- Mutating allowed verbs remain `add`, `commit`, `checkout`, `switch`, `restore`, `stash`, `branch`, and `rev-parse`.
- `owners_claim(repoRoot, worktreeId)` remains authoritative: first mutating use binds the agent; a different agent is denied.
- Compound commands never receive automatic permission.
- Codex worktree agents use narrow `sandbox_permissions: require_escalated` on each mutating `git -C` call because the linked index is stored beneath the main tree's read-only `.git/worktrees/`. They do not request a persistent prefix; the hook still enforces verb and ownership policy after escalation.

## Verification

- Focused hook suite: `bash .claude/hooks/test/bash-policy.test.sh`.
- The hook suite is tracked under the protected `.claude/hooks/` tree and runs in every fast gate as `bash policy`.
- `.codex/hooks/bash-policy.sh` remains a symlink; no separately edited mirror exists.
