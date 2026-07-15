# Context chains: clear-sonarqube-warnings

## chain-1: protected-codex-hooks-sonar-cleanup HUMAN-BOOTSTRAP

- tasks: 1.1–1.2, 2.1
- rationale: The current SonarQube inventory includes `.codex/hooks/**` and its shell tests. These files are protected harness code and must be changed only through the human-ratified protected-patch flow; the navigation exception is explicitly out of scope.
- reads: `specs/repository-static-quality/spec.md` §Requirements; `docs/harness.md` §§4, 10; `research.md` §Exact files/findings that should be fixed
- handoff: none
- writes-contract: none
- HUMAN-BOOTSTRAP edits: only the exact Sonar finding locations under `.codex/hooks/**` and `.codex/hooks/test/**`; no protected configuration changes, no rule suppression, and no edits to `src/sdk/navigation.tsx` beyond preserving the user’s existing dirty diff.

## chain-2: protected-build-invariants-sonar-cleanup HUMAN-BOOTSTRAP

- tasks: 2.2, 3.1
- rationale: Build and invariant sources are protected Class-2 paths. Their Sonar fixes and any generated outputs must be applied by the attended human-ratified flow, then verified by the canonical build.
- reads: `specs/repository-static-quality/spec.md` §Requirements; `docs/harness.md` §§4, 10; `research.md` §Constraints and invariants
- handoff: none
- writes-contract: none
- HUMAN-BOOTSTRAP edits: only exact Sonar finding locations in `build/**` and `invariants/**`, plus canonical generated outputs produced by `npm run build`; never hand-edit generated files or alter gates/configuration.

## chain-3: source-and-support-cleanup

- tasks: 1.2, 2.3, 3.2
- rationale: The live SonarQube issue list contains 27 non-protected findings across server tests, host tests and helpers, runtime loader code, SDK surfaces/tests/theme, and one non-exception navigation finding. They share a semantics-preserving cleanup context; the implementer must preserve the user’s dirty navigation rationale while fixing its separate `Object.hasOwn()` finding.
- reads: `specs/repository-static-quality/spec.md` §Requirements; `research.md` §§Current behavior, Constraints and invariants, Exact files/findings that should be fixed, Justified navigation exception; `design.md` §Decisions
- handoff: none
- writes-contract: none
