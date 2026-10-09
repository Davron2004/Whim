# Open follow-ups

Findings a change found and deliberately did not fix because they were outside its scope. A hardening
change's UNSAFE pattern-census rows land here before closure (`.claude/commands/opsx/apply.md` step 13).
Each entry gives `file:line`, the vulnerability class, and what done looks like. Not date-named, so
`/critic-run` never takes it for its scope marker. Strike through and date an entry when it is resolved.

## 1. The binding-provenance detector is outside the gate's tamper tripwire (2026-10-09)

**Where.** `checks/test/repo/binding-provenance.ts` and its suite, reached by the fast gate through
`check "static-checks" npm run -s checks:test` in `scripts/gate.sh`; the `CONFIG_SET` tripwire at
`scripts/gate.sh:23` covers `build/` and `invariants/` but not `checks/`.

**Class.** Verification integrity: detector weakening. An edit that loosens the audit (for example,
accepting the guard anywhere in the callback) gates green, and the gate cannot tell. True of every
Node suite the gate runs, so it predates `harden-binding-provenance` (design.md, Risks/Trade-offs).

**Done looks like.** Either `checks/` (or at least `checks/test/repo/`) joins `CONFIG_SET`, or the
owner records that Node suites are deliberately agent-editable and closes this entry.
