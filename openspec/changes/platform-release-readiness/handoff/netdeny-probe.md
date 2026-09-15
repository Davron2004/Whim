# netdeny-probe (chain-14 → chain-15, chain-16, chain-17)

## `NetdenyVariant` (`scripts/netdeny/variants.ts`, mirrored by hand in `NetworkDenyProbeScreen.tsx`)

```ts
export type NetdenyVariant =
  | 'loc-href' | 'loc-assign' | 'meta-refresh' | 'anchor-click'
  | 'loc-href-https' | 'dns-name' | 'host-top-frame';
export type NavigationVariant = Exclude<NetdenyVariant, 'host-top-frame'>;
export const NAVIGATION_VARIANTS: readonly NavigationVariant[] =
  ['loc-href', 'loc-assign', 'meta-refresh', 'anchor-click', 'loc-href-https', 'dns-name'];
export interface CanaryTarget { httpBase: string; tlsBase: string; runId: string; }
export function canaryAppSource(variant: NavigationVariant, target: CanaryTarget): string;
```

`host-top-frame` has no mini-app source — `NetworkDenyProbeScreen` injects it into the OUTER
runtime page directly. The probe screen runs all seven, in the order above with `host-top-frame`
last.

## The canary (`node scripts/netdeny/run.mjs canary …`)

```
node scripts/netdeny/run.mjs canary --expect leak|zero [--bind 127.0.0.1]
  [--http-port 8765] [--tls-port 8766] [--seconds 180]
```

Defaults: `--bind 127.0.0.1`, `--http-port 8765`, `--tls-port 8766`, `--seconds 180`. `--expect` is
required. Must run from the repo root (`synthrun/builder.ts` resolves off `process.cwd()`).

Routes on the HTTP port:
- `GET /wnd/bundle/<variant>?http=<httpBase>&tls=<tlsBase>&run=<runId>` — builds
  `canaryAppSource(variant, {httpBase, tlsBase, runId})` with `synthrun/builder.ts`'s
  `buildCandidateSource` (the production bundle contract) and returns the built JS as the body.
  Each successful build counts as one bundle fetch for that variant, **never** a hit. `variant`
  must be one of `NAVIGATION_VARIANTS`; anything else gets an empty 200 and a stderr line, no
  crash.
- Every other request is a hit, keyed by `/wnd/hit/<name>` → `<name>`, else by its raw path.

The TLS port (`node:net`, no TLS handshake) counts every accepted connection and destroys the
socket immediately — proving the egress happened without needing to terminate TLS.

At exit (the `--seconds` timer, or SIGINT) it prints, to stdout, one `bundle <variant> <count>`
line per navigation variant, then one `hit <path> <count>` line per path that was hit —

```
bundle <variant> <count>
hit <path> <count>
```

hits sorted by path — then exactly one summary line:

```
NETDENY PASS|FAIL expect=<leak|zero> bundles=<total bundle fetch count> hits=<total hit count> tls=<tls connection count> [missing=<a,b,c>]
```

`--expect zero` passes iff every one of the six `NAVIGATION_VARIANTS` had at least one successful
bundle fetch AND no path was hit AND the TLS port saw no connection; on failure `missing=` names
every un-fetched variant. Requiring the bundle fetch is what makes a `zero` pass mean something: a
canary that never saw any traffic at all (wrong build, `RUN_NETDENY_PROBE` left off, or a blocked
fetch) used to print the same `PASS` as a canary that watched six navigation attempts get refused.
`--expect leak` is unaffected by bundle counts — it passes iff `loc-href`, `loc-assign`,
`meta-refresh`, `anchor-click` and `host-top-frame` **each** have ≥1 hit AND the TLS port saw ≥1
connection; on failure `missing=` lists every one of those five that didn't (only ever on
`--expect leak`, only when at least one of them is missing). `dns-name` and `loc-href-https` hits
(TLS, really) are never required for a `leak` pass — DNS is watched separately with `tcpdump`
on-device.

Exit 0 on pass, 1 on fail, 2 on a usage error (bad/missing `--expect`, non-numeric port/seconds,
unknown flag, wrong first token — the first argument after `canary` must literally be `canary`,
since `run.mjs` is generic over future subcommands).

Verified directly (`node scripts/netdeny/test/canary.test.mjs`, this machine, not through
gate.sh — `package.json` is Class-1 protected, so this suite isn't gate-wired, same as the manual
verification it replaces): `--expect zero` with no traffic → `NETDENY FAIL … bundles=0 …
missing=loc-href,loc-assign,meta-refresh,anchor-click,loc-href-https,dns-name`, exit 1. `--expect
zero` after fetching all six bundles with no further traffic → `NETDENY PASS … bundles=6 hits=0
tls=0`, exit 0. `--expect leak` with all 5 required hits and one TLS connection, and zero bundle
fetches → `NETDENY PASS … bundles=0 hits=5 tls=1`, exit 0 (the bundle count never gates a `leak`
verdict). Red-checked by reverting the bundle requirement in `computeVerdict`: the first case then
wrongly prints `PASS … bundles=0 hits=0 tls=0` with no traffic at all.

## `App.tsx` / `NetworkDenyProbeScreen.tsx`

`RUN_NETDENY_PROBE` (default `false`), checked before `RUN_BRIDGE_PROBE`/`RUN_STORAGE_PROBE`/
`RUN_VSTORE_PROBE`. `NETDENY_CANARY_HOST_OVERRIDE` (module constant in
`NetworkDenyProbeScreen.tsx`, default `null`) overrides the host derived from `Platform.OS`
(`10.0.2.2` on Android — the emulator's host-loopback alias — `127.0.0.1` on iOS); a physical
device needs the Mac's LAN address here. Default ports match the canary's: HTTP `8765`, TLS
`8766` (`http(s)://<host>:<port>`).

**Probe-only literal**: `whim-netdeny-probe-marker-v1` (exported as `NETDENY_PROBE_MARKER`, also
shown in the on-screen title). Metro ships `NetworkDenyProbeScreen.tsx` in every release bundle
because `App.tsx` imports it statically regardless of `RUN_NETDENY_PROBE`'s value — the flag only
gates whether the screen *renders*. So grepping a bundle for this literal proves the screen module
is present, never that the probe ran or was enabled for that build, and it can never prove the
probe's *absence* from a release bundle either. The proof that the probe ran for a given build is
the on-screen probe title and rows, captured in a screenshot (tasks 13.6, 16.2) — not a bundle
grep.

Per-variant on-screen row: `<variant>: bundle=<pending|fetched|http <status>|error: …|n/a>`, a
`messages:` line joining every `onMessage` frame's `kind` seen (for `kind:"probes"` frames, also
`trusted=<bool>` and `contained=<bool>` read off the frame's top-level `trusted` and
`payload.contained`), and an `errors:` line joining every `onError` event as
`url=<url> code=<code> description=<description>` (iOS also appends ` domain=<domain>`). A final
row reads `done` once every variant has dwelled 5s past delivery, or `running: <variant>` while
one is in flight.
