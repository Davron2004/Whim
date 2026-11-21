# chain-8 report (builder)

STATUS: complete (no class B/C). Tasks 8.1-8.4 done; 8.5 not mine.
BASE 006b2958. Commits: cc013554 (deps + seccomp rename), 42469dfb (CI workflow), plus this report commit (tip).

## Resolved versions
- esbuild 0.28.2 root (^0.28.2) and server (exact 0.28.2); one lockfile version each.
- playwright 1.65.1 root (^1.65.1) and server (exact 1.65.1).
- Chromium: Playwright 1.65.1 downloads Chrome Headless Shell 159.0.8154.6 (chromium-headless-shell v1255), not 158 as the design assumed.

## Files changed
- package.json, server/package.json, package-lock.json: ranges and lock for esbuild and playwright.
- .devcontainer/Dockerfile, deploy/Dockerfile: playwright install version.
- deploy/seccomp/chromium-playwright-1.60.0.json -> ...-1.65.1.json (git mv, content unchanged); refs updated in .devcontainer/devcontainer.json, .devcontainer/run-loop.sh, deploy/compose.yaml.
- .github/workflows/invariants.yml: cache key + npx --package to 1.65.1 (--ignore-scripts form kept); both runs-on back to ubuntu-latest, pin comments replaced; `integration/**` added to push.branches with comment (staging gets CI before its PR; duplicate runs accepted).
- No file under build/ or invariants/ changed. Nothing hand-edited in generated outputs; build left no tracked diff.

## Checks (all via run26.sh, logs in scratchpad/logs/c8-*)
- npm run build: exit 0, 3/3 source-map lines round-trip=true; grep "jsx-runtime" in build/generated and src/runtime/generated: no match (H1b holds).
- typecheck exit 0; lint exit 0.
- invariants: exit 0, 22 checks held. bridge:invariants: exit 0, 14 held.
- synthrun:test: exit 0, 547 checks passed. server:test: exit 0, 5623 passed 0 failed. checks:test: exit 0.
- gate.sh (GATE_BASE=5f6663fa): FAST GATE PASSED.
- No probe finding: nothing failed on the new Chromium, nothing suppressed.

## Seccomp judgment
Profile is a vendored Docker-style allowlist (defaultAction ERRNO), no generation script, comment or regen doc in repo, and no digest recorded anywhere despite docs/deploy.md saying "digest-matched". I did not change content. Whether Chromium 159 needs a new syscall is unproven here: only a container launch under the profile on Linux can show it (deploy runner). If it fails, regenerate from Playwright's published chromium seccomp profile for 1.65.
Note docs/deploy.md line 958 "digest-matched" is unsupported by anything in the repo.

## Ubuntu 26.04
Playwright 1.65.1 (node_modules/playwright-core) maps host ubuntu26.04 x64/arm64 as officially supported, with a deps table and Chromium/headless-shell download URLs. So the pin was reverted to ubuntu-latest. Not run on CI; dispatcher must watch the real run after pushing staging. Fallback: re-pin ubuntu-24.04 with the reason in the comment.

## Deviations
Class A: none beyond the Chromium 159 vs 158 discrepancy (information only).

## HARNESS FEEDBACK
- ENV: run26.sh foreground calls time out at 120 s and get backgrounded; chained suites needed polling via until-loops.
- NEUTRAL: dependency-pins suite and deploy-config tripwire accepted the bump with no edits.
- DRAWBACK: design text states Chromium 158; the real one is 159, stale numbers in docs rot.

## Fix round 1

- LOW 1: `server/test/deploy-config.suite.ts` gained a "Tooling: Playwright version sites" section. `.devcontainer/devcontainer.json` and `run-loop.sh` seccomp paths, `.devcontainer/Dockerfile` install pin, and the `invariants.yml` install pin and cache key must carry the lockfile's Playwright version; each seccomp path must resolve to a vendored `deploy/seccomp/chromium-playwright-<ver>.json`. A site whose pattern is missing fails closed. 11 new assertions (fixture "version differs alone" per site, fail-closed cases, unvendored case, real-repo case).
- Red-checks: each real site mutated alone to 1.60.0 (one-line `git diff --stat` each), the deploy-config suite went RED naming that site; all reverted with `git checkout --`.
- LOW 2: docs/deploy.md states the seccomp profile's upstream source (`microsoft/playwright` `utils/docker/seccomp_profile.json` at `v1.65.1`), its sha256 and how to re-verify at a bump. The hash was verified locally and against a fresh fetch from raw.githubusercontent.com.
- LOW 3: design.md Chromium range corrected to 149 -> 159.
- Gate: PASS (see verdict file).
- MED (dispatcher): `server/test/contract.suite.ts` dependency budget now also reads `server/package.json` and requires esbuild, playwright and typescript to be declared exactly (no range) at the root lockfile-resolved version. 13 new assertions: the real manifest, plus per dep a different patch, caret, tilde and missing fixture. Red-checks: `server/package.json` esbuild 0.28.1, playwright 1.65.0 and typescript 6.0.2, one at a time, each RED on the real-manifest assertion alone (fixtures are independent of the manifest); reverted with `git checkout --`.
