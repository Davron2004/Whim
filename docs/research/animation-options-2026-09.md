# Animation for Whim: options and a recommendation

Four sweeps came back. They agree more than they disagree, and where they disagree I checked the primary source. The short version: adopt Reanimated 4.6 on the host, pinned exact, build the mini-app motion layer out of the Web Animations API with zero new dependencies inside the sandbox, skip every vector-player and 3D runtime, and don't build a mascot. The orb is already the mascot.

## 1. Constraints that decide everything

Six facts about this repo eliminate most of the option space before any taste enters.

**Bare RN 0.85.3, React 19.2.3, new arch on, Hermes, arm64-only.** No `expo` package anywhere in `package.json`. Anything shipped as an Expo module (expo-gl, expo-three, expo-asset) costs an `expo-modules-core` adoption first. That alone disqualifies the R3F-on-native path that sweep 2 spent its longest section on. New-arch-on is the happy case for everything modern and the unhappy case for `LayoutAnimation`, which is a documented no-op on Fabric.

**No navigation library, and screens switch by an `if` chain** in `LauncherRoot.tsx:1014-1163`. Nothing gives Whim a screen transition for free. Every transition in this report is hand-built, which also means Reanimated's official Shared Element Transitions are unreachable: they are feature-flagged, documented as not production-ready, and scoped to `@react-navigation/native-stack`.

**The mini-app CSP.** `script-src` is `'unsafe-inline'` without `unsafe-eval`, `style-src` is `'unsafe-inline'`, `connect-src` is `'none'`, `img-src` is `data:`, and there's no `blob:` (`build/assemble.mjs:17-27`, `LOCKED_CSP`, comment: "Never add 'unsafe-eval', 'blob:', or 'data:' to script-src"). The `style-src` allowance is worth naming explicitly since it's the thing that makes the whole WAAPI/CSS-keyframes plan in §3 viable at all — it's easy to read past. Two consequences on the eval side kill libraries outright. Anything calling `new Function` fails (Rive's web runtime, full `lottie-web`, react-spring before 9.2.0). Anything fetching an asset at runtime fails harder, and that is the one the sweeps underweighted: `connect-src 'none'` means `@lottiefiles/dotlottie-web`, which pulls a ~500KB WASM engine from a CDN on first player construction, cannot work at all, self-hosting or not, unless the CSP changes. Widening the CSP needs a new decision entry per #35/#37, and `wasm-unsafe-eval` is a widening even though it is narrower than `unsafe-eval`. I would not spend that budget on animation.

**The device floor is knowable, and it's fine.** `android/build.gradle:4` pins `minSdkVersion = 24`. Chrome/WebView dropped support for Android 7-8 in 2025, so a device stuck there is frozen around WebView 138 — comfortably past the Chrome 111 floor for `document.startViewTransition` and native WAAPI/`getAnimations()` support, both of which shipped years earlier. So the floor isn't the unknown I first treated it as; it isn't the blocker on anything in this report.

**The SDK rule.** Decision #13 says tokens not values, components not raw styles. Decision #11 says mini-apps never see HTML or DOM. Decision #43 says primitives carry no leak class, which is why `delay` is a Promise and `interval` is a hook. So the mini-app animation layer cannot expose `element.animate()`, cannot take a duration in milliseconds, cannot take an easing string, and cannot hand out `requestAnimationFrame`. It has to be a closed vocabulary of components and hooks that clean up implicitly, and that means no hook may return anything CSS-shaped. That constraint is doing more design work than any library choice — see the `useMotion` fight in §3.

**The bundle contract couples two React versions the report can't treat as independent.** The H1b externals are exactly `{vc-sdk, react, react-dom}`, sourced from root `node_modules` and injected as host globals by `build/build.mjs:41,62`. RN 0.85.3 pins `react`/`react-dom` at 19.2.3. Any SDK feature that wants newer React behavior — see `<Morph>` below — is blocked on an RN-compatible React bump, not something the sandbox can adopt on its own schedule.

**APK shape.** Single arm64-v8a APK, offline release build, no Play App Bundle. Per-ABI delivery does not help, but the build is already single-ABI, so the number that matters is the one `.so` for arm64.

**Solo developer plus the harness.** `package.json`, `babel.config.js`, and `metro.config.js` are Class-2 protected. `.claude/hooks/protect-harness.sh` denies subagents outright. So adopting any native dependency is HUMAN-BOOTSTRAP by construction and attended-only. `invariants/` carries the same Class-2 protection, and it's additionally owner-authored by design (#28) — a feature-implementing chain literally cannot write its own negative control, which matters for the phase plan in §7. That's a scheduling fact, not a preference.

One more thing the sweeps could not know. Two owner-authored suites assert the *absence* of motion: `test/prompt-flow-screens.suite.ts:506` (`h.ok(!/Animated|Easing|typewriter|fadeIn/i.test(buildSrc), 'the build screen holds no animation at all')`) and `test/whim-prose.suite.ts` (`h.ok(!/Animated|setTimeout|fadeIn/.test(component), 'arriving prose is never faded or typed in')`). Sweep 4's top-two moments both collide with these. I resolve both in §5, in favor of keeping the invariants — but the regexes are keyed to RN's old `Animated` API and a couple of string literals, and Reanimated's `withTiming`/`withRepeat`/`useAnimatedStyle`/CSS `animationName` match none of them. Widening both is a required, gated Phase 2 task, not an assumption that they keep working — see §7.

## 2. The host-app stack

**Recommended: `react-native-reanimated@4.6.0` plus `react-native-worklets@0.12.2`, both pinned exact, and nothing else for now.**

Checked directly against the npm registry, not just the docs site: `latest` is 4.6.0; the only 4.7 build published anywhere is a nightly (`4.7.0-nightly-20260909-...`), which does not belong in a package.json. Sweep 1's "4.1.0 or later for RN 0.82+" is stale, and my own first pass at this report was wrong in the other direction — it cited a `^4.7` that doesn't exist as a stable release. 4.6.0's own peerDependencies require `react-native: "0.83 - 0.87"` and `react-native-worklets: "0.12.x"`, both satisfied by RN 0.85.3. Worklets is version-locked to the Reanimated minor, not a free bare install: 4.3.x pulls `worklets@0.8.x` (and tops out at RN 0.84, except the single patch 4.3.4, which reaches into 0.85), 4.5.x pulls `worklets@0.10.x-0.11.x`. `npm install react-native-worklets` today happens to resolve 0.12.2, which is right for 4.6.0 and wrong for anything else — pin both exact and re-verify the pairing before any future bump, including a future 4.7.0 stable.

Reanimated 4 is new-arch-only, which Whim already is (`newArchEnabled=true` in `android/gradle.properties:44`).

What it buys, in order of how much I care:

- `ReducedMotionConfig` at the launcher root is a single enforcement point for all Reanimated-driven motion — nothing else in this space has one. It does not reach RN's `Animated` API (three call sites still use it) or the sandboxed iframe (its own path, §3), so it's one of three enforcement surfaces, not the whole app's. Porting the three existing call sites to Reanimated is worth doing partly to collapse that to two, and Phase 2 should end with a static check asserting zero `useNativeDriver`/`Animated.` references remain in `src/host/` — cheap, non-vacuous, and it goes red today with three hits.
- The advantage for the ghost-tile and open-app morphs (moments 1 and 3, §5) isn't thread-crossing — RN's native driver already runs `useNativeDriver: true` animations on the UI thread, and all three existing call sites (`Orb.tsx:67`, `flow-skeletons.tsx:33-34`, `app-tile.tsx:109`) already do exactly that. It's that Reanimated's worklets can express an arbitrary derived transform, which the morph needs: animate the container with a non-uniform `scale` and counter-scale the inner content wrapper by `1/scale`, so text and images don't stretch — the standard scale-based FLIP trick, transform-only, no bounds or layout animation anywhere. Plain `Animated` can't express that relationship without falling back to JS-thread interpolation, which reintroduces the jank the morph exists to avoid. Pre-warm or pool the WebView instance before the morph starts regardless — WebView instantiation itself happens on the UI thread, and neither approach is immune to that stall — and record a frame trace before/after, since no frame timing exists anywhere in `docs/` today.
- The CSS-animations API in 4.x covers fire-and-forget state motion in about a third the code of shared values. Use it for entrances and skeleton loops. Use shared values for anything interruptible.
- `withSpring`'s `duration`+`dampingRatio` mode and its `stiffness`+`damping` mode are mutually exclusive, not a v4 replacement of the older mode — Reanimated silently lets `duration`/`dampingRatio` override `stiffness`/`damping` when both are supplied rather than erroring. Pick one mode (this report uses `duration`+`dampingRatio` throughout) and never mix them in the same config.

Cost: a sixth native dependency, not the first — `op-sqlite`, MMKV, `react-native-webview`, Nitro modules, and `safe-area-context` already prove the JDK-21/arm64-only autolink path on this exact toolchain. What's actually new is Reanimated's own CMake build and the Babel plugin (`react-native-worklets/plugin`, which must be listed last — though `babel.config.js` today has no `plugins` array at all, so there's nothing to conflict with, just a new single entry). No `metro.config.js` change is needed despite the `wrapWithReanimatedMetroConfig` folklore, which narrows the Class-1 protected-file surface for Phase 2 to `package.json` + `babel.config.js`. I could not find a published arm64 size figure for Reanimated's native library and I am not going to invent one. Measure it with `unzip -l` on the release APK before and after, against a recorded baseline (§7); if it comes back above 5MB that is a real finding worth writing down, since nothing in `docs/` records an APK size at all today.

**Runner-up 1: `@shopify/react-native-skia`. Not now.**

Sweeps 1 and 2 disagreed on the size and sweep 2 was right. Shopify's own bundle-size page says `librnskia.so` is about 3.8MB on arm64, plus 220KB of JS, roughly 4MB total. The 41.3MB figure is the universal APK carrying every ABI, which is not Whim's build. So the cost is fine.

I still say no, for two reasons. First, look at §5: every moment in the vocabulary is transform, opacity, and color on rectangles. Not one of them needs a rasterizer. Skia earns its keep when you need a real backdrop blur, a runtime shader, or path morphing, and Whim currently needs none of those. Second, Shopify has announced it is moving its own apps off React Native and will sponsor react-native-skia only through the end of 2026, after which the original author forks it under a new name. That is a managed transition rather than abandonment, but for a solo developer it means a rename, a migration, and a watch item, bought in exchange for a shimmer gradient. Revisit Skia only if the orb becomes the product's signature and wants a real shader.

**Runner-up 2: React Navigation plus react-native-screens. No.**

It would buy stock slide and fade transitions Whim will not use, and it does not do the ghost-tile morph, which is precisely why Reanimated's shared-element feature exists as a separate bolt-on. The one genuine argument for it is memory: Fragment-backed screens actually unmount. Revisit it if Whim grows a real back stack across multiple open mini-apps, and adopt it for the memory behavior, not for polish.

**Also no:** Moti — 0.30.0, last published January 2025 (about 19 months, not the "roughly two years" I first wrote), with a peer range of `react-native-reanimated: "*"` so it will install cleanly against Reanimated 4 with no warning, and any incompatibility would surface at runtime rather than at install time. Skip it anyway: Reanimated 4's CSS-animations API now covers its whole pitch, first-party. `LayoutAnimation` (`setLayoutAnimationEnabledExperimental` is a documented no-op on the new architecture, with open issues spanning RN 0.76 forward). `react-native-gesture-handler` is fine and current at 3.2.1, but Whim has no gesture today, and RNGH 3.x still needs a `GestureHandlerRootView` wrapped around the app root — a `LauncherRoot` change to budget for whenever it lands, not before.

## 3. The mini-app SDK motion surface

**Zero new dependencies inside the sandbox.** Web Animations API, CSS transitions and keyframes, and about fifty lines of FLIP inside `vc-sdk`. No GSAP, no Motion, no auto-animate package, no player runtime.

Sweep 3 argued for GSAP core as the preset engine, verified eval-free, 27KB gzipped, paid once in the runtime shell. The verification is good work and the conclusion is still wrong. WAAPI already does timing, easing, sequencing, and `finished` promises natively at zero bytes. The presets in this proposal are fades, scales, and translates. Paying a library for that adds a supply-chain item to the trusted code the invariant suites have to keep honest, and the CSP cannot police a dependency that is already inside the frame. Same reasoning kills `@formkit/auto-animate` as a package while keeping its technique.

The surface, concretely.

**Tokens, extending `src/sdk/design-tokens.ts`.** `MOTION` already exists there and is already platform-neutral by design. Widen it rather than starting a second table.

```
MOTION.duration = { instant: 0, quick: 100, short: 200, base: 300, long: 450 }
MOTION.easing   = { standard:             'cubic-bezier(0.2, 0, 0, 1)',
                    emphasizedDecelerate: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
                    emphasizedAccelerate: 'cubic-bezier(0.3, 0, 0.8, 0.15)' }
```

Named honestly this time. `standard` is M3's standard easing, but the other two are M3's *emphasized*-tier decelerate/accelerate, not the standard tier's own (`cubic-bezier(0, 0, 0, 1)` and `cubic-bezier(0.3, 0, 1, 1)`) — leaving them unqualified would let an author cross tiers pairing an enter and an exit without realizing it. The duration scale is Whim's own, chosen on M3's duration grid (M3 ships short1-4, medium1-4, long1-4, extra-long1-4 in 50ms steps; `instant`, `quick`, `base` are not M3 token names, whatever I implied earlier by calling this table M3's values) — two sweeps landing on the same numbers independently is still worth something, just not "verbatim M3." Also reconcile with the existing `MOTION.sheetRise.easing = 'cubic-bezier(.2,.8,.2,1)'` at `design-tokens.ts:122-125`, a fourth curve outside this table entirely — fold it into `standard` or name it as an explicit fifth tier, but don't ship two competing easing vocabularies in one object.

**Components and hooks the generator can use:**

| Surface | Shape | Technique |
|---|---|---|
| `<Reveal preset delayIndex?>` | `preset: 'fade' \| 'fade-up' \| 'scale-in' \| 'none'` | WAAPI keyframes on mount, `delayIndex` multiplies a fixed 60ms stagger |
| `<List items keyBy renderItem>` | new primitive, FLIP on by default | FLIP on add, remove, reorder — scoped to this primitive, not `Stack`'s free-form children |
| `Button`, `Card` press | no prop, on by default | `transform: scale(0.97)` in, spring back |
| `<Morph id>` | shared element between two states | FLIP only, for now (see below) |
| `useMotion({ trigger, preset })` | returns an opaque `MotionHandle`, passed to a component's `motion` prop | WAAPI, token-bounded; no style object ever crosses the sandbox boundary |
| `useReducedMotion()` | returns `boolean` | reads the host flag |

`useMotion` does not return a style object. My first pass at this had it doing exactly that, which hands a generated app the entire CSS surface through the back door — precisely the "raw styles" #13 forbids, and worse than the "no duration prop, no easing prop" constraint I'd already stated two paragraphs earlier in an unreleased draft. It returns an opaque, branded `MotionHandle` a mini-app can obtain only from the hook and hand only to an SDK component's `motion` prop; the handle carries no inspectable fields. No SDK component takes a `style` or `className` prop today (`grep -n "style?:\|className" src/sdk/*.tsx` returns nothing) and that has to stay true. The SDK's own components turn the handle into WAAPI calls internally — a generated app can trigger a preset; it can never touch a duration, an easing curve, or a CSS property.

FLIP defaults live on the new `<List keyBy>` primitive, not on `Stack`'s free-form children. Defaulting it onto `Stack` would need every SDK component to forward a DOM ref (none do today), would silently misfire the moment generated code uses array-index keys or omits keys (React reuses DOM nodes across a reorder and FLIP animates the wrong element to the wrong place — a bug that only shows up in generated apps, exactly where the SDK's own tests can't catch it), and would cost a layout read on every list update, including the 200-row ones, on the mid-range Android WebView this report targets. `keyBy` makes identity an explicit, typechecked contract instead of a hope about generated code, and `<List>` is where "motion the generator never asks for" actually pays off without the failure mode.

The defaults matter more than the props otherwise. Most of "this app feels alive" should come from motion the generator never asks for. If list reordering and press feedback are built into the components, a mini-app that contains zero animation code still moves correctly, and `<Reveal>` becomes a thing the model reaches for rarely rather than sprays everywhere. Say that explicitly in `docs/sdk-reference.md` and show it in `fixtures/style-gallery.app.tsx`, since the generation prompt reads both.

`preset` is a string-literal union, so an invented value fails the bundle typecheck rather than degrading at runtime. There is no duration prop, no easing prop, no CSS property list. A new need means a new preset in the SDK. That is the same call Polar made with their `<Box>`, and Whim already made it for spacing and color.

**`<Morph>` is FLIP-only for now.** I originally proposed feature-detecting `document.startViewTransition` with a FLIP fallback and called both paths CSP-clean, which is true but incomplete — the CSP conclusion was right, the integration cost was the part I skipped. `startViewTransition` requires the DOM to mutate *synchronously* inside its callback; with React that means `ReactDOM.flushSync`, which React documents as its worst-performing update path and which throws if called mid-render. React's `<ViewTransition>` component removes that need by hooking the render cycle directly, but it only went stable in **React 19.3** (shipped 2026-09-09), and Whim is pinned to `react`/`react-dom` **19.2.3**, coupled to the host RN version by the H1b externals (§1) — the sandbox can't bump React independently of RN. Ship `<Morph>` as FLIP-only — it already has to exist as the fallback, so this costs nothing incremental — and treat View Transitions as a separate, later decision gated on a verified React 19.3 bump that RN 0.85.3 tolerates. For that later decision: caniuse puts View Transitions at 91.75% global, Chrome desktop from 111, and current Chrome for Android and Android WebView support it — and §1 already established the device floor is fine. React's version is the actual blocker, not the browser.

**How the flag reaches the iframe.** Not through `matchMedia`, and not through a writable global either. My first pass proposed stamping `__whimMotion = { reduced: boolean }` onto `window` next to the generation nonce, which a bundle can simply overwrite — `__whimMotion.reduced = false` defeats the setting, including the OS-level signal I was calling "always honored." That's the same forgery class spike2 finding F4 already named for self-reported verdicts, and CLAUDE.md's standing invariant is explicit that only nonce-authenticated frames are trusted. Keep the flag in `vc-sdk`'s module closure instead — seeded by the loader before the bundle's IIFE runs, using the same host-injected-global mechanism that already delivers `vc-sdk` itself as one of exactly three externals (`{vc-sdk, react, react-dom}`, H1b bundle contract) a bundle cannot reach into. `useReducedMotion` reads the closure, never `window`. For live changes, send a `motion` message through the capability-bridge dispatcher, which is generation-fenced and authenticates on `ev.source === window.parent`, so toggling the setting does not need a realm reset. Add a forgery test to `bridge:invariants`: a fixture that tries to override the flag from inside the frame and asserts the override has no effect.

Enforcement lives inside the primitives. When the flag is set, `<Reveal>` renders the end state, FLIP is skipped, `<Morph>` degrades to a 150ms opacity crossfade, and `useMotion`'s handle resolves to the final state. A compliant bundle has no code path that animates. `useReducedMotion` is still exposed so a mini-app can restructure content, for example rendering a static chart instead of an animated one, rather than only having its motion silently dropped.

## 4. Rich motion, 3D, and the mascot

**three.js in the sandbox: no, and not mainly for size.** Core three.js is eval-free and would run under the CSP; only the Draco and KTX2 decoders need WASM. The real objection is containment. WebView graphics memory is native process memory, and when Android's low-memory killer fires, it takes the hosting app, not the frame. That makes an unoptimized LLM-generated scene a denial of service against the launcher, and it routes around all three containment legs, because none of them are about resource exhaustion. If 3D is ever wanted, it needs a capability gate, lazy injection so the other 95% of apps never pay 185KB gzipped, triangle and texture budgets, a `webglcontextlost` watchdog, and its own decision entry. Not soon.

**Rive: no in the sandbox, no on the host.** Rive's runtime is WebAssembly, and instantiating WASM needs `'wasm-unsafe-eval'` in `script-src`, which Whim's locked CSP doesn't grant and #35/#37 forbid widening — that alone is disqualifying and can't go stale. `rive-app/rive-wasm#131` also documented `new Function` inside `createNamedFunction`, a second, independent CSP failure, though that issue is now closed — treat it as secondary evidence to re-verify against the current build if this is ever revisited, not as the load-bearing reason. Host-side, `rive-nitro-react-native` looks genuinely good and the state-machine model is the right way to drive a character, but see the mascot verdict below.

**Lottie: no.** Full `lottie-web` evals After Effects expressions. `lottie_light` strips that and would work. `dotlottie-web` fetches its engine from a CDN, which `connect-src 'none'` ends. But the real reason is simpler: a Lottie is a designer asset, Whim has no designer, and adding a player to render files that do not exist is a dependency looking for a job.

**Skia: covered above. One future use, the orb.**

**The mascot: don't build a character.** Whim already has one. The orb is abstract, already on screen, already animated, and needs no asset pipeline, no rig, and no runtime. It can breathe today with the code that already exists and could carry a runtime shader later if it becomes the signature.

A real character would take a commissioned Rive rig with four to six states, a runtime whose Fabric status none of the sweeps could confirm, a `.riv` asset pipeline, and an ongoing design vocabulary that has to grow every time a new state appears. Sweep 2 is right that this is days of work rather than months, and I still think it is the wrong spend. Mascots pay off in habit-loop products where the character is the retention mechanic. Whim's retention mechanic is that the thing you asked for got made well. The Mailchimp precedent that sweep 4 cites is the useful half of the idea: a small presence living in wait, error, and empty states. The orb can do that without a face.

## 5. The motion vocabulary

Ordered by leverage. Every one animates only `transform`, `opacity`, and color, in both halves of the app. Anything touching layout stutters on a mid-range Android WebView, which is the target.

**1. Ghost tile becomes the real tile.** The signature moment, and the only one where the animation is the content: proof that the stub you tapped yesterday is now a real thing. Measure the tile rect, mount an absolutely positioned overlay seeded with it, and drive it transform-only: translate and non-uniform `scale` the container from the tile's box to the full-screen box, counter-scale the inner content wrapper by `1/scale` so text and images don't stretch (the scale-based FLIP trick from §2), crossfade the content in the tail. 450ms, decelerate curve, with a 150ms content crossfade nested at the end. Today `app-tile.tsx` does a 400ms 6px rise, which is the placeholder version of this. Reduced: instant swap plus the 150ms content crossfade only, so the change still registers as an event.

**2. Press feedback everywhere.** Scale to 0.97 in 100ms standard, spring back with `dampingRatio: 0.8, duration: 200`. Never from `scale(0)`. Reduced: keep it as an opacity dim to 0.9 over 100ms. This is feedback, not decoration, and Apple's own reviewer criteria say meaningful motion gets replaced rather than deleted.

**3. Mini-app open, tile to full screen.** The same scale-based container transform as moment 1, 400ms, decelerate. Pre-warm or pool the WebView instance so it's already alive when the morph starts — WebView instantiation happens on the UI thread too, and this is the moment that stalls without it — and hold it behind a placeholder painted in the tile's hue until it reports first paint, or the morph reveals a white flash halfway through. The hue continuity work in `build-lifecycle.ts` already gives you the right color. Reduced: instant, 150ms crossfade.

**4. Mini-app close.** The exact reverse, shrinking into the tile's grid slot, 300ms, accelerate. Exits run faster than entrances. This teaches that the app lives at that tile, which starts mattering around the twentieth mini-app. Reduced: instant crossfade.

**5. Home grid staggered entrance.** Fade plus an 8px rise, 220ms per tile, ease-out, 60ms stagger. Past roughly six tiles, batch the rest into groups instead of extending the queue. Simultaneous motion reads mechanical, staggered reads designed, and the whole cost is one multiply. Reduced: everything at once, opacity only, 150ms.

**6. Orb menu open and close.** Today it rises in 260ms and closes by snapping to zero. The snap is the bug. Give close a real animation at 200ms accelerate, upgrade open to a spring (`dampingRatio: 0.85, duration: 400`), and stagger the items by 40ms. Reduced: opacity only, 150ms, no stagger, no translate.

**7. Skeleton to content, non-prose only.** 250ms crossfade in place, decelerate, no reflow. This is where `whim-prose.suite.ts` bites, and I think that invariant is right: text that fades in is unreadable while it fades. So prose keeps arriving instantly and this applies to tiles and plan cards only.

**8. Skeleton breathe, already shipped.** Port `BreathingView` from `Animated.loop` to `withRepeat` for no reason other than putting it under `ReducedMotionConfig`. Keep 1900ms and 0.34 to 0.72 — Apple's reduced-motion criteria don't set a frequency threshold, contrary to what I first claimed here; the actual page names categories like depth simulation, multi-axis motion, and auto-advancing content, not an oscillation rate. The honest justification is simpler: it's a decorative ambient loop, and Apple's own framework says decorative loops get removed under reduced motion regardless of rate, which is exactly what happens here. Reduced: static at `opacityTo`.

**9. Build-wait aliveness, and where `prompt-flow-screens.suite.ts:506` lands.** A multi-minute generation with no signal reads as broken, so sweep 4 is right about the need and wrong about the location. Put the aliveness on the ghost tile in the grid, where it already lives, and leave the build screen still. That keeps the invariant intact, and it is better product: a user who can leave the build screen and still see the thing being made is a user who does not have to sit there. Switch to a determinate percentage the moment the generation stream reports stage progress, and never fake one you do not have. Hold any indicator for at least 500ms so a fast run does not flicker.

**10. Compose to clarify handoff.** The composed text becomes the first message rather than disappearing and reappearing as a bubble. Same screen, so this is cheap. 300ms, decelerate. Reduced: instant reposition, 150ms opacity settle.

**11. Generation error.** Crossfade to the error state over 200ms standard, with a color shift. No shake. Multi-axis motion is on Apple's disable list, and a shake reads as alarm. Reduced: identical, which is a good sign about the base design.

**12. Mini-app internal motion.** The SDK presets from §3, on the same token scale, so a mini-app never looks like it came from a different app.

## 6. Designing "reduce animations"

**The setting.** One key, `reduceAnimations`, on the shared `whim.launcher` KVBackend, encoded `'1'`/`'0'`, with a tolerant loader, exactly like `highlighting.ts`. One difference: `highlighting` defaults to true, this defaults to **false**. A `Switch` row in `SettingsScreen.tsx` next to Highlighting. `LauncherRoot` owns the state and passes it down, same as highlighting.

**Composition with the OS.** Effective reduction is `userToggle || AccessibilityInfo.isReduceMotionEnabled()`. The OS setting is always honored, and the in-app toggle can only add reduction, never override the system downward. In Reanimated that is one line at the root:

```tsx
<ReducedMotionConfig mode={reduceAnimations ? ReduceMotion.Always : ReduceMotion.System} />
```

Subscribe to the `reduceMotionChanged` event, and verify on a real device, because that event has a reputation for not firing reliably on Android.

**What survives.** Kill every loop (skeleton breathe, orb idle), every translate, scale, and bounds morph, every stagger, every blur. Keep press feedback at reduced amplitude, keep 150ms state-change crossfades, keep the still-working signal during generation, keep determinate progress. Removing all evidence that the system is alive during a multi-minute wait is an accessibility regression dressed as a win.

**Propagation.** Host context for native components, closure value plus bridge message for the iframe as described in §3. One flag, two consumers, enforcement inside the primitives so no generated mini-app has to remember to check.

**Testing.** This is the rare motion property a Chromium invariant suite can actually pin, but only as a paired test — a bare "render and assert `getAnimations()` is empty" is vacuous, because `getAnimations()` only returns animations currently running or pending, and a freshly rendered fixture returns empty either way until something triggers a preset. Run it **inside the frame** (a host-side query can't see into a cross-origin opaque iframe): (1) flag off, drive each preset's trigger, assert `document.getAnimations().length > 0` — the negative control that proves the harness can see motion at all; (2) flag on, drive the identical triggers, assert `document.getAnimations().length === 0`. Without step (1) this isn't admissible under #28's non-vacuity rule. It belongs in `invariants/` next to the containment suites, alongside the `__whimMotion` forgery test from §3 — both are owner-authored additions, not something a feature-implementing chain writes for itself (§7).

## 7. Phased adoption

**Phase 1: tokens and the switch.**
Widen `MOTION` in `design-tokens.ts` to the duration and easing scale from §3. Add the `reduceAnimations` setting, loader, and Settings row. Thread it through the three existing `Animated` call sites (`BreathingView`, `Orb` rise, `app-tile` rise) so the toggle is honest the day it appears. Fix the orb's snap-close while you are in there. Open an OpenSpec change proposal for this phase — no live spec covers motion today — and log the reduce-motion default (off, OS-composed) as a `decisions.md` entry per open question 7.
Risk: no Class-1 protected file is touched, so the settings and token work itself is ordinary. But the paired `getAnimations()` invariant test does **not** belong to this phase's implementer chain — `invariants/` is Class 2, denied to subagents unconditionally with no per-worktree grant, and it's owner-authored by design (#28) so its negative control stays honest. Write it as a separate, owner-authored task, or land the check in `checks/test/acceptance.ts`, the sanctioned unprotected extension point for repo-wide static checks that already reaches the gate. Ships alone and is worth shipping alone either way.

**Phase 2: Reanimated and the signature transitions. HUMAN-BOOTSTRAP. Medium risk. Two steps, not one.**
Before touching anything: record a baseline — current release APK size (`unzip -l`) and a frame trace of the three existing `Animated` call sites and of opening a mini-app today. Nothing in `docs/` or `DEVLOG.md` records either, so there is currently no before-picture to compare this phase against.

*Step 2a — adopt and port, ship alone.* Add `react-native-reanimated@4.6.0` and `react-native-worklets@0.12.2`, pinned exact, to `package.json`; add the worklets Babel plugin to `babel.config.js` (no `metro.config.js` change needed). Mount `ReducedMotionConfig` at the launcher root. Port the three existing call sites and confirm the zero-`Animated.`-references check from §2 goes green. Run `npm run guard:metro` after the install — its byte-size assertion is a *floor* (`MIN_BYTES = 500_000` against an authoring-time baseline of ~1.83MB) that a larger bundle can't trip, so there is nothing to rebaseline; what it actually catches is Reanimated's `react: "*"` peer hoisting a second `react` copy, which is the real hazard worth checking for. Measure the APK delta against the baseline above and write both numbers into `docs/`. This step is a complete, mergeable, revertible unit on its own — if it regresses the offline release build or the on-device containment probes, it reverts cleanly without taking six new transitions down with it.

*Step 2b — build the transitions.* The hand-rolled scale-based shared-element overlay and moments 1 through 6 and 10 from §5.

Risk sits in four places. `package.json` and `babel.config.js` are Class-2, so both steps need an attended session and cannot be dispatched to an implementer subagent. This is the repo's sixth native dependency — `op-sqlite`, MMKV, `react-native-webview`, Nitro modules, and `safe-area-context` already prove the JDK-21/arm64 autolink path; what's actually new is Reanimated's own CMake build. Second, the worklets Babel plugin must be listed last, though there's no existing `plugins` array to conflict with today. Third, `test/prompt-flow-screens.suite.ts` and `test/whim-prose.suite.ts` assert the absence of motion via regexes keyed to RN's old `Animated` API (§1) — widening both to also catch `withTiming|withSpring|withRepeat|useAnimatedStyle|animationName|Animated\.View|ReduceMotion` is a required task inside step 2b, red-checked by adding a Reanimated animation to the build screen first and confirming the suite goes red before any real transition code lands near those two files. Fourth, log a `decisions.md` entry for whichever way open questions 1 and 2 land — silence there means the next commit decides by accident.

**Phase 3: the SDK motion layer. No dependencies, but it is the trusted code. Medium risk.**
Tokens into `vc-sdk`, `<Reveal>`, the scoped `<List keyBy>` FLIP primitive, `<Morph>` as FLIP-only, `useMotion` returning an opaque `MotionHandle`, `useReducedMotion`. The reduced-motion flag lives in the SDK's module closure (§3), seeded at bootstrap, updated only via the generation-fenced `motion` bridge message. A motion section in `docs/sdk-reference.md`, an entry in `fixtures/style-gallery.app.tsx`, and a doc tripwire so a new preset can't land undocumented. Update `docs/capabilities.md` with the new capability and the spec it points to — this is a genuinely new capability surface and the map is how the next agent finds it. Update the generation prompts in `server/src/generation/prompts/` to reach for `<Reveal>` sparingly and `<List>`/press-feedback defaults never, and add a motion case to the eval corpus (`docs/app-corpus.md`) so the surface has something checking whether the model uses it well rather than overuses it. Extend `bridge:invariants` with the `motion` message's forgery test (§3) and its generation-fencing case, alongside the paired `getAnimations()` test from §6 in `invariants/`. Open an OpenSpec proposal and spec delta for the motion capability before implementation starts, per the harness's own workflow.
Risk: this widens the host-injected global/closure surface that `neutralize.js` and the containment suites reason about, so the invariants pass has to cover it — see the forgery test above. Second risk is the generator over-reaching for `<Reveal>` or `<List>`; mitigate in the reference, the fixture, and the eval case, not in the runtime.

**Not scheduled:** gesture-handler, Skia, a 3D capability, any vector-player runtime.

## 8. Open questions

1. Does the build screen stay still? I say yes and move the aliveness to the ghost tile, but `prompt-flow-screens.suite.ts:506` encodes it as an invariant, so retiring or keeping it is the owner's call and wants a `decisions.md` line either way.
2. Does arriving prose stay un-faded? I say yes, same reasoning, same suite question.
3. What is the actual arm64 APK delta for Reanimated plus worklets, and what's the actual frame-timing delta on the ghost-tile and open-app morphs? Both need a recorded baseline before step 2a (§7) — there isn't one anywhere in `docs/` today.
4. Is the orb officially the mascot? If yes, is a shader orb worth roughly 4MB of Skia later?
5. Does the harness have a lane for a native dependency adoption at all, or does Phase 2 need a bespoke attended flow? `protect-harness.sh` denies subagents on `package.json` unconditionally, and the same question applies to `invariants/` — Phase 1 and Phase 3 both need an owner-authored side-channel for test authorship, not just Phase 2 for the dependency.
6. `<Morph>` is resolved: it ships FLIP-only (§3), which costs nothing since FLIP is the fallback anyway. What's still open is whether a later View Transitions upgrade is worth a React 19.3 bump, and whether `<Morph>` remains the SDK's most misusable primitive once mini-apps start reaching for it.
7. Should the setting be a boolean or tri-state (Full / Reduced / Follow system)? I lean boolean with the OS always honored, because the tri-state's third option is what the boolean already does.
8. Does the demo filmer need a motion guarantee? Recording on a device with system reduce-motion on would produce flat footage and nobody would notice until the edit.

## What the review changed

- Reanimated pin corrected from a nonexistent `^4.7` to the real published `4.6.0`, with `react-native-worklets@0.12.2` locked to match (blocking).
- Dropped `useMotion` returning a raw style object, which broke decision #13, in favor of an opaque `MotionHandle` passed through a component prop (blocking).
- Corrected the Phase 1/Phase 3 risk claims: `invariants/` is Class 2 and owner-authored, not touchable by a feature-implementing chain (blocking).
- Fixed the RN/Reanimated version floor and pinned `worklets` to the exact version Reanimated's own peerDependencies require, instead of a bare install (major).
- Replaced the false "UI thread survives JS thread" justification for Reanimated with the real one — native `Animated` already runs on the UI thread; the actual gain is worklet-driven counter-scale math (major).
- Resolved the transform/opacity/color rule's contradiction with moments 1 and 3 by making both transform-only via a scale-and-counter-scale trick, instead of animating bounds and radius (major).
- Deleted the invented "0.2Hz Apple discomfort threshold" and replaced it with Apple's actual remove-if-decorative reasoning (major).
- Relabeled the M3 easing tokens honestly (`standard` vs `emphasizedDecelerate`/`emphasizedAccelerate`) and stopped calling the duration scale an M3 token table (major).
- Removed the "rebaseline guard:metro" task — the check is a size floor a bigger bundle can't trip — and replaced it with the actual hazard, a hoisted duplicate `react` (major).
- Corrected "first native dependency" to "sixth" — `op-sqlite`, MMKV, WebView, Nitro, and safe-area-context already prove the toolchain (major).
- Rewrote the `getAnimations()` invariant as a paired test with a negative control, run inside the frame, so it can't pass vacuously (major).
- Made widening the `Animated`/`setTimeout` regex invariants a required, red-checked Phase 2 task instead of an assumption they'd keep holding, and corrected the cited line number (major).
- Narrowed the `ReducedMotionConfig` claim to "all Reanimated-driven motion," not the whole app, and added a static check proving RN's `Animated` API is fully retired (major).
- Replaced the forgeable `window.__whimMotion` global with a `vc-sdk` closure value plus a bridge forgery test, matching the nonce-authenticated-trust rule from spike2 finding F4 (major).
- Made `<Morph>` FLIP-only for now — `startViewTransition` needs `flushSync` or React 19.3's `<ViewTransition>`, and Whim is pinned to React 19.2.3 (major).
- Scoped default-on FLIP to a new `<List keyBy>` primitive instead of `Stack`'s free-form children, which has no ref forwarding and no key-stability guarantee (major).
- Fixed the `withSpring` note from "replaces" to "mutually exclusive with, and silently overrides" (minor).
- Reframed the Rive citation around the CSP's `wasm-unsafe-eval` requirement, since the cited GitHub issue is closed and could go stale (minor).
- Corrected Moti's last-publish date and peer range, which doesn't actually forbid installing against Reanimated 4 (minor).
- Added the Android WebView floor, a pre-Phase-2 baseline measurement, the host/sandbox React version coupling, OpenSpec and decisions.md steps, a `docs/capabilities.md` update, generation-prompt and eval-corpus updates, a bridge-invariants extension, and a rollback-capable two-step split for Phase 2 — all absent from the first draft.

## 9. Sources

Verified directly during this pass:

- https://www.npmjs.com/package/react-native-reanimated (dist-tags and peerDependencies checked via `npm view`; `latest` is 4.6.0, 4.7 exists only as a nightly)
- https://www.npmjs.com/package/react-native-worklets (version pairing per Reanimated minor)
- https://docs.swmansion.com/react-native-reanimated/docs/guides/compatibility/ (RN 0.85 needs Reanimated 4.3.x+; tiers checked against exact peerDependencies rather than taken as one range)
- https://docs.swmansion.com/react-native-reanimated/docs/fundamentals/getting-started (separate `react-native-worklets` install; plugin must be last; no metro.config.js step)
- https://docs.swmansion.com/react-native-reanimated/docs/animations/withSpring/ (duration/dampingRatio vs stiffness/damping are mutually exclusive, not sequential replacements)
- https://shopify.github.io/react-native-skia/docs/getting-started/bundle-size/ (3.8MB arm64 `.so` + 220KB JS; 41.3MB is universal APK)
- https://github.com/rive-app/rive-wasm/issues/131 (`new Function` in `createNamedFunction`; issue is closed, treated as secondary evidence)
- https://github.com/pmndrs/react-spring/issues/1423 (fixed in v9.2.0, so sweep 3's CSP ban on react-spring is stale)
- https://react.dev/blog/2026/09/09/react-19-3 (`<ViewTransition>` stability, shipped 2026-09-09, after Whim's pinned 19.2.3)
- https://frontendmasters.com/blog/reacts-viewtransition-element/ (why `startViewTransition` needs `flushSync` absent `<ViewTransition>`)
- https://www.npmjs.com/package/moti (last publish 2025-01-29; peer range `react-native-reanimated: "*"`)
- https://www.toolbox365.net/tutorials/easing-curves-m3-ios/ (M3 easing tier values, corroborating the standard-vs-emphasized correction)
- https://developer.apple.com/help/app-store-connect/manage-app-accessibility/reduced-motion-evaluation-criteria (no frequency threshold; categories are depth simulation, multi-axis/multi-speed/spin/vortex, auto-advancing content; remove-or-replace framework)
- https://caniuse.com/view-transitions (91.75% global; current Chrome Android and Android WebView)
- https://docs.swmansion.com/react-native-gesture-handler/docs/fundamentals/installation/ (3.2.1, RN-agnostic peer range)

Relied on from the sweeps without independent re-verification:

- https://docs.swmansion.com/react-native-reanimated/docs/device/ReducedMotionConfig/
- https://docs.swmansion.com/react-native-reanimated/docs/shared-element-transitions/overview/
- https://reactnavigation.org/docs/shared-element-transitions/
- https://blog.swmansion.com/reanimated-4-is-new-but-also-very-familiar-b926dd59aa40
- https://github.com/facebook/react-native/issues/47617 and https://github.com/facebook/react-native/issues/38661
- https://github.com/expo/expo/issues/30153
- https://github.com/nandorojo/moti/issues/391
- https://shopify.engineering/back-to-native (Skia sponsorship through end of 2026)
- https://developer.android.com/develop/ui/views/layout/webapps/manage-webview-memory
- https://github.com/airbnb/lottie-web/issues/289
- https://www.npmjs.com/package/@lottiefiles/dotlottie-web (CDN WASM fetch)
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/script-src
- https://m3.material.io/styles/motion/easing-and-duration/tokens-specs (JS-rendered; corroborated by the toolbox365 mirror above)
- https://emilkowal.ski/ui/great-animations and https://emilkowal.ski/ui/7-practical-animation-tips
- https://every.to/p/invisible-details-of-interaction-design
- https://www.nngroup.com/articles/skeleton-screens/ and https://www.nngroup.com/articles/progress-indicators/
- https://polar.sh/blog/orbit-llm-safe-design-system
- https://auto-animate.formkit.com/ (technique, not the package)
- https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API/Using
