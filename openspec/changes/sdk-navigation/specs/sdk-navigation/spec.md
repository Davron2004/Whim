# sdk-navigation Specification

## ADDED Requirements

### Requirement: Mini-apps navigate via the `nav` object

The SDK SHALL export a stable `nav` object with exactly two methods in v1: `nav.navigate(screenName: string): void` (push) and `nav.back(): void` (pop). Navigation targets SHALL be screen names declared in `AppSpec.screens`; no parameters beyond the target name are accepted (params-passing is out of scope for v1). The SDK SHALL NOT export any other navigation spelling (no hook variant) — one statically checkable call shape only.

#### Scenario: Push and render

- **WHEN** a mini-app calls `nav.navigate('Detail')` and `'Detail'` is a key of `spec.screens`
- **THEN** the runtime renders `spec.screens['Detail']` and the previous screen is retained on the stack

#### Scenario: Pop and render

- **WHEN** a mini-app at depth ≥ 1 calls `nav.back()`
- **THEN** the top entry is popped and the runtime renders the new top of the stack

#### Scenario: Callable from event handlers

- **WHEN** `nav.navigate('Detail')` is invoked inside a `Button` `onPress` handler (not during render)
- **THEN** navigation occurs without hook-rules violations or warnings

### Requirement: Navigation is a stack rooted at `initial`

The nav stack SHALL initialize to `[spec.initial]` (depth 0) at mount. `navigate` SHALL push (duplicate targets allowed — pushing the current screen again is legal and deepens the stack); `back` SHALL pop one entry and SHALL be a no-op at depth 0. Screen switching SHALL be React state inside a single mounted nav root: the root mounts once per generation (`paint` fires once; `delivery` semantics unchanged), and switching screens SHALL NOT re-mount the root or re-deliver the bundle.

#### Scenario: Back at depth 0 is a no-op

- **WHEN** `nav.back()` is called while the stack is `[initial]`
- **THEN** the stack is unchanged and no error or warning is produced

#### Scenario: Duplicate push

- **WHEN** screen `'Home'` is on top and the app calls `nav.navigate('Home')`
- **THEN** the stack gains a second `'Home'` entry and one `nav.back()` returns to the first

### Requirement: Depth changes emit the untrusted depth hint

On every stack-length change the SDK SHALL post `{__whimNavDepth: true, depth: <stack.length - 1>, generation: window.__whimGeneration}` via `parent.postMessage`, matching the `NavDepthFrame` shape in `src/host/bridge/contract.ts` verbatim. Depth reports remain untrusted hints (never authority): the frame SHALL NOT be nonce-authenticated, and no host trust decision may depend on its accuracy — guaranteed exit stays enforced host-side by `back-policy.ts` regardless of what the SDK reports.

#### Scenario: Depth hint on push

- **WHEN** a mini-app navigates from depth 0 to depth 1
- **THEN** a `__whimNavDepth` frame with `depth: 1` and the current generation is posted to the parent

#### Scenario: Lying about depth is harmless

- **WHEN** a hostile bundle posts forged `__whimNavDepth` frames with arbitrary depth values
- **THEN** the only affected behavior is that app's own back-button UX; host guaranteed-exit and containment are unaffected

### Requirement: System back pops the stack

The SDK nav root SHALL listen in-realm for the host's `{__whimNavBack: true}` frame and pop exactly one entry per frame. A `__whimNavBack` frame arriving at depth 0 SHALL be tolerated as a no-op (the host normally exits instead of forwarding at depth 0, but a stray frame must not throw). The listener SHALL confer no authority beyond what the SDK already holds (`parent.postMessage` only — spike2 constraint 2).

#### Scenario: System back at depth 1

- **WHEN** the host posts `__whimNavBack` into the realm while the app is at depth 1
- **THEN** the stack pops to depth 0, the initial screen renders, and a `__whimNavDepth` frame with `depth: 0` is emitted

### Requirement: Unknown targets degrade, never crash

`nav.navigate(target)` where `target` is not a key of `spec.screens` SHALL be a no-op that emits a console warning naming the unknown target and the declared screens. It SHALL NOT throw. (The string-literal case is already a static error via the screen-graph check; this covers the residual dynamic case at runtime.)

#### Scenario: Dynamic unknown target

- **WHEN** a running app calls `nav.navigate(someVariable)` and the value names no declared screen
- **THEN** the current screen stays mounted and a console warning lists the unknown target and the declared screen names

### Requirement: Navigation adds no containment surface

The navigation implementation SHALL NOT modify the CSP, the global strip, the nonce-authenticated frame vocabulary, or any host-side file (`back-policy.ts`, `useMiniAppHost.ts`, `src/host/bridge/contract.ts`, `build/assemble.mjs`). All nav state SHALL live inside the sandbox realm so that realm reset (iframe recreation) structurally destroys the stack, the emitter, and all listeners with no SDK-level cleanup logic (T7; the `interval` pattern, decision #43/D2). Any nav-related type shared with the host bridge SHALL cross the SDK↔host seam as `import type` only.

#### Scenario: Realm reset clears nav state

- **WHEN** the host performs a realm reset (iframe recreation) while an app is at depth 3
- **THEN** the next generation mounts at depth 0 with a fresh stack and no listener or emitter from the previous realm survives

#### Scenario: Invariants stay green

- **WHEN** `npm run build` then `npm run invariants` and `npm run bridge:invariants` run after this change
- **THEN** all sandbox-isolation and bridge invariant probes pass unchanged
