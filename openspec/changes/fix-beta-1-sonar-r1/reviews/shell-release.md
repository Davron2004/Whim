# Shell-release review

Independent read-only review: CLEAN, cb57231c914689c6c97717bfa067d5839559826c against pinned BASE 4d15c0dde6e3da268f50b8656e895b812d1efcab.

The seven changed paths equal the revised allowlist. No configuration, environment declaration, harness or dependency changes. The diff passes whitespace checks. upgrade-check.sh parses under installed macOS Bash 3.2; the changed positional arguments are bound locally, while quoting, artifact order, result recording and failure exits remain intact. Smoke/load predicates preserve the same comparisons under Bash [[ ]].

runVerifyAab contains no await. CliCommand.run permits number or Promise<number>, and runCli still returns the numeric command result through its async boundary. The standalone node-buffer.d.ts re-exports only the existing Buffer type; env.d.ts is a module and cannot supply this missing module declaration through augmentation.

Structural-no-test classification confirmed. Worker fast gate exited 0 with FAST GATE PASSED; root integrity exited 0. Hermetic full gate remains required before merge.
