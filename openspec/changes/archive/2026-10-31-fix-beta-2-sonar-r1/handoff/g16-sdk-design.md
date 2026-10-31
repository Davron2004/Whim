# g16-sdk-design handoff

S135: accept-proposed
S136: accept-proposed
S137: fixed (structural)
S139: accept-proposed
S140: accept-proposed
S168: accept-proposed
S169: fixed (structural)
S172: accept-proposed
S311: accept-proposed
S331: accept-proposed

## Accept proposals
- S135: src/sdk/motion.ts runs in the mini-app WebView (floor Chromium 91 / iOS 15.1); `.at()` is unavailable and esbuild does not polyfill it (docs/sdk-reference.md §1).
- S136: src/sdk/navigation.tsx runs in the WebView; same runtime floor as S135.
- S139: `HeadingProps` is the exported prop type of the deliberately deprecated, kept-for-old-apps `Heading`; the only use is its own signature. Replacing it changes the public SDK surface.
- S140: `children?: undefined` in KeyedListProps is a discriminant of the exported `ListProps` union (forbids children on keyed lists); removing it changes the public type.
- S168: src/design/tints.ts is bundled into the sandbox (src/sdk/kit.ts imports mixHex); `Object.hasOwn` is unavailable at the Chromium 91 / iOS 15.1 floor.
- S172: src/design/icons/names.ts is bundled into the sandbox (src/sdk/icon.tsx imports resolveIcon); same runtime floor as S168.
- S311: `Card.radius` is a deliberately deprecated accepted-and-ignored prop of the exported CardProps; removing it would break generated apps that pass it.
- S331: `Button.radius`, same reason as S311 (exported ButtonProps).

## Red-check
none: all structural

## Commands
npm run build: 0; npm run sdk:test: 0; eslint --max-warnings 0 (surfaces.tsx, tints.ts): 0; npm run -s typecheck: 0

## Deviations
none
