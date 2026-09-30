# launcher false-positive candidates

These are source-contract findings, not a `void` sweep. They need the same current-key readback used for the resolver batch before any external transition.

- S2, `LauncherRoot.tsx:927`: `onOpen` passes a closure to `runAppOp`. The closure catches `access.activeBundle` failures, logs, alerts, and invokes the optional Home fallback. `runAppOp` awaits that closure, ends the busy slot in `finally`, and returns the handled result.
- S5, `settings-probe.ts:107`: `DebouncedProbe` documents a non-rejecting probe. Its only product construction passes `probeServer`, which documents and implements a resolved `ProbeResult` for network, parse, and timeout failures; `publish` is React's stable state setter.
- S74, `LauncherRoot.tsx:840`: the seeding IIFE catches its only awaited operation before preserving refresh, ready, and held-link release ordering. It has no additional asynchronous producer after that catch.
- S76, `LauncherRoot.tsx:1968`: app-link resolution delegates to the same `onOpen` closure as S2; that closure owns the rejection path and busy cleanup.
- S83, `LauncherRoot.tsx:1248`: `activeDescription` is caught. The remaining trim/slice/ref assignment has no promise-producing operation, and failure leaves edit context absent as documented.

Do not change these sites solely to satisfy S9383. The remaining behavior paths are S22 and S75 in `launcher-age.done.md`; report and history remain their own recovery cohorts.
