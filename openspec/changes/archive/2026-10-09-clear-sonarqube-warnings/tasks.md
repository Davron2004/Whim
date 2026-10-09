## 1. Inventory and scope

- [ ] 1.1 Record the current SonarQube Cloud finding inventory and classify the documented `src/sdk/navigation.tsx` S2819 exception separately from findings that require fixes.
- [x] 1.2 Declare disjoint file ownership for the remaining findings and confirm protected configuration and the user’s dirty navigation edit are outside the implementation scope.

## 2. Fix repository findings

- [ ] 2.1 Resolve SonarQube findings in shell hooks and hook-test scripts with behavior-preserving changes.
- [ ] 2.2 Resolve SonarQube findings in build and invariant JavaScript tooling without changing build outputs or containment checks.
- [x] 2.3 Resolve the 27 non-protected SonarQube findings in `server/test/harness.ts`, `src/host/**`, `src/runtime/web/loader.js`, `src/sdk/surfaces.tsx`, `src/sdk/test/navigation.acceptance.tsx`, and `src/sdk/theme.ts`, plus the non-exception `Object.hasOwn()` finding in `src/sdk/navigation.tsx`; preserve the documented target-origin exception.

## 3. Verify and hand off

- [x] 3.1 Run the canonical build and regenerate tracked generated artifacts from edited source where required.
- [x] 3.2 Run the fast gate after each implementation merge and the full gate on the final merged tip; confirm no non-exception Sonar findings remain and the navigation rationale is preserved.
