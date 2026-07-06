# Protected-file patch proposals — 2026-06-18

> These are the **13 protected-file findings** from the triage cut-list (`2026-06-18-triage.md`). The
> target files are hook-blocked from agent edits (`scripts/gate.sh`, `.claude/**`, `package.json`,
> `knip.json`, `.github/**`) or are owner-authored invariants — so they are drafted as **patch
> proposals for you to apply by hand**, never auto-applied.
>
> **Caveats before you apply:**
> - These diffs are **hand-drafted by read-only agents and are unverified until you run them.** Apply
>   by **matching the surrounding text, not the line numbers** — the `@@` hunk headers are approximate.
> - After applying the harness edits you must **commit them before `./scripts/gate.sh` will run** —
>   the gate's tamper tripwire refuses to run while any watched config differs from `HEAD`.
> - Each patch carries a **Verify** step; run it (or the full gate) after applying.
>
> **Two decisions are yours** (details in the Flags of each section): **H2** (how to cover
> `settings.local.json`, which is gitignored — pick A/B/C), and **G7** (whether to also retire the spike2
> runner from knip's entry set — optional). **H4 is now resolved** — see below.
>
> **⚠ H4 corrected twice after verification:** the original draft added an `"openspec":"*"` devDependency
> — but bare npm `openspec` is a `0.0.0` squat. The real CLI is published as **`@fission-ai/openspec`
> (v1.4.1, exposes the `openspec` bin)**. H4 below pins that package as a devDependency, so the gate and
> CI both resolve it via `npm ci` + `npx openspec` — no global install, no separate CI install step.

---

## Master apply order

1. `.claude/hooks/protect-harness.sh` — **H6** (block babel/metro config)
2. `package.json` — **H4** (add `@fission-ai/openspec` devDep; `npm install`, commit lockfile) + **G7** (remove dead `invariants:spike2` script)
3. `invariants/sandbox-isolation/spike2-bundle-contract/README.md` — **G7** (retirement note)
4. `knip.json` — **H10** (explicit `contract` entry); run `npx knip` to confirm no new errors
5. `scripts/gate.sh` — **consolidated** (G1+H1 new checks, H4 `npx openspec`, H6 tamper files)
6. `.claude/hooks/gate-on-subagent-stop.sh` — **H5** (absolute path to gate)
7. `.github/workflows/invariants.yml` — **H3** (quality-gate CI job)
8. `src/runtime/web/probes.js` — **G2+G5** (the four missing containment probes; owner-authored)
9. `.claude/commands/opsx/apply.md` — **H8** (fix recovery ref)
10. `.claude/agents/researcher.md` + `docs/harness-build-guide.md` — **I6** (researcher-digest wording)
11. **H2** — apply your chosen option (separate deliberate edit)
12. Commit the harness changes, then run `./scripts/gate.sh` and push to confirm CI.

---

# Section 1 — Gate ↔ CI ↔ build-config coherence (G1, H1, H2, H3, H4, H5, H6, G7, H10)

The systemic cluster: the local gate and CI had drifted apart. These patches make `gate.sh` run the
two security suites CI runs (`bridge:invariants`, `guard:metro`), make CI run the four static checks
the gate runs (typecheck/lint/knip/tripwire), put `openspec` on a real dependency footing, and widen
the tamper guards to cover the Metro/Babel build config.

### H6 [med] — block `babel.config.js` / `metro.config.js` from subagent edits

**File:** `.claude/hooks/protect-harness.sh`

```diff
@@ case "$FILE" in
   */scripts/gate.sh|scripts/gate.sh|\
   */.claude/*|.claude/*|\
   */eslint.config.*|eslint.config.*|*/.eslintrc*|.eslintrc*|*/.eslintignore|.eslintignore|\
   */knip.json|knip.json|*/knip.config.*|knip.config.*|\
   */tsconfig*.json|tsconfig*.json|\
-  */package.json|package.json|*/package-lock.json|package-lock.json)
+  */package.json|package.json|*/package-lock.json|package-lock.json|\
+  */babel.config.js|babel.config.js|\
+  */metro.config.js|metro.config.js)
```

**Why:** a subagent that rewrites Metro's `blockList` or Babel's transform chain can neutralize the
`guard:metro` step. **Verify:** from a subagent, attempt to Edit `babel.config.js` → expect
`BLOCKED: harness/verification config is human-approved only.` (exit 2).

### Consolidated `scripts/gate.sh` patch (G1 + H1 + H4 + H6)

**File:** `scripts/gate.sh`

```diff
@@ tamper tripwire
 if ! git diff --quiet HEAD -- \
       package.json package-lock.json tsconfig*.json \
       eslint.config.* .eslintrc* .eslintignore knip.json knip.config.* scripts/gate.sh \
-      .claude/hooks .claude/settings.json 2>/dev/null; then
+      .claude/hooks .claude/settings.json \
+      babel.config.js metro.config.js 2>/dev/null; then
   echo "GATE REFUSING TO RUN: verification config (or a harness hook) differs from committed HEAD."
   echo "These are human-edited and must be committed deliberately before the gate will run:"
   git --no-pager diff --name-only HEAD -- \
       package.json package-lock.json tsconfig*.json \
       eslint.config.* .eslintrc* .eslintignore knip.json knip.config.* scripts/gate.sh \
-      .claude/hooks .claude/settings.json 2>/dev/null
+      .claude/hooks .claude/settings.json \
+      babel.config.js metro.config.js 2>/dev/null
   exit 2
 fi
@@ checks
 check "typecheck"         npm run -s typecheck
 check "lint"              npm run -s lint -- --max-warnings 0
 check "dead code (knip)"  npx knip
 check "build"             npm run -s build
+check "metro-guard"       npm run -s guard:metro
 check "invariants"        npm run -s invariants
+check "bridge-invariants" npm run -s bridge:invariants
 check "version-store"     npm run -s vstore:test
 check "storage-engine"    npm run -s storage:test
 check "capability-bridge" npm run -s bridge:test
 check "launcher"          npm run -s launcher:test
 check "deliver-by-source" npm run -s launcher:deliver-verify
 check "server"            npm run -s server:test
-check "openspec"          openspec validate --all --strict
+check "openspec"          npx openspec validate --all --strict
```

**Placement:** `metro-guard` (pure Node) right after `build`, before browser steps; `bridge-invariants`
(Playwright/Chromium) after `invariants` since they share the build + browser prerequisite.
**openspec (H4):** with `@fission-ai/openspec` pinned as a devDep (H4), `npx openspec` resolves the
binary from `node_modules/.bin` after `npm ci` — no global, no `--yes`. **Note H2 is deliberately NOT in
the tamper lines** — `settings.local.json` is gitignored and invisible to `git diff` (see H2 Flags).
**Verify:** break `bridge:invariants` (corrupt a page assertion) → `./scripts/gate.sh` must print
`FAIL: bridge-invariants` and `GATE FAILED`; restore → `PASS`. Same for `guard:metro`.

### H3 [high] — add the static-check job to CI

**File:** `.github/workflows/invariants.yml` (new `quality-gate` job before `isolation-suite`)

```diff
@@ jobs:
+  quality-gate:
+    runs-on: ubuntu-latest
+    steps:
+      - uses: actions/checkout@v4
+      - uses: actions/setup-node@v4
+        with:
+          node-version: 22
+      - run: npm ci
+      - name: Typecheck (tsc --noEmit)
+        run: npm run typecheck
+      - name: Lint (eslint --max-warnings 0)
+        run: npm run lint -- --max-warnings 0
+      - name: Dead code (knip)
+        run: npx knip
+      # openspec resolves from node_modules/.bin via the @fission-ai/openspec devDep (H4) + the npm ci above.
+      - name: OpenSpec validate
+        run: npx openspec validate --all --strict
+      # Mirror of the gate.sh scaffolding tripwire; `! grep` fails the step on any match.
+      - name: Scaffolding tripwires
+        run: |
+          ! grep -rn --include='*.ts' --include='*.tsx' \
+            -e 'TEMP:' -e 'HACK:' -e 'isImplemented' -e 'IS_IMPLEMENTED' \
+            -e 'console\.log(.*debug' \
+            src/ 2>/dev/null
+
   isolation-suite:
     runs-on: ubuntu-latest
     steps:
```

**Flag:** the tripwire patterns are copied from the agent's read of `gate.sh:62` — **diff this against
the real tripwire in your gate.sh** and reconcile so the two stay identical. No Playwright in this job.
**Verify:** push a branch adding `// TEMP: foo` in a `src/**/*.ts` → `quality-gate` goes red,
`isolation-suite` unaffected.

### H4 [high] — pin `@fission-ai/openspec` as a devDependency (CORRECTED)

Verified: bare npm `openspec` is a `0.0.0` squat and `@openspec/cli` 404s, but the **real CLI is
`@fission-ai/openspec` v1.4.1**, which exposes the `openspec` binary (`bin/openspec.js`). Pinning it as a
devDep makes the gate and CI resolve it via `npm ci` + `npx openspec` — no global dependency, no separate
CI install. (This is what the user installs globally too: `npm i -g @fission-ai/openspec@latest`.)

**File:** `package.json` (devDependencies — keep alphabetical order with the other `@`-scoped entries)

```diff
   "devDependencies": {
+    "@fission-ai/openspec": "^1.4.1",
     "@react-native/babel-preset": "...",
     ...
     "knip": "^6.16.1",
```

**Apply note:** place it among the scoped `@…` devDeps (exact position depends on the existing ordering).
After editing, `npm install` to update `package-lock.json`, then commit both. The consolidated `gate.sh`
patch and the H3 CI job both call `npx openspec validate --all --strict`, which now resolves from
`node_modules/.bin`. **Verify:** `rm -rf node_modules && npm ci && npx openspec --version` → `1.4.1` from
`node_modules/.bin/openspec` (not `/opt/homebrew/bin`); `./scripts/gate.sh` passes the `openspec` check.

### H5 [med] — hook invokes gate via absolute path

**File:** `.claude/hooks/gate-on-subagent-stop.sh`

```diff
-OUT=$(./scripts/gate.sh 2>&1)
+# Resolve gate.sh by project root (CLAUDE_PROJECT_DIR), falling back to this hook's own location
+# (.claude/hooks → repo root is two levels up) so it works regardless of the hook's cwd.
+ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
+OUT=$("$ROOT/scripts/gate.sh" 2>&1)
```

**Correction:** the original draft used `$(dirname "$0")/../scripts/gate.sh`, which is **wrong** — the
hook lives at `.claude/hooks/`, so `../scripts` resolves to `.claude/scripts`, not the repo-root gate
(it's two levels up, `../../`). The applied version uses `$CLAUDE_PROJECT_DIR` with a `BASH_SOURCE`
fallback. **Verify:** trigger SubagentStop from a subdir cwd (e.g. `server/`) → gate still runs.

### G7 [low] — remove the dead `invariants:spike2` script

**File:** `package.json`

```diff
     "bridge:invariants": "node invariants/sandbox-isolation/bridge/runner.mjs",
-    "invariants:spike2": "node invariants/sandbox-isolation/spike2-bundle-contract/runner.mjs",
     "server:dev": "node server/dev.mjs",
```

Plus prepend a retirement note to `invariants/sandbox-isolation/spike2-bundle-contract/README.md`:

```
> **Note (2026-06-18):** The `npm run invariants:spike2` script has been retired. This directory is an
> archived reference; its T1–T7 + F4 scenarios were promoted into the main `npm run invariants` suite
> (run-against-build.mjs). To run the pages directly: `node runner.mjs` from this dir after `npm install`.
```

**Flag (optional):** `knip.json`'s root entry `invariants/**/*.mjs` still treats the runner as an entry,
so removing the script doesn't change knip's view. Fully retiring it from knip is a separate, optional
narrowing of that entry glob. **Verify:** `npm run invariants:spike2` → "missing script"; `npx knip` → no
new unused flags.

### H10 [low] — explicit `contract` workspace entry in knip

**File:** `knip.json`

```diff
     "contract": {
+      "entry": ["src/index.ts"],
       "project": "src/**/*.ts"
     },
```

Matches the `server` workspace's shape and `contract/package.json`'s `main`/`exports`.
**Verify:** `npx knip` before/after is identical (or surfaces genuinely-unused contract exports to review).

### H2 [med] — DECISION: `settings.local.json` tamper coverage

**✅ RESOLVED (2026-06-19): Option C chosen and applied** — `gate.sh` carries a comment documenting that
`settings.local.json` is intentionally out of the tripwire (gitignored → uncommittable; `protect-harness.sh`
blocks in-session writes; residual risk accepted). No tripwire change. Options retained below for the record.

**The finding's literal suggestion doesn't work:** `.claude/settings.local.json` is **gitignored**, so
adding it to the gate's `git diff HEAD` tamper list is silently inert. Pick one:

- **Option A (recommended) — committed hash baseline.** Add to `gate.sh` after the git-diff block:
  ```sh
  if [ -f ".claude/settings.local.json" ]; then
    EXPECTED=$(cat .claude/settings.local.json.sha256 2>/dev/null || echo MISSING)
    ACTUAL=$(shasum -a 256 .claude/settings.local.json | awk '{print $1}')
    if [ "$EXPECTED" != "$ACTUAL" ]; then
      echo "GATE REFUSING TO RUN: .claude/settings.local.json differs from approved baseline."
      echo "If intentional: update .claude/settings.local.json.sha256 and commit it."
      exit 2
    fi
  fi
  ```
  Commit `.claude/settings.local.json.sha256` (add `!.claude/settings.local.json.sha256` to `.gitignore`).
- **Option B — untrack & commit.** Remove `.claude/settings.local.json` from `.gitignore`, commit the file;
  the existing tamper tripwire then covers it like `settings.json`. (Only if its five `Bash(...)` allow-rules
  are safe to expose in repo history.)
- **Option C — document & rely on the hook.** `protect-harness.sh` already blocks in-session subagent writes
  to `.claude/**`; since the file can't be committed (gitignored), accept the residual risk with a comment.

---

# Section 2 — Owner-authored containment probes (G2 + G5, also closes A2)

Four globals are stripped in `neutralize.js` but never probed, so a regression dropping their
neutralization would pass the suite green. These probes close that. **Owner-authored** — review before
applying.

**File:** `src/runtime/web/probes.js` (single combined patch)

```diff
@@ // 1. network
   expectThrow('network', 'fetch', function () { return fetch('https://example.com/whim-probe'); });
   expectThrow('network', 'XMLHttpRequest', function () { return new XMLHttpRequest(); });
   expectThrow('network', 'WebSocket', function () { return new WebSocket('wss://example.com'); });
+  // RTCPeerConnection is load-bearing: WebRTC bypasses connect-src 'none', so the value-strip
+  // is the ONLY closure for this vector — CSP does not help here (see neutralize.js:62).
+  expectThrow('network', 'RTCPeerConnection', function () { return new RTCPeerConnection(); });
+  expectThrow('network', 'EventSource', function () { return new EventSource('https://evil.example'); });
   expectThrow('network', 'window.fetch (stub)', function () { return window.fetch('https://example.com'); });
   expectThrow('network', 'navigator.sendBeacon', function () { return navigator.sendBeacon('https://example.com', 'x'); });
@@ // 3. ambient persistence + threading
   expectThrow('ambient', 'localStorage', function () { return localStorage.setItem('a', 'b'); });
   expectThrow('ambient', 'sessionStorage', function () { return sessionStorage.setItem('a', 'b'); });
   expectThrow('ambient', 'indexedDB', function () { return indexedDB.open('whim'); });
+  expectThrow('ambient', 'caches.open', function () { return caches.open('test'); });
+  expectThrow('ambient', 'SharedWorker', function () { return new SharedWorker('data:application/javascript,1'); });
   expectThrow('ambient', 'Worker', function () { return new Worker('data:application/javascript,1'); });
@@ T1 self-injected-script block
       'try{localStorage.setItem("x","y");o.ls="DID-NOT-THROW";}catch(e){o.ls="threw:"+e.name;}' +
+      'try{new RTCPeerConnection();o.rtc="DID-NOT-THROW";}catch(e){o.rtc="threw:"+e.name;}' +
       'try{eval("1+1");o.eval="DID-NOT-THROW";}catch(e){o.eval="threw:"+e.name;}' +
@@ T1 verdict guard + detail
-      var t1blocked = /^threw:/.test(t1.fetch) && /^threw:/.test(t1.xhr) &&
-        /^threw:/.test(t1.ws) && /^threw:/.test(t1.ls) && /^threw:/.test(t1.eval);
+      var t1blocked = /^threw:/.test(t1.fetch) && /^threw:/.test(t1.xhr) &&
+        /^threw:/.test(t1.ws) && /^threw:/.test(t1.ls) &&
+        /^threw:/.test(t1.rtc) && /^threw:/.test(t1.eval);
       record('pentest-T1', 'self-injected fresh <script> reclaim globals', t1blocked,
         (t1blocked ? 'ALL blocked in fresh scope → ' : 'ESCAPE → ') +
-        'fetch=' + t1.fetch + ' xhr=' + t1.xhr + ' ws=' + t1.ws + ' ls=' + t1.ls + ' eval=' + t1.eval);
+        'fetch=' + t1.fetch + ' xhr=' + t1.xhr + ' ws=' + t1.ws +
+        ' ls=' + t1.ls + ' rtc=' + t1.rtc + ' eval=' + t1.eval);
```

No other file changes — `run-against-build.mjs` already propagates any failing probe to `contained=false`.
**Verify:** `npm run build && npm run invariants` → all pass, contained=true. **Regression check:** comment
out the `RTCPeerConnection` line in `neutralize.js`, rebuild + run → exit 1 with a failed `RTCPeerConnection`
probe and `contained=false`; restore before committing.
**Flag (out of scope):** the agent noted `importScripts` is *not* stripped in `neutralize.js` — likely moot
(no Worker context) but worth confirming separately.

---

# Section 3 — Harness instruction docs (H8, I6)

### H8 [low] — fix the phantom recovery command

**File:** `.claude/commands/opsx/apply.md` (~line 44). No `/opsx:continue` command exists (the five are
apply/archive/explore/propose/sync).

```diff
-   - If `state: "blocked"` (missing artifacts): show message, suggest using `/opsx:continue`
+   - If `state: "blocked"` (missing artifacts): show message and tell the user to complete missing artifacts with `/opsx:propose <name>` before applying
```

**Verify:** `grep -n 'opsx:continue' .claude/commands/opsx/apply.md` → nothing.

### I6 [med] — resolve the researcher-digest ambiguity (chose option (b))

The researcher has only `Read, Grep, Glob` (no Write), so "write research.md" is impossible. Option (b):
researcher **returns** the digest; the proposer saves it. Also tracked in `docs/backlog.md` — close that
item on apply.

**File:** `.claude/agents/researcher.md`

```diff
-3. Write the digest to the path the caller gives you (default: print it as your final message).
+3. Return the digest as your final message. The proposer (caller) is responsible for saving it
+   to `openspec/changes/<id>/research.md`.
```

**File:** `docs/harness-build-guide.md` (embedded researcher template, ~line 313 — same substitution)

```diff
-3. Write the digest to the path the caller gives you (default: print it as your final message).
+3. Return the digest as your final message. The proposer (caller) is responsible for saving it
+   to `openspec/changes/<id>/research.md`.
```

**File:** `docs/harness-build-guide.md` (exploration-policy template, ~line 511)

```diff
-- During /opsx proposal/design: save the researcher digest to openspec/changes/<id>/research.md and cite it in design.md.
+- During /opsx proposal/design: the researcher returns its digest as its final message (it has no Write
+  tool); copy that message into `openspec/changes/<id>/research.md` and cite it in design.md.
```

**Verify:** `grep -n 'default: print\|Write the digest' .claude/agents/researcher.md docs/harness-build-guide.md`
→ nothing; `grep -n 'Return the digest' .claude/agents/researcher.md` → the new line. The live root
`CLAUDE.md` already has correct phrasing — no change needed there.
