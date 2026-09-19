# Progress

- Started on integration/store-launch at 9701e6a; clean tracked tree and committed gate scripts verified.
- User directed practical fixes over rigid fix-loop mechanics. The existing staging branch remains the integration target.
- Created isolated branches/worktrees fix/pr35-server, fix/pr35-client and fix/pr35-release from the reviewed tip.
- Server, client and release workers dispatched with disjoint ownership. Scope is recorded in plan.md.
- Server initial regressions failed 21 checks before the fixes, then passed all 252 targeted checks. Review required bounded error settlement and preservation of known usage during recovery; the final candidate 0926f4a passed all 326 targeted checks, lint and typecheck and was independently approved and merged.
- Primary-checkout server acceptance passed 2,640 checks with zero failures. This confirmed the worktree-only production-bundle input-path mismatch; no project configuration was changed to accommodate it.
- Release candidate bf2cd644 passed real Chromium pixel verification and stubbed firewall/bootstrap tests. Review required retention of minimum runbook and specified capacity-profile contracts; those assertions and their negative controls were restored, independently approved and merged. The scoped deployment suite passed 308 checks.
- Client candidate afd0146a was independently approved and merged. The original stale-response bug failed through rendered LauncherRoot before the fix. All 10,525 launcher checks passed afterward; a disabled-control mutation failed as intended. Rendered interactions replaced source scans, with 136 fewer lines across the client changes.
- The combined full gate passed at 71a5ecb3d1712960df71390aa44f4afd8684469e, including all Node suites, typecheck/lint, knip, Metro, browser containment/synthetic-run/generation/delivery checks, Codex mirror validation and 41 OpenSpec validations. Log: /tmp/pr35-integrated-gate.log.
- All ten findings in this batch are complete. No protected configuration, dependencies or main specifications changed. Native-device acceptance and the other store-launch release tasks remain in their existing changes; this batch does not claim to complete them.
