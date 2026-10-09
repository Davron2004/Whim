# Contract: generator (chain-13)

Interface only. Sources: `checks/passes/manifest-extraction.ts`, `checks/contract.ts`,
`server/src/generation/stages/check.ts`, `server/src/generation/prompts/index.ts`, `server/src/flowbench/`.

## Manifest fields (one extraction — the `defineApp` literal, never a second parse)

```ts
// checks/contract.ts — ExtractedManifest gains (all optional):
tileColor?: string;                      // legacy, carried verbatim and UNVALIDATED (no hex / reserved-hue check)
tint?: TintName[];                       // 1–3, ranked as declared, aliases applied, unknown dropped, deduped
icon?: GlyphName | 'circle';             // resolveGlyph(declared, appName): glyph set only, never a chrome name
```

- Declared shapes: `tint: 'rose'` or `tint: ['rose', 'stone', …]` (string literals); `icon: 'coffee'`.
- Tint: `trim().toLowerCase()`; one of `TINT_NAMES` → kept; own key of `TINT_ALIASES` → its tint
  (`tint_alias`); anything else (unknown name, non-string, non-literal) → dropped (`tint_fallback`).
  After resolution: duplicates removed, first three kept. Nothing resolved → no `tint` key; the
  device falls back with `fallbackTint(appId)` / `assignTint` (the server has no app id).
- Icon: `resolveGlyph(name, manifest.name)` — exact glyph → no diagnostic; alias into the glyph set
  → `icon_alias`; keyword on the name's words, then the app name's → `icon_keyword`; else `'circle'`
  (`icon_fallback`). A non-string / non-literal icon → no `icon` key + `icon_fallback`.
- No declaration → no key, no diagnostic.
- Server `CheckedManifest.manifest` = the extracted manifest minus `name`/`schema`, verbatim
  (`validTileColor` and the server `RESERVED_HUES` are deleted). So the wire record carries
  `manifest.tint`, `manifest.icon`, `manifest.tileColor` exactly as above, never top-level
  (`contract/src/index.ts` `WireAppRecord` comment).

## Diagnostic kinds (closed `DIAGNOSTIC_KINDS`, additive)

```ts
'tint_alias' | 'tint_fallback' | 'icon_alias' | 'icon_keyword' | 'icon_fallback'   // severity: 'warning', always
export const TILE_DIAGNOSTIC_KINDS;  export type TileDiagnosticKind;              // checks/contract.ts
```

- `runStaticChecks(source).diagnostics` carries them (line/column of the offending literal,
  `symbol: 'tint' | 'icon'`, non-empty `hint`). The icon kinds and `message` are the glyph
  resolver's own (`IconDiagnostic`). They never make `manifest` absent and are never `error`.
- The server check stage removes every `TILE_DIAGNOSTIC_KINDS` member from the `diagnostics` it
  hands the machine (so a name never streams a `diagnostic` event, never costs a warning repair) and
  logs them: `scope: 'check'`, `{ kinds: string[] }`, msg `'tile names resolved'`.
- Consumers that read `runStaticChecks` directly (evals Tier A, synthrun, flowbench) see them;
  Tier A fails only on `error`, so they never fail a case.

## Prompt sections changed (`server/src/generation/prompts/index.ts`)

| Turn | Change |
|---|---|
| rewrite | `PLAN_ROW_LABELS` removed. Plan-row rules: label = a part of this app, ≤ 3 words, sentence case, no fixed set; text ≤ 2 sentences, ~140 chars, no detail not asked for. Every listed question stays on the page: no row states/restates/decides one; a delegated question stays undecided in `rewrittenPrompt` too; answered ones are honoured in `rewrittenPrompt`. |
| clarify | Options: the answer itself, ≤ `CLARIFY_OPTION_MAX_CHARS` (40). Limit reason: "an app made here", never "mini-app". |
| rewrite + clarify | `MINI_APP_LIMITS_TEXT` opens "An app made here runs on this one phone only." |
| all turns' answer list | Header now neutral ("These questions were put to the user…"); rows unchanged (`→ the user asked Whim to decide`). |
| generate | "Decide every question the user left to you … Follow every answered question." Layout recipe (Card/Text/ProgressBar/Badge/SegmentedControl) removed → "leave spacing, colours and sizes at the SDK's defaults". New `TILE_IDENTITY_SECTION` right after the instructions. |
| generate/plan edit turns | `IDENTITY_CONTINUITY` adds "Keep its `tint` and `icon` exactly as they are unless this request asks to change how its tile looks." |

```ts
export const CLARIFY_OPTION_MAX_CHARS = 40;
export const TILE_IDENTITY_SECTION: string;  // built from TINT_NAMES + GLYPH_GROUPS, never a hand copy:
// shape line (`tint: ['<tint>', …]`, `icon: '<glyph>'`, "Never declare `tileColor`"),
// "Tints: <TINT_NAMES joined ', '>.", "- <Group>: <glyphs joined ', '>" per group, then four rules:
// 1 glyph for what the app is about (list only) · 2 rank ≤ 3 tints by the subject's feeling ·
// 3 `name` ≤ 24 characters · 4 when changing, keep tint and icon unless asked.
```

The SDK reference (`docs/sdk-reference.md`) and few-shot fixtures are NOT changed here (chain-23);
the fixtures still declare `tileColor`, which the tile section tells the model not to copy.

## Eval (`server/flowbench.mjs`; corpus `evals/sets/visible/manifest.json`)

```ts
EvalCase.change?: string                      // after a result, POST /v1/generate { prompt: change, app: { source, manifest, schema } }
export const OPTION_MAX_CHARS = 40            // report.ts; prompts suite + flowbench suite tie it to the clarify prompt
CaseReport.options: { count: number; long: string[] }          // clarify options, those over the cap
CaseReport.tile?: { tint?: string[]; icon?: string; tintValid: boolean; iconValid: boolean }
CaseReport.change?: { prompt; generate: GenerateReport; tile?; kept?: boolean }
CaseOutcome failure phase += 'change'          // a change that delivers nothing fails the case (exit 1)
summary.options: { total; long }
summary.tiles: { delivered; validTint; validIcon; invalidIconRate; changes; kept }   // delivered counts first builds + changes
```

- Valid = declared and exactly a set name: no `tint_*` / `icon_*` diagnostic from
  `runStaticChecks(app.source)`, and the manifest field present. `kept` = same `tint` array and `icon`.
- Corpus: `change` on `tip-splitter-p1`, `habit-tracker-p2`, `water-counter-p1`; new vague case
  `workout-log-p3` ("help me plan my workouts") to exercise clarify options. Live rates are an
  attended flowbench run — no test calls a model.
