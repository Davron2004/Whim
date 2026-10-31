# Research digest: chain-22 (shell motion) — 2026-10-20, read-only

Sources: system.md §4 (:416-536; springs :437-446, rules :457-474, moments :481-509, Reduce Motion :514, honest
light :521); delta app-launcher spec :337 (opening grows from its tile), :402 (motion on Reanimated).

## Moments: state on integration/beta-2
| M | Def (system.md §4.4) | State |
|---|---|---|
| M2 open | `morph`; bg container grows from tile rect, plate tile-sized, WebView hidden until stamped paint/600 ms then 160 ms fade, "Opening…" at 1.5 s; reduced 160 ms cross-fade | PARTIAL: cover/plate fades, cap, label done (MiniAppView.tsx:386-409,477-492, chain-18). No growth, no tile rect (AppTile onPress has no rect, :162) |
| M3 close | `smooth` reverse into tile; reduced cross-fade | MISSING (`onExit` = goHome, LauncherRoot.tsx:3709) |
| M4 ghost→tile | `morph`, glow `spark`, circle-mask tint fill, glyph from 0.9 | MISSING |
| M5 leave running | `smooth`, sheet shrinks into its ghost tile, ember first | MISSING (MakingSheet.tsx:44 plain dismiss) |
| M6 composer→Describe | `morph`, capsule grows into the sheet, placeholder stays | MISSING (ComposerBar.tsx:68 press only) |
| M8 plan arrives | fade-in + `smooth`; skeleton swap, rows rise 8 px stagger first time, answered collapse | PARTIAL: skeletons only (PlanPage.tsx:270-294) |
| M9 Make it | `morph`: 48 ember → 128, plan out, words in, marker `snappy` | MISSING (MakingPage.tsx:152 static) |
| M10 Ready | `spark` flare 1→1.18→1 into 96 tile rising 0.6→1, texts 80 ms apart; reduced no flare | MOSTLY MISSING (Ember.spark + SPARK_PEAK exist; ReadyPage.tsx:53 static) |
| M12 menu | snappy lift 1.06, menu smooth 0.92→1 | DONE (AppTile.tsx:199-204, ContextMenu.tsx:193-258) |
| M14 toast | smooth rise 16, swipe fling | DONE (Toast.tsx:221-280); re-verify worklet safety |
| M16 orb | fling projection; reduced cross-fade | DONE (Orb.tsx:57,170-192) |
| M17 grid | smooth rise 8 + fade, stagger 30 ms over first 6 | MISSING (tokens exist tokens.ts:375-376, not in TimingName tokens-pure.ts:178) |
| M18 delete | tile → 0.8 + fade, neighbours reflow smooth, Undo reverses | MISSING (HomeScreen.tsx:172-185 purges set) |
| M20 honest light | 0.6 s smoothing, flicker 0.06·ã from token arrivals, stuck 0.35/1.5 s, out fade | PARTIAL: intensity/smoothing/stuck/out done (Ember.tsx:56-61,156-162; AppTile.tsx:110-115; Orb.tsx:233). Flicker MISSING; activity is a ~1 s sampled rate; no tile stalled state |
| M23 keyboard | keyboard curve | DONE (KeyboardShell; 16m ≤1-frame trail ruling pending) |
| M25 row edit | smooth grow to text area, Save/Cancel fade | MISSING |
| M26 History row | smooth layout expand | MISSING (HistoryScreen.tsx:529-556 instant) |

## Tokens/helpers
`springConfig(name)` → `{mass:1, stiffness, damping}` (tokens-pure.ts:160-163); `ACTIVITY_SMOOTHING` (:329);
`HONEST_LIGHT {base .55, gain .45, stuck .35, stuckEaseMs 1500}` (:326); `timing(name, reduced)` in motion.ts:20-27
(reduced → `ReduceMotion.Never`, needed because App.tsx:66 mounts ReducedMotionConfig System). Pattern:
`t.reduceMotion ? withTiming(x, timing('fadeIn', true)) : withSpring(x, springConfig(...))`. Worklet gotcha: never
call `springConfig`/`timing` inside a gesture worklet (iOS crash) — hoist to module constants (Sheet.tsx:360,
Toast.tsx:172, Orb.tsx:57). No stagger, flicker or layout-transition helper yet.

## 22.4 red set
RN `Animated`/`LayoutAnimation`/`useNativeDriver` in production src/host: zero. 14 files import Reanimated's default
`Animated` → the check must key on the import SOURCE, not `\bAnimated\b`. Literal springs already enforced
(design-system.suite.ts:120,:289).

## Activity source
`RunSignals` (prompt-flow.ts:614-619): aggregates.tokens, lastTokenAt, lastThinkingAt, lastFrameAt; `sampleLive`
(home-live.ts:43-62) samples ~1 s (`useHomeLive`, LauncherRoot.tsx:1180). Consumers: Home tile (HomeScreen.tsx:298),
MakingPage ember/AmbientLight (:150-152), orb changing (LauncherRoot.tsx:344).

## Tests
`src/host/launcher/test/native-reanimated.tsx` double: records animations, jumps to end, `holdAnimations()`; only
`Animated.View`; no layout transitions/measure/useAnimatedReaction/interpolate → must be extended for M17/M18/M26.

## Split (dispatcher's plan)
1. 22a — 22.4 skeleton: import-source ban in design-system.suite.ts; extend the Reanimated double (layout
   transitions, Text/ScrollView, interpolate, useAnimatedReaction); stagger timing in TimingName + helper. No device.
2. 22b — 22.2 honest light: flicker from token ARRIVALS pushed per stream frame (not the 1 s tick; "last 500 ms"
   needs arrival times), pure math in tokens-pure/home-live; tile stalled state (40 s). Reviewer (stream data path).
3. 22c — Home grid: M17, M18 (+Undo reversal), M4. Device.
4. 22d — in-sheet: M8, M25, M10.
5. 22e — cross-surface morphs: M6, M9, M5 on a root overlay layer (shared rect), not the sheet animating its own frame.
6. 22f — M2/M3 open/close morph (riskiest: carry the tile rect in MiniAppLaunch; container is `bg`, never tint; WebView
   covered, never hidden/resized; never pop then unmount/replace the native stack mid-animation; keep the
   onStackSettled/POP_FALLBACK_MS wait). Reviewer + device + tap-to-first-paint measurement.
7. 22g — M26 History expand + 22.5 0.25× recordings (emulator-5560 + iOS 27 sim).
Reduce Motion pair tests live in each component's suite; 22a's check asserts the import ban only.
Open: AND-M2 (progress.md:185) — check whether it touches M2 before 22f.
