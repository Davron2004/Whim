# Context chains: shell-redesign-v2

<!--
  Groups A–I from tasks.md, one chain each. Ownership rule for this change: every file below
  is written by exactly one chain. Where two groups needed the same file the ordering is
  declared, never left to the merge.

  Three shared files drove the whole graph and are worth stating up front:
    - `src/host/launcher/copy.ts` is written ONLY by chain-B, which seeds every v2 string in one
      pass. D, E, F and G read it and add none of their own. This is what lets four screen chains
      run without colliding on the copy table.
    - `src/host/launcher/LauncherRoot.tsx` and `HomeScreen.tsx` are chain-D's exclusive property.
      E, F and G never edit them; anything they need from the shell is declared in D's contract or
      consumed from theirs.
    - `src/host/launcher/test/acceptance.ts` is the launcher suite registry (no npm script may be
      added — package.json is Class 2). Three chains register a new suite into it (B, F, G), so
      those three are serialized: B → F → G.

  Waves the dispatcher can run: [A] → [B, C] → [E, F] → [D, G] → [I]. H is file-disjoint from
  everything and can run at any point.
-->

## chain-A: v2-tokens-and-app-colour

- tasks: A1, A2, A3, A4, A5, A6, A7, A8
- rationale: Everything else resolves a token, so this lands first and alone. It is also the only
  chain that both deletes a shipped feature (the six presets, ten accents, shape variants) and
  introduces the symbol three later chains import (`appColor`). Keeping the deletion and the
  replacement in one head avoids a window where `theme.suite.ts` asserts over a catalogue that no
  longer exists. **This chain is already in flight** — its tasks are written as a specification of
  record, so the implementer verifies the end state rather than re-applying edits.
- reads: `specs/sdk-design-system/spec.md` §"The shell token set is fixed, v2, and not themeable",
  §"Three faces carry the whole type system", §"One deterministic app-colour function…",
  §"Components resolve semantic tokens through the active theme"; `specs/app-launcher/spec.md`
  §"Highlighting can be switched off" + the REMOVED theme-preference block; `design.md` §D5, §D6,
  §D8. handoff: none
- writes-contract: `handoff/tokens.md` — the exported token names and their v2 values verbatim, the
  three face names as Android resolves them, the `appColor(name): string` signature plus its palette
  invariant (never a status hue, `accent`, or `yours`), the reduced `WhimTheme`/`ThemePref` shapes,
  and the key + accessor for the persisted highlighting flag.
- owns: `src/sdk/theme.ts`, `src/sdk/tokens.ts`, `src/host/launcher/theme.ts`,
  `src/host/launcher/theme-context.tsx`, `src/host/launcher/SettingsScreen.tsx`,
  `src/host/launcher/test/theme.suite.ts`, `android/app/src/main/assets/fonts/**`, `assets/fonts/**`

## chain-B: whim-syntax-and-copy

- tasks: B1, B2, B3, B4, B5, B6
- rationale: The lexer, the renderer, the cap enforcement and the off-switch are one rule set; split
  across implementers the rules diverge, which is the exact failure the design's "implement it as a
  shared renderer, not per-screen" instruction exists to prevent. The v2 copy table is seeded here
  too, deliberately: it lands before any screen chain starts, so D/E/F/G read strings rather than
  writing them, and the verbatim-copy discipline is enforced by one diff instead of four.
- reads: `specs/app-launcher/spec.md` §"Shell prose renders through one shared Whim Syntax
  renderer", §"Four Whim Syntax classes are lexed deterministically on the device",
  §"Highlighting can be switched off"; `specs/sdk-design-system/spec.md` §"Three faces carry the
  whole type system"; `design.md` §D7. handoff: `handoff/tokens.md`
- writes-contract: `handoff/whim-prose.md` — the exported lexer and renderer signatures, the `Mark`
  and `Span` types verbatim, the six class names, which caps the renderer enforces (and that
  over-cap marks flatten rather than truncate), how the off-switch is read, and the `COPY` keys
  every later chain must use rather than inventing a string.
- after: chain-A
- owns: `src/host/ui/whim-prose/**`, `src/host/launcher/copy.ts`,
  `src/host/launcher/test/whim-prose.suite.ts`, the registration line it adds to
  `src/host/launcher/test/acceptance.ts`

## chain-C: contract-server-clarify-summariser

- tasks: C1, C2, C3, C4, C5, C6, C7, C8, C9, C10, C11
- rationale: One wire seam, changed once. Clarify, the summary field, the plan rows and `tileColor`
  extraction all cross the same `contract/` → `server/` boundary, and splitting them would mean two
  implementers editing `contract/src/index.ts` and the record-assembly path in parallel. Oversized
  against the 3–7 guideline on purpose: the schemas and the producers that fill them are one
  reviewable unit, and the ratified invariants at risk here (the `stage` enum, exactly-one-terminal)
  are easiest to hold intact when one head owns every edit near them.
- reads: `specs/generation-contract/spec.md` (all four requirements);
  `specs/generation-server/spec.md` (all four requirements); `specs/generation-pipeline/spec.md`
  (all three requirements); `specs/sdk-design-system/spec.md` §"An app declares its one tile
  colour"; `design.md` §D1, §D2, §D4, §D10. handoff: `handoff/tokens.md` (the reserved hues a
  declared colour may not claim)
- writes-contract: `handoff/wire-v2.md` — the `ClarifyRequest`/`ClarifyResponse`,
  `clarifications`, `RewriteResponse.plan`, and `result.summary` shapes verbatim (including the
  `kind` closed set and the `marks` offset semantics), which fields are optional and what each
  absence means, where `tileColor` sits inside the manifest, and the `/v1/clarify` route's method,
  status codes and error body.
- after: chain-A
- owns: `contract/src/index.ts`, `server/src/**`, `server/test/**`, `src/sdk/index.tsx`

## chain-E: history-4a

- tasks: E1, E2, E3, E4, E5, E6, E7, E8, E9, E10
- rationale: The whole `4a` surface — rows, expansion, filters, confirm sheets — plus the pure
  decision logic behind it, in files no other chain touches. Runs in parallel with chain-F because
  they are file-disjoint, and ahead of chain-D because D only routes to this screen and does not
  render it. **Constraint:** this chain SHALL preserve `HistoryScreen`'s existing exported props
  signature. If the redesign genuinely requires a different signature, that is chain-D's file to
  change and must be raised, not worked around.
- reads: `specs/version-history/spec.md` (all requirements, including both REMOVED blocks);
  `specs/app-launcher/spec.md` §"A tile's colour is the app's declared colour…" (for the header's
  app hue); `design.md` §D11. handoff: `handoff/whim-prose.md`, `handoff/wire-v2.md`,
  `handoff/tokens.md`
- writes-contract: none — nothing downstream consumes this chain's outputs.
- after: chain-B, chain-C
- owns: `src/host/launcher/HistoryScreen.tsx`, `src/host/launcher/history-logic.ts`,
  `src/host/launcher/test/history-logic.suite.ts`, `src/host/launcher/test/history-ui.spec.md`

## chain-F: tile-colour-and-2b-tile

- tasks: F1, F2, F3, F4, F5, F6
- rationale: The declared-colour plumbing from the host-held manifest down to the pixel, plus the
  `2b` tile component itself. It must land before chain-D because D's home grid renders this
  chain's `AppTile` and D's skeleton imports its exported size constants — a parallel D would fail
  its own typecheck against a file that does not exist yet. It is after chain-B only because both
  register a suite into the launcher's single acceptance entry point.
- reads: `specs/app-launcher/spec.md` §"App tiles use the ghost-letterform treatment", §"A tile's
  colour is the app's declared colour, with a deterministic fallback";
  `specs/sdk-design-system/spec.md` §"An app declares its one tile colour", §"One deterministic
  app-colour function…"; `design.md` §D4, §D6. handoff: `handoff/tokens.md`, `handoff/wire-v2.md`
- writes-contract: `handoff/tile.md` — the `AppTile` component's props, its exported size constants
  (the ones a skeleton must import rather than restate), the colour-resolution helper's signature
  and its fallback order, the extended `AppManifest` field, and the wire→record mapping function's
  signature.
- after: chain-B, chain-C
- owns: `src/host/bridge/contract.ts`, `src/host/launcher/tiles.ts`,
  `src/host/launcher/app-tile.tsx`, the new record-mapping module under `src/host/launcher/`,
  `src/host/launcher/test/tile-colour.suite.ts`, the registration line it adds to
  `src/host/launcher/test/acceptance.ts`

## chain-D: launcher-2a-flow

- tasks: D1, D2, D3, D4, D5, D6, D7, D8, D9, D10, D11
- rationale: `LauncherRoot.tsx` is a hand-rolled screen union with no navigation library, so the
  five-step flow is a restructure of that union rather than a set of leaf components. One
  implementer owns it end to end, together with the home screen it starts from and the envelope
  bump it writes. This is the chain every other screen chain plugs into, which is why it runs last
  among the shell chains: by the time it starts, the renderer, the wire shapes and the tile all
  exist and are declared.
- reads: `specs/prompt-flow/spec.md` (all requirements, including the REMOVED two-stage block);
  `specs/app-launcher/spec.md` §"The create affordance and per-app re-prompt action open the prompt
  flow"; `specs/sdk-design-system/spec.md` §"Loading skeletons derive their geometry from exported
  component constants"; `specs/mini-app-versioning/spec.md`; `design.md` §D3, §D9, §D10.
  handoff: `handoff/tokens.md`, `handoff/whim-prose.md`, `handoff/wire-v2.md`, `handoff/tile.md`
- writes-contract: `handoff/shell-routes.md` — the `Screen` union's members after the restructure,
  which screen component each routes to and with what props, and the envelope helper's signature.
  Recorded even though no chain in this change consumes it: it is the shell's routing contract and
  the next change starts from it.
- after: chain-B, chain-C, chain-F
- owns: `src/host/launcher/LauncherRoot.tsx`, `src/host/launcher/HomeScreen.tsx`,
  `src/host/launcher/prompt-envelope.ts`, `src/host/launcher/generation-request.ts`, the new
  compose/clarify/plan/build/done screen modules and the skeleton modules under
  `src/host/launcher/`, the retired `PromptScreen.tsx` / `RewritePreviewScreen.tsx` /
  `GeneratingScreen.tsx`, `src/host/launcher/test/prompt-flow-screens.suite.ts`,
  `src/host/launcher/test/prompt-flow-wiring.suite.ts`

## chain-G: orb-tapped-menu

- tasks: G1, G2, G3, G4, G5
- rationale: The orb lives inside a running mini-app, not in the launcher's screen union, so it is
  file-disjoint from chain-D and runs beside it. Small by design: the wheel gesture is explicitly
  not built, so this chain is a menu, a persistence call and the negative assertions that keep the
  unbuilt gesture from being advertised. It is sequenced after chain-F purely because both register
  a suite into the launcher's single acceptance entry point.
- reads: `specs/app-launcher/spec.md` §"The orb is a tapped menu whose actions are instrumented";
  `design.md` §D12. handoff: `handoff/tokens.md`, `handoff/whim-prose.md`
- writes-contract: none.
- after: chain-B, chain-F
- owns: `src/host/launcher/FloatingExit.tsx` (replaced by the orb),
  `src/host/launcher/MiniAppView.tsx`, the orb menu + instrumentation modules under
  `src/host/launcher/`, `src/host/launcher/test/orb-menu.suite.ts`, the registration line it adds to
  `src/host/launcher/test/acceptance.ts`

## chain-H: docs

- tasks: H1, H2
- rationale: Two documentation files, disjoint from every code chain, so the dispatcher can run it
  whenever. Kept separate rather than folded into chain-A because the decisions it records span all
  seven groups, and a decision log entry written mid-implementation records intent rather than
  outcome.
- reads: `proposal.md`, `design.md` §D1–§D5. handoff: none
- writes-contract: none.
- owns: `docs/decisions.md`, `docs/capabilities.md`

## chain-I: on-device acceptance

- tasks: I1
- rationale: **Attended only.** The authoritative verdict for fonts, the live `2a` flow against the
  dev server, and the orb's touch behaviour is the real Android System WebView and the real device —
  desktop Chromium and the Node suites structurally cannot see a font falling back to Roboto. Not
  dispatchable to a subagent: it needs the emulator, the release build and a human reading the
  screen.
- reads: `tasks.md` §I. handoff: none
- writes-contract: none.
- after: chain-D, chain-E, chain-G
