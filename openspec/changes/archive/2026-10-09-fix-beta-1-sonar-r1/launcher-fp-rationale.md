# launcher false-positive candidates

These are source-contract findings, not a `void` sweep. Each is still OPEN in the current PR analysis and needs the ordinary documented key-level transition/readback if root accepts the evidence below.

| finding | current Sonar key | rule | path |
| --- | --- | --- | --- |
| S2 | AaDv2GvxDHOwsfbTeJjH | typescript:S9383 | src/host/launcher/LauncherRoot.tsx:927 |
| S5 | AaDv2GusDHOwsfbTeJjF | typescript:S9383 | src/host/launcher/settings-probe.ts:107 |
| S74 | AaDv2GvxDHOwsfbTeJjG | typescript:S9383 | src/host/launcher/LauncherRoot.tsx:840 |
| S76 | AaDv2GvxDHOwsfbTeJjL | typescript:S9383 | src/host/launcher/LauncherRoot.tsx:1968 |
| S83 | AaDv2GvxDHOwsfbTeJjK | typescript:S9383 | src/host/launcher/LauncherRoot.tsx:1248 |

- S2: `leaveHistory` invokes `onOpen`. Its actual `runAppOp` work closure catches `activeBundle` failure, logs, alerts, and calls the supplied Home fallback. `runAppOp` awaits that closure and releases the busy slot in `finally`. Its generic `publish` or work signature is not the producer here; both product callbacks are React state setters and the closed closure above.
- S5: `DebouncedProbe` is generic, so a throwing arbitrary `publish` would make `runProbe` reject. The only product construction is `new DebouncedProbe({ probe: (url) => probeServer(url), publish: setProbeState })`. `probeServer` explicitly resolves every request, parse, and timeout outcome. `publish` is React's stable state dispatcher. The test-only constructors use array pushes/no-op callbacks. No production caller supplies an arbitrary throwing callback.
- S74: the IIFE catches the only awaited producer, `seedFirstRun`. What follows is synchronous refresh/ready/ref assignment and a held-link release. The only later route to asynchronous work is the same `openAppLink`/`onOpen` chain covered by S76.
- S76: `openAppLink` delegates a resolved installed app to the same `onOpen` closure as S2. Missing and pending routes are synchronous state decisions.
- S83: the only awaited producer, `activeDescription`, is caught. The success path only tests/normalizes the returned string and assigns the ref; failed or missing description intentionally leaves no edit context.

Do not edit these locations solely to satisfy S9383. S22/S75 are the launcher rejection work; report and history retain their own recovery cohorts.
