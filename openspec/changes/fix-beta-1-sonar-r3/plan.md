# Sonar round 3 plan

Nested beta-1 closure on integration/beta-1, PR137. This is the new S107 finding at3a23babe, distinct from the capped/parked R2 behavioral lane.

- [ ] S1 — MED structural-no-test refusal-handler context refactor; exact DONE in done.md.

Allowlist: LauncherRoot.tsx only. Preserve behavior and each context field. No source-grep or patch-shaped test; existing producer tests, typecheck, inspection and full gate are the assurance. Verifier revisions at most2; one extended failed-gate attempt. Original R2 park/cap stays intact. No config, dependencies, suppression or scope expansion.
