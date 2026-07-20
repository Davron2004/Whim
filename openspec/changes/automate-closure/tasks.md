# Tasks: automate-closure

## 1. Human bootstrap (out of repo — blocking prerequisites)

- [x] 1.1 HUMAN: create the GitHub ruleset on `main` (require PR before merging, block force pushes, restrict deletions, require the CI status checks) and confirm a direct `git push origin main` is rejected server-side *(done by user)*
- [x] 1.2 HUMAN: generate a dedicated SonarCloud user token (My Account → Security) and provision it on the host as `SONAR_TOKEN` *(done — 40-char user token in ~/.zshenv; .zshrc was wrong, non-interactive shells don't source it)*
- [x] 1.3 Verify the SonarCloud project key `Davron2004_Whim` is visible with the token via `api/components/show` (404 anonymously is expected — the project is private) *(VERIFIED: components/show 200 via assertVisible, run unsandboxed to stand in for the not-yet-active carve-out)*

## 2. Compound-command unroller (compound-command-policy)

- [x] 2.1 Implement the parser helper (`.claude/hooks/unroll-command.mjs`): strict tokenizer for plain word-list commands, single/double quotes, top-level `&&`/`||`/`;`/`|`; returns segments or a not-unrollable verdict; extracts `>`/`>>` redirect targets as pseudo-write segments
- [x] 2.2 Make the helper refuse to unroll command substitution (`$()`, backticks), eval-family wrappers (`bash -c`, `sh -c`, `eval`, `xargs`, `env <cmd>`), expansion in command position, and process substitution
- [x] 2.3 Integrate into `bash-policy.sh`: raw-string deny kernel checked first, then unroll; per-segment evaluation through the existing policy; worst-segment verdict (deny > ask > allow); single ask showing the full compound; not-unrollable → existing generic flow unchanged
- [x] 2.4 Write the adversarial regression suite (verdict composition per connector, quoted connectors as argument text, each refused construct falling through, deny-kernel-before-parse, redirect pseudo-write denial, refspec smuggling in compounds, negative control) and wire it into `scripts/gate.sh`'s tripwire section *(suite written + passing; the one-line `gate.sh` wiring lands in chain-5 per chains.md)*

## 3. Remote-write policy rework (staging-integration-lane delta)

- [x] 3.1 Rework the `bash-policy.sh` push branch: main-thread pushes of non-`main` refs (incl. `--force-with-lease origin integration/<id>`) auto-allow; every push naming `main` (incl. refspec smuggling) denied for all callers; subagent pushes denied unconditionally (unchanged)
- [x] 3.2 Relax Tier-1 for the main thread only: allow `git fetch origin` and `git pull --ff-only origin main`; all other Tier-1 git denials unchanged for all callers
- [x] 3.3 Add `gh` vocabulary to `bash-policy.sh`: auto-allow read-only forms (`pr view`, `pr checks`, `api` GET); main-thread allow for `pr create --draft` and `pr ready`; deny `gh pr merge` for all callers; deny all `gh` mutations for subagents
- [x] 3.4 Update `.claude/settings.json`: sandbox carve-outs (excludedCommands or per-host network allowlist — test which the sandbox supports) for the two push forms, the `gh` forms, and the Sonar ingestion script; `SONAR_TOKEN` passthrough scoped to the script invocation; reconcile the `permissions.deny` push entry *(chose `excludedCommands` — no network-allowlist key in this sandbox; SONAR_TOKEN scoped via envVars-deny + script exclusion; `permissions.deny` push entry kept as belt-and-braces)*
- [x] 3.5 Update the bash-policy regression suite for the new matrix (branch-push allow, main-push deny, subagent deny, gh vocabulary, fetch/ff-pull relaxation) and implement the closure-entry ruleset probe (`gh api` check that `main` blocks direct pushes) *(probe: `scripts/ruleset-probe.mjs`, fail-closed)*

## 4. Sonar issue ingestion (sonar-issue-ingestion)

- [x] 4.1 Implement `scripts/sonar-pr-issues.mjs`: fetch `api/issues/search` (paged, `resolved=false`, `pullRequest=<n>`) + `api/qualitygates/project_status` with Bearer `SONAR_TOKEN`; emit fix-loop findings-file format plus a machine-readable gate verdict *(verdict via exit code: 0 green/warn, 10 red, 3 auth-fail; `- gate:` header line)*
- [x] 4.2 Implement the auth-visibility guard: `api/components/show` first; 404/failure → non-zero exit with a distinct error and no findings output; empty findings reportable only after the guard passes
- [x] 4.3 Node test suite for the script (mocked HTTP): pagination to exhaustion, findings-format shape, guard failure modes, clean-gate case; wire into `scripts/gate.sh`'s Node suites *(suite `scripts/test/sonar-pr-issues.test.mjs`, 10 cases passing; gate.sh wiring lands in chain-5 per chains.md)*

## 5. Closure runbooks

- [x] 5.1 Rewrite `apply.md` step 12 as the orchestrator-executed pipeline: ruleset probe → push → `gh pr create --draft` → poll `gh pr checks` (bounded timeout, parkable) → on red: ingest via `sonar-pr-issues.mjs` → nested `/fix-loop` on the staging branch → re-push → re-poll → cleanup → force-push-with-lease → wait for re-analysis green → ancestor check → `gh pr ready` + notify human → post-merge teardown (delete branch local+remote, ff-sync local `main`)
- [x] 5.2 Update `git-cleanup.md`: orchestrator executes the ref move and force-push on `CLEANUP GATE PASS` (tree-identity gate and backup ref unchanged); add the standing grouping rule — Sonar-fix commits are folded into the semantic commits they touch, none survive standalone
- [x] 5.3 Update `fix-loop.md`'s CLOSURE section to reference the rewritten step 12 (standalone and nested modes)
- [x] (chain-5 rider) wire the two deferred suites into `scripts/gate.sh`: `check "compound unroller"` (chain-2) + `check "sonar ingestion"` (chain-4)

## 6. Documentation

- [x] 6.1 Amend `docs/harness.md` §4 (enforcement map rows for bash-policy, sandbox, and the new ruleset anchor), §8 (remote-write policy re-anchored to server-side main protection; compound-command policy), §11 (attended-only closure → automated closure on the attended host; presence not execution) *(also §5 step 4 + §9 current-stance buckets)*
- [x] 6.2 Append the decision entry to `docs/decisions.md` (server-side main protection as the human gate; compositional unroll policy; orchestrator-executed closure; Sonar Web API ingestion over MCP/annotations) *(decision #49, D1–D6)*

## 7. Verification

- [~] 7.1 Run `scripts/gate-full.sh` green on the change tip (includes the new unroller, policy, and ingestion suites) *(GREEN in-worktree: fast gate incl. all new suites [unroller 46, bash-policy 44, sonar 10], knip, sync-codex, openspec validate. `guard:metro` + 3 Chromium invariant suites are environment-blocked in a worktree [documented @babel/runtime resolution limit, harness.md §11] and provably UNAFFECTED — this change touches no Metro-resolved/runtime/SDK/launcher/bridge code. DEFINITIVE gate-full runs in CI on the fresh-checkout push at closure [step 12b], OR run `scripts/fixloop.sh gatefull integration/automate-closure` from a clean primary tree.)*
- [ ] 7.2 HUMAN-SUPERVISED: first closure run on a real change executes end to end with the human present but executing nothing; divergences filed as findings before this change is archived *(separate attended run — cannot execute in this background session)*
