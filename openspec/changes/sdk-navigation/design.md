# Design: sdk-navigation

## Context

The host half of navigation already exists (research.md §Current behavior): `useMiniAppHost.ts` consumes `nav-depth` frames, `back-policy.ts` implements guaranteed exit with a 400ms unhandled-press window, and `assemble.mjs` relays `__whimNavDepth` (source-verified, generation-stamped) and defines `__whimControl.navBack`. The sandbox half is a documented stub: the loader mounts `spec.screens[spec.initial]` exactly once per generation and the anchor comment at `src/runtime/web/loader.js:43-54` specifies the frames the SDK is expected to emit/consume. The static-check screen-graph pass is table-driven over `NAV_CALL_SHAPES` (ships `[]`, mechanism proven by a test-injected row). This change fills in the sandbox half and the table row; it deliberately changes nothing host-side.

Constraints carried from research.md §Constraints: containment three legs untouched (#35/#37), SDK holds no capability stronger than `parent.postMessage` (spike2 constraint 2), nav frames are deliberately NOT nonce-authenticated (depth is an untrusted hint; authority lives in `back-policy.ts`), realm reset is structural teardown (T7 — no cleanup registry, mirroring `interval`, #43/D2), mini-apps never see DOM (#11), tokens not values (#13).

## Goals / Non-Goals

**Goals:**
- Mini-apps can push/pop between the screens they already declare in `AppSpec.screens`, via a statically checkable call shape.
- Depth hints flow to the host on every stack change so system back pops instead of exiting at depth > 0.
- Dangling literal nav targets are a static error (shipped shapes-table row).
- The synthetic run harness (#10) gets a real reachability surface: nav calls are observable (depth frames) and screens are enumerable.

**Non-Goals:**
- No params-passing (`navigate('detail', {id})`) — non-literal targets break static resolution and drag in cross-screen state management. Post-v1.
- No `replace`/`reset`/`popTo` stack operations, no transition animations, no `useRoute`-style introspection beyond what apps can track themselves.
- No host-side changes (`back-policy.ts`, `useMiniAppHost.ts`, `contract.ts`, `assemble.mjs` — the last is agent-protected anyway).
- No new frame kinds, no nonce-path changes, no CSP or global-strip changes.

## Decisions

### D0: Human-bootstrap a first-class SDK test lane and repair Codex worktree ownership before dispatch

The original chain plan incorrectly treated the SDK navigation acceptance work as `src/sdk/`-only even though the fast gate had no SDK suite. The first implementer therefore wired its test through `checks/test/acceptance.ts`, overlapping the dependency-free static-check chain. Before redispatch, a HUMAN-BOOTSTRAP step adds a dedicated `sdk:test` runner discovered from `src/sdk/test/*.acceptance.ts(x)` and wires it into `scripts/gate.sh`. The SDK chain then owns only `src/sdk/**`; the static-check chain exclusively owns `checks/**`, so both remain safely parallel after the bootstrap.

The same bootstrap repairs the harness blocker exposed by the halted run: Codex executes a subagent command in the requested worktree, but the shared hook payload can retain the outer main-tree CWD. The bash policy therefore SHALL accept only an exact, simple `git -C <absolute .claude/worktrees/<id>> <git-command>` location signal, normalize it before every Git deny/read-only/mutating check, and retain `owners_claim` as the authority. Traversal, nested paths, compound commands, tier-1 Git operations, and cross-agent ownership remain denied. Because Codex's OS sandbox separately blocks linked-worktree index writes under the main `.git/`, Codex worktree-agent contracts SHALL require narrow per-command escalation for mutating Git without a persistent prefix; the hook remains the policy authority after escalation. A tracked hook regression suite is added to the fast gate. These are protected Class-2 harness edits and are never dispatched to an implementer.

Codex and Claude hook wire formats are provider-specific. Claude remains the canonical policy source. Codex SHALL use adapters rather than direct PreToolUse symlinks: canonical deny remains a Codex deny; Bash allow/ask become no PreToolUse decision and are reconciled through Codex's native PermissionRequest flow; direct protected `apply_patch` fails closed. For an attended root task only, `approvals_reviewer = "user"` plus an exec-policy `prompt` authorizes one exact SHA-256-bound Class-2 patch through the dedicated helper. Authority is bound to the registered root transcript, backed by an immutable Git-private snapshot, consumed once, and cleared after a denied prompt; subagents, malformed commands, hash mismatch, TOCTOU, non-Class-2 targets, replay, and rename escapes are denied by tracked fast-gate cases. The Codex file adapter still enumerates every add/update/delete/move path from `tool_input.command` and invokes the canonical protection policy once per path. Unparseable mutating patches fail closed. Provider-parity and approval-bridge tests run in the fast gate.

### D1: Surface is a `nav` object (`nav.navigate(name)`, `nav.back()`), not a `useNavigation()` hook

The roadmap's #1 contract notes sketched `useNavigation`/`useRoute`, but the static-check shapes table matches `object.method(stringLiteralArg)` call shapes (research.md: `NavCallShape = {object, method, argIndex}`). A destructured hook result (`const {navigate} = useNavigation(); navigate('x')`) is a bare call the table cannot see; a stable imported `nav` object keeps every navigation textually greppable and statically resolvable. This also matches how the LLM generation target works best: one obvious spelling, no hook-rules footguns inside event handlers (hooks can't be called there; `nav.navigate` can). Alternative considered: both a hook and an object — rejected, two spellings means the static checker misses one of them.

### D2: Nav state lives in an SDK-owned nav root component; `nav` is a module-scope emitter into it

`defineApp` stays a pure identity function. The SDK exports (internally, to the loader only — not in the mini-app-facing surface) a nav root that owns `useState`-backed stack state: initialized to `[spec.initial]`, renders `spec.screens[top]`. `nav.navigate`/`nav.back` post into a module-scope emitter the nav root subscribes to on mount. This mirrors the `interval` pattern (research.md: structural teardown, no registry) — iframe recreation destroys the emitter, the stack, and all subscriptions with the realm; no SDK-level cleanup logic exists to get wrong (T7).

The loader's `__whimAfterBundle` changes from `render(createElement(spec.screens[spec.initial]))` to `render(createElement(NavRoot, {spec}))`, resolved off the same host-injected `vc-sdk` global the bundle itself uses. The `mountedGen` once-per-generation guard is unchanged — the nav root mounts once; screen switching is React state inside it, never a re-mount of the root (so `delivery`/`paint` semantics are untouched; `paint` still fires once per generation).

### D3: Depth emission and back consumption follow the anchor comment verbatim

On every stack change the nav root posts `{__whimNavDepth:true, depth: stack.length - 1, generation: window.__whimGeneration}` via `parent.postMessage` (exactly the shape at loader.js:43-54; the outer page source-verifies and relays — research.md confirms `assemble.mjs` already does this). The nav root also adds an in-realm `message` listener for `{__whimNavBack:true}` and pops one entry (no-op at depth 0 — the host only forwards back when its own depth model says > 0, but the SDK must tolerate a stray frame). Listening to `message` inside the realm adds no authority (constraint 2: nothing stronger than `parent.postMessage` is held). Depth remains a hint: a hostile bundle can lie about depth, and the only consequence is its own back-button UX, because guaranteed exit is enforced host-side — this is the settled F4-shaped design, not a gap.

### D4: Static checking — one shipped row; runtime unknown-target is warn + no-op

`NAV_CALL_SHAPES` gains `{object:'nav', method:'navigate', argIndex:0}`. `nav.back()` has no target argument and gets no row (research.md open question, resolved: the table only models literal-target resolution). At runtime, `nav.navigate(x)` where `x` isn't a declared screen key: console warning + no-op. Rationale: the literal case is already a static *error* before the bundle ever runs; the residual dynamic case should degrade (warning is observable by the synthetic run harness via console capture) rather than crash a running app. Alternative — throw: rejected; it converts an LLM slip the checker already catches in the common case into a user-facing crash in the rare case.

### D5: Duplicate pushes are allowed

`nav.navigate('a')` from screen `a` pushes a second `a`. A stack is the simplest model to specify, generate against, and traverse; dedup heuristics create surprising back behavior. The harness bounds runaway stacks with its own interaction budget; the host's depth model is already resilient to arbitrary depth values.

## Risks / Trade-offs

- [Loader is containment surface] Any loader.js edit risks the isolation posture → the change adds no new frame kinds and touches no CSP/strip/nonce code; `npm run build` + `npm run invariants` (all 42 probes) + `npm run bridge:invariants` must be green in the gate; the diff to loader.js stays minimal (mount expression + nothing else).
- [Two spellings drift: anchor comment vs implementation] The loader anchor comment (43–54) becomes partially stale once real emission exists → update the comment in the same diff; the frame shapes themselves are already pinned by `NavDepthFrame`/`NavBackFrame` in `src/host/bridge/contract.ts` (type-only import into SDK if referenced — never executable across the seam).
- [SDK export budget creep] `nav` is one new export; `sdk-charts` (in-flight) is also adding exports → keep the barrel addition additive and isolated so the two changes don't collide textually in `src/sdk/index.tsx`'s export list (research.md flags `sdk-charts` as the only other in-flight change).
- [Depth desync between SDK stack and host model] e.g. dropped frame → tolerable by design: depth is a hint; worst case is back exiting one press early/late, and guaranteed exit still holds (`back-policy.ts` unhandled-press window). No mitigation code in the SDK.
- [Generation staleness] A late depth frame from generation N after reset to N+1 → host already ignores stale-generation reports (research.md: mini-app-back-navigation spec requirement); SDK stamps `window.__whimGeneration` per the anchor.

## Open Questions

None blocking. The exact internal naming of the nav root export (kept out of the mini-app-facing type surface) is an implementer choice.
