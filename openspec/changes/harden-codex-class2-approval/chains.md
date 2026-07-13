# Context chains: harden-codex-class2-approval

## chain-1: protected-approval-core

- tasks: 1.1–1.7
- classification: HUMAN-BOOTSTRAP — the current bridge creates pre-prompt grants and consumes them non-atomically, so it is not safe enough to approve its own replacement; no subagent may receive or write this chain.
- rationale: The state library, root registration, authorizer, consuming helper, mirror declaration, and behavioral suite form one security boundary that must be reviewed and installed as a single exact bootstrap patch.
- reads: `specs/codex-protected-approval/spec.md` §§ “Trusted root registration”, “Immutable exact-hash staging”, “Structurally inert pre-approval state”, “Atomic single-use consumption”, “Consumption-time identity and repository binding”, “Opened-object integrity and target scope”, “Fixed expiration and stale cleanup”, “Append-oriented security audit”, “Fail-closed private state”, “Narrow native approval and direct-edit denial”, and “Behavioral regression evidence”; handoff: none
- precise-edits: `.codex/hooks/protected-approval-state.sh` (new), `.codex/hooks/register-root-session.sh`, `.codex/hooks/authorize-protected-patch.sh`, `.codex/hooks/apply-reviewed-protected-patch.sh`, `.codex/hooks/test/protected-patch.test.sh`, and `scripts/sync-codex.mjs`; `.codex/hooks/test/provider-adapters.test.sh`, `.codex/hooks/test/bash-policy.test.sh`, `.codex/hooks.json`, `.codex/rules/protected-patch.rules`, and `scripts/gate.sh` may be changed only if the exact bootstrap review demonstrates a required non-broadening compatibility assertion.
- writes-contract: `handoff/approval-state.md` — ≤60 lines containing the state-directory layout, record schemas/required fields, session/repository binding fields, lifecycle transitions, expiry rule, audit event names/fields, exact production helper syntax, target policy, cleanup semantics, and targeted test commands/results; never include tokens, raw transcripts, patch bodies, or full audit payloads.

## chain-2: operator-documentation

- tasks: 2.1–2.3
- rationale: Canonical/operator documentation consumes the installed bridge contract but touches no protected implementation files and can be dispatched only after the bootstrap is manually ratified.
- reads: `specs/codex-protected-approval/spec.md` §§ “Structurally inert pre-approval state”, “Atomic single-use consumption”, “Consumption-time identity and repository binding”, “Fixed expiration and stale cleanup”, “Append-oriented security audit”, “Narrow native approval and direct-edit denial”, and “Behavioral regression evidence”; handoff: `handoff/approval-state.md`
- precise-edits: `docs/harness.md`, `docs/capabilities.md`, and `CLAUDE.md`
- writes-contract: none
- after: chain-1
