# Whim test audit — shared rubric

## Context

Whim: React Native host app (iOS + Android) where users generate "mini-apps" by talking. Mini-apps are
LLM-generated TypeScript run in a hardened WebView sandbox; a generation server (`server/`) builds them.
Repo root: /Users/davrondjabborov/Work/other/Whim. Read CLAUDE.md there for the standing invariants.

Tests are NOT jest. They are custom Node suites (`*.suite.ts`, `acceptance.ts`, `*.test.ts`) that each
directory's `run.mjs` bundles with esbuild and runs; headless-Chromium invariant suites; and shell tests
(`*.test.sh`). The shared helper `checks/test/harness.ts` wraps `node:assert`.

How the tests got this way: the owner experimented with AI-driven coding under a hard rule — every agent
task had to produce tests that were red before the implementation and green after (phased "greenBy"
TDD, plus a red-check in the fix loop). That forced coverage of everything, including things that never
deserved a test. The owner believes roughly half the tests shouldn't exist. That is the most common
failure mode, not the only one.

PR #35 = branch `integration/store-launch` (current HEAD) into `main`. Classify every file as
NEW (added by the PR), CHANGED (existed, modified by the PR), or OLD (untouched by the PR):
`git diff --numstat main...HEAD -- <path>`.

## The owner's standard

Tests must earn their place. A behavioral change (observable I/O, error surface, persisted state,
control flow) deserves a behavioral test. A standing invariant worth locking (e.g. "no eval in sandbox
source", "CSP never gains unsafe-eval") may deserve a static check, if it encodes the invariant and not
the patch. Litmus: would this assertion make sense to someone who never saw the diff that introduced it?
Structural changes with no lasting invariant (renames, refactors, dead-code removal) deserve no test.
Source-grep tests are refactor-brittle: they break, or get faked with a planted comment, the moment code
moves.

A hardening test must fail against the most plausible WEAKER implementation, not only against the guard
deleted. A test that passes against two different implementations proves neither.

## Litmus questions for every test

1. What realistic bug makes this fail? If none — or only a bug nobody would write — it's dead weight.
2. Does it discriminate against the plausible weaker implementation?
3. Does it survive a behavior-preserving refactor? If a rename/move/reword breaks it, it's a change detector.
4. Is the same behavior already asserted, more strongly, elsewhere? Cite where.
5. Does it observe behavior at a boundary (I/O, persisted state, error surface, rendered UI, wire format)
   or poke internals?

## Failure-mode tags

- RED-GREEN-ARTIFACT — exists only because the code didn't exist yet: an export/function/file exists, a
  constant equals its own literal, a type has a shape, a module loads.
- SOURCE-GREP — reads source/config text and regex-matches it. Legit ONLY when it locks a standing
  invariant a newcomer would understand. Otherwise delete it or replace it with a behavioral test.
- TAUTOLOGY — recomputes the expected value with the implementation's own logic, asserts a mock returns
  what it was told to, compares a fixture to itself.
- VACUOUS — cannot fail: assertion in a callback that may never run, loop over a possibly-empty
  collection, missing await, assertion true by construction, swallowed catch.
- CHANGE-DETECTOR — pins exact copy, log strings, call order, internal state, file layout, counts;
  breaks on harmless edits, catches no bugs.
- OVER-MOCKED — so much is faked that the test checks the fakes' wiring, not the unit.
- DUPLICATE — same behavior as a stronger test (name it, file:line).
- PLATFORM — tests Node/SQLite/esbuild/React/JSON/OS behavior rather than Whim's.
- TIMING — fixed sleeps, tick budgets, wall-clock assertions: flaky.
- KITCHEN-SINK — one giant test asserting many unrelated things; a failure diagnoses nothing.
- META — tests of test helpers/harness plumbing that protect nothing shipped.
- DOC-TRIPWIRE — asserts a markdown/doc/comment contains a string.
- Anything else: name it.

## Verdicts (per file AND per test or group of tests)

- DELETE — catches no realistic bug. Remove.
- REWRITE — protects something real, badly. Give the concrete rewrite: what to exercise, what to assert.
- MERGE — collapse into a named other test, or parametrize a family of near-copies.
- KEEP-FIX — keep; one specific small flaw (missing await, timing, weak message).
- KEEP — earns its place. One line, no elaboration.

Be harsh, and be right. Don't inflate or deflate to hit a number. A wrong DELETE on a containment,
money, or user-data test costs more than a missed one. Tests of the standing invariants (containment:
CSP, opaque-origin iframe, nonce auth, no eval; money: one terminal event, ledger/credits/usage
settlement; data: fork appId isolation, additive schema) get REWRITE rather than DELETE when bad —
unless another test already covers the property (cite it).

## Evidence

Every non-KEEP finding cites `file:Lstart-Lend`, quotes the key assertion (short), and says which bug it
would or wouldn't catch. Read the implementation under test when you need to — judging that is the job.
For DUPLICATE, name the stronger test by file:line.

## Rules

- Read-only on the repo. No edits, no `npm run` (no build, suites, or gate), no checkout/stash/reset.
  Read-only commands only (git diff/log/show, grep, wc, cat, sed -n). The only file you write is your
  report file.
- Stay in your slice. You may read anything to judge duplication, but only rate files in your slice.
- Don't fix anything. A production bug you notice goes in "Incidental", one line each.
- `invariants/` is owner-authored: critique it, but mark those findings OWNER-ONLY.
- Non-test files in your slice (runners, helpers, fixtures, spec docs): one line each unless bloated or
  dead.
- If a case doesn't fit the rubric, say so in the report rather than inventing a rule.

## Report

Write the full report to `<slice>.md` in this folder:

1. Totals table: files, test lines, estimated lines to DELETE, estimated lines to REWRITE/MERGE —
   split NEW / CHANGED / OLD.
2. Per-file sections, worst first:
   `### path (N lines, NEW|CHANGED|OLD) — VERDICT`, then bullets
   `- [TAG] test name (file:Lx-Ly) — VERDICT. Why. Rewrite: …`
   KEEP files: a one-line entry in a final "Keep" list, no section.
3. Patterns: the 3–5 most common failure modes in the slice, with counts and one representative example.
4. Incidental.

Your final message back: at most 40 lines — the totals, the 10 worst offenders (one line each), the top
patterns, and the report path. Not the full report.
