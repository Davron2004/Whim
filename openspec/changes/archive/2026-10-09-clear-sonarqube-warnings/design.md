## Context

The latest SonarQube Cloud analysis reports 48 new issues on `main`; the repository’s local SonarJS ESLint mirror is already green. Research confirms that the dirty `src/sdk/navigation.tsx` change is the one intentional S2819 exception: an opaque sandbox frame must use `'*'` when posting to its parent, and the outer runtime authenticates the source window. The remaining findings are therefore external static-analysis cleanup in repository code, not a product behavior change. See `research.md` for the bounded terrain digest.

## Goals / Non-Goals

**Goals:**

- Remove every currently reported SonarQube finding except the documented navigation S2819 exception.
- Keep the navigation rationale immediately above its `NOSONAR` annotation and preserve the existing dirty edit.
- Preserve runtime, sandbox, security, and harness semantics.
- Regenerate generated artifacts from source and pass the required fast and full gates.

**Non-Goals:**

- Changing Sonar rules, ESLint configuration, gate scripts, or protected harness files.
- Replacing the opaque-origin `'*'` target with an origin that would drop valid navigation frames.
- Changing product behavior or adding new diagnostics suppressions.

## Decisions

1. **Fix findings at their source.** Each current Sonar issue will be mapped to its file, line, rule, and category before editing; the implementation will make the smallest semantics-preserving correction or refactor. This avoids weakening the analyzer and follows the zero-warning policy.

2. **Preserve the navigation exception.** The `src/sdk/navigation.tsx` `postMessage` call retains `'*'` and a narrowly scoped `NOSONAR` comment with the opaque-origin/source-authentication explanation immediately above it. The outer source verification remains the security boundary.

3. **Partition by disjoint ownership.** Findings will be grouped into chains by file/layer so implementers do not edit overlapping files. Generated outputs are produced only by the build command after source changes; no generated file is hand-edited.

4. **Use gates as the acceptance boundary.** The implementer self-gates each chain, the dispatcher regates after each merge, and the final full gate verifies lint, build, Metro resolution, Chromium invariants, and OpenSpec validity. SonarCloud’s external reanalysis remains the authoritative confirmation for the one external-only rule set.

## Risks / Trade-offs

- **[Risk]** A SonarCloud finding may not have a local SonarJS equivalent. → **Mitigation:** use the current project issue list/rule locations as the inventory and verify the external issue count after analysis; do not assume local lint alone is sufficient.
- **[Risk]** A shell or build-tool refactor could alter harness behavior. → **Mitigation:** keep changes local to each finding and run the relevant gate suites plus the full gate before completion.
- **[Risk]** Build regeneration may update tracked artifacts. → **Mitigation:** run the canonical build once source edits are complete and review generated changes as outputs, never as hand-authored fixes.
- **[Risk]** The pre-existing dirty navigation edit could be lost during worktree setup or merge. → **Mitigation:** treat it as an existing user change, exclude it from the cleanup chain’s write scope, and verify its diff remains intact before and after merges.
