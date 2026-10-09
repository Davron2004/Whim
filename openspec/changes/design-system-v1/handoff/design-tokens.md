# Contract: design-tokens (chain-1)

Interface only. Values live in `src/design/tokens.ts`; `docs/design/system.md` §2 and §4.2 print them.
## `src/design/tokens.ts` — pure data, no import of any kind

```ts
type Scheme = 'light' | 'dark';                       SCHEMES: readonly Scheme[]
interface Pair<T = string> { readonly light: T; readonly dark: T }
NEUTRAL_ROLES  // bg surface sheet sheet-group raised fill fill-strong thumb separator border text text-2 text-3 ink on-ink scrim
               //   each { light, dark, use, material? }   (scrim is an rgba() string, the rest #RRGGBB)
EMBER_ROLES    // ember on-ember ember-text ember-soft — { light, dark, use }
GLOW           // { core, mid, edge, halo }  same in both schemes; halo = 'rgba(255,145,39,0.45)'
STATUS_NAMES   // ['positive', 'danger', 'warning'];  type StatusName
STATUS[name]   // { fill: Pair, on: Pair, text: Pair, soft: Pair, icon: 'check'|'circle-alert'|'triangle-alert', use }
type ColorRole = NeutralRole | EmberRole | StatusName | `on-${StatusName}` | `${StatusName}-text` | `${StatusName}-soft`
COLORS: Record<Scheme, Record<ColorRole, string>>      // the flattened roles per scheme (D2's TOKENS.light|dark)
TINT_NAMES     // ['slate','stone','ocean','blue','indigo','violet','purple','orchid','berry','rose'] (table order)
type TintName;  TINTS: Record<TintName, Pair>          // light value / dark value
ON_TINT: Pair  // '#FFFFFF' / '#1A1614';   ON_PLATE = '#FFFFFF'
TINT_SOFT: Pair<{ alpha: number; over: NeutralRole }>  // light 0.12 over surface, dark 0.18 over raised
TILE_RIM = { mix: 0.5, width: 1.5 }                    // dark-mode rim = mix(dark, light, 0.5)
interface ContrastRule { fg: ColorRole; on: readonly ColorRole[]; floor: number }
CONTRAST_RULES: readonly ContrastRule[]                 // every pair §2 gives a floor; text-3 exempt
TINT_CONTRAST_FLOORS = { onTint: 4.5, text: 4.5, rim: 3 }
TINT_SEPARATION_FLOORS = { reserved: 20, tint: 10 }    // CIEDE2000, normal vision
type TypeToken = 'display'|'largeTitle'|'title1'|'title2'|'title3'|'headline'|'body'|'callout'|'footnote'|'caption'
type SdkTextSize = 'display'|'title'|'subtitle'|'body'|'caption'
TYPE_SCALE: Record<TypeToken, { size, lineHeight, weight, headerWeight?, tracking /* em */, use, sdk?: SdkTextSize }>
SPACE = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 }
SDK_SPACE = { xs: 4, sm: 8, md: 12, lg: 20, xl: 32 }
LAYOUT  // §2.8 constants: gutter, cardPadding(Hero), listRow*, separatorInset(WithIcon), gap*, actionArea*,
        // buttonHeight { large, medium, small }, touchTarget { ios, android }, minHitVisual, smallTargetGap, headerRowHeight
RADII = { xs|sm|md|lg|xl|full: { radius, use } }        // 6 10 14 20 28 999
SDK_RADII = { sm: 10, md: 14, lg: 20 }
SHAPE = { minConcentricRadius: 6, continuousCurveFrom: 10, tileCorner: 0.225 }
SHADOWS = { 'shadow-raised' | 'shadow-floating' | 'glow-ember': Pair }   // RN boxShadow = CSS box-shadow strings
TOP_HIGHLIGHT: Pair                                     // 'transparent' / 'rgba(255,255,255,0.06)'
type SpringName = 'instant'|'snappy'|'smooth'|'fling'|'morph'|'spark'
interface Spring { response; dampingRatio; stiffness; damping; use }   // mass 1, physics mode
SPRINGS: Record<SpringName, Spring>                     // stiffness = (2π/response)², damping = 4π·ζ/response
TIMINGS = { fadeIn: 160, fadeOut: 120, fadeEasing, color: 150, colorEasing, staggerPerItem: 30,
            staggerFirst: 6, breatheCycle: 1900, breatheOpacity: { from: 0.34, to: 0.72 }, breatheDelay: 300 }
```

## `src/design/tints.ts` — pure functions over `tokens.ts`

```ts
TINT_ALIASES: Record<string, TintName>                  // exactly system.md §2.4's alias list (test-enforced)
isTintName(value: unknown): value is TintName
fallbackTint(appId: string): TintName                   // djb2(appId) % 10, table order — appColor's hash
interface TintResolution { tint: TintName; diagnostic?: string }
resolveTint(name: unknown, appId: string): TintResolution
  // trim + lowercase; one of the ten → no diagnostic; alias → its tint + diagnostic;
  // anything else (incl. non-strings) → fallbackTint(appId) + diagnostic. Never throws.
nearestTint(hex: string): TintName | undefined          // nearest light value by CIEDE2000; undefined if not #rgb/#rrggbb
assignTint(ranked: readonly TintName[], used: readonly TintName[]): TintName
  // used = every installed app's tint, repeats count. First ranked tint with zero uses; else the
  // least-used of all ten, ties → ranked order, then table order.
farthestTint(original: TintName, used: readonly TintName[]): TintName
  // among the least-used tints, the farthest (CIEDE2000, light values) from original; ties → table order
contrastRatio(a: string, b: string): number             // WCAG 2.2; throws Error('not a hex colour: …') on a non-hex
mixHex(a: string, b: string, weight: number): string    // '#RRGGBB'; per 8-bit channel, ties round up
type Lab = readonly [number, number, number];  labFromHex(hex): Lab;  ciede2000(a: Lab, b: Lab): number
deltaE(a: string, b: string): number                    // CIEDE2000 of two hex colours
```

## Generated outputs (`npm run tokens`; never hand-edit)

| File | Kind | Content |
|---|---|---|
| `src/design/generated/springs.ts` | whole | `SAMPLED_SPRINGS: Record<SpringName, SampledSpring>` |
| `src/design/generated/page.mjs` | whole | `export const PAGE_BG` — the light `bg` (read by `build/assemble.mjs`) |
| `docs/design/system-v1/palette.json` | whole | the palette proof's input; `palette-check.py` holds no value of its own |
| `docs/design/system.md` | regions | `roles ember status tints type space layout shape shadows springs timings` |
| `docs/design/mockups/index.html` | region | `mockup` (inside `const TOKENS = {`; `device` stays hand-written) |

```ts
interface SampledSpring {
  durationMs: number; t95Ms: number;   // settled = first 60 Hz frame from which |x−1| < 0.001 and |v| < 0.01/s
  overshoot: number;                   // peak past target, fraction (0 for ζ ≥ 1)
  linear: string;                      // 'linear(0, …, 1)': one point per 60 Hz frame, 3 decimals, last = 1
  cubicBezier: string;                 // least-squares nearest; y ≤ 1 when the spring does not overshoot
}
```

Marker syntax: a line containing `tokens:begin <name>` and a later line containing `tokens:end <name>`, in
any comment syntax (`<!-- tokens:begin roles -->`, `// tokens:begin mockup`). Lines between are replaced;
marker lines are kept. A new region = markers + a renderer in `REGIONS` (`scripts/lib/design-tokens.ts`).

## CLI

- `npm run tokens` writes every output that differs (exit 1 if a marker or file is missing);
  `npm run tokens -- --check` — writes nothing; exit 1 with one stderr line per drift:
  `tokens drift: <file> [<region>]: row <cell 1>, column "<header>": the file has "<x>", the token module gives "<y>"`
  (non-table lines: `line <n>: the file has …`). The fast gate runs it through `checks:test`.
- Core (pure, importable from suites): `scripts/lib/design-tokens.ts` — `renderOutputs(read)`,
  `checkOutputs(read): Drift[]`, `formatDrift`, `reservedColors(scheme)`, `tileRim(pair)`,
  `tintSoft(scheme, value)`, `sampleSpring(spring)`, path constants `SYSTEM_MD MOCKUP_HTML PALETTE_JSON SPRINGS_TS PAGE_MJS`.

## Runtime page (`build/assemble.mjs`)

- `paint` forwarded to RN: `{ kind: 'paint', trusted: true, payload: { ...loaderPayload, generation: GEN } }` —
  `GEN` is the host-bound generation (`reinject({ generation })`), exactly as for `nav-depth`; the loader's
  own fields (`mountToFirstPaintMs`, `appName`) are kept; the iframe-local counter never reaches the host.
  The host does NOT fence on it yet (task 18.2 does; `boot-state.ts` documents the current reasoning).
- Canvas: outer page (no-diagnostics mode), iframe element and srcdoc `html,body` paint
  `theme.colors.bg` when it matches `/^#[0-9a-fA-F]{6}$/`, else `PAGE_BG`. Applied at `reinject`, before
  the iframe is created. Both documents set `color-scheme: light dark`. Viewport:
  `width=device-width, initial-scale=1` (no `maximum-scale`). CSP unchanged; no new frame kind.

## Invariants (gate-enforced in `checks/test/repo/design-system.suite.ts`)

- Files under `src/design/**` import only from inside `src/design/` (no RN, DOM, Node or app import);
  `tokens.ts` exports no function.
- No colour hex literal or spring-config literal (`stiffness|damping|dampingRatio|mass|tension|friction|bounciness: <number>`)
  in product files of `src/host/**` or `src/sdk/**` (test folders exempt). Legacy files are listed in the
  suite's `EXEMPT` with a reason; an exempt file with no hit fails the suite, so remove its entry when a
  chain clears it. New design checks go inside this suite, never as a new registration in `acceptance.ts`.
- Every `CONTRAST_RULES` pair and every tint floor holds in both schemes; every tint ≥ 20 from each
  `reservedColors(scheme)` value and ≥ 10 from every other tint (CIEDE2000).
