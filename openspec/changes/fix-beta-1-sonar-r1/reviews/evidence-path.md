# Evidence-path review

Independent read-only review: **CLEAN** for `dde9bbfb548a6e636313148c7ff1675654ada264` against pinned BASE `20adf6d06e2759b694244ccbbb10be4d7923e008`.

The commit changes exactly the one allowlisted file, `openspec/changes/beta-1/acceptance/ios-repro-resume/bounds.py`. It has no harness, configuration, generated-output, or checker changes; `git diff --check` is clean.

`hierarchy_path` requires one argument, resolves it against the helper's own directory before checking containment, and opens it only after the containment, `.json`, and regular-file checks pass. A `..` path, an outside absolute path, and a symlink inside the acceptance directory whose target is outside all resolve outside `ACCEPTANCE_DIR` and exit before `open`. A directory, a missing name, and an argument count other than one also exit before a read.

The bounds walker keeps the former accessibility-text, resource-id, then value priority, traversal order, and `print(text, bounds)` output. The root validation script is a real CLI check: the checked-in sibling hierarchy yields the expected `Whim [0,0][402,874]` line, while `../ios-4/01-compose-hierarchy.json` must fail without stdout. BASE would accept that escape, so this is not a copy-only assertion. It does not dynamically create a symlink, but the production check resolves symlinks before its containment test.

No suites, gates, native actions, or server activity were run by this reviewer. The worker/root receipts and the pending full gate remain the validation authority.
