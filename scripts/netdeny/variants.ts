/**
 * scripts/netdeny/variants.ts — the canary mini-app sources for the network-deny reproduction
 * (design D17 "Reproduce first, then prove"). Each `NavigationVariant` is a self-navigation shape
 * the sandboxed frame can perform (research.md E "The gap"; modeled on
 * `synthrun/test/isolation.ts:310-352`'s `hostileCandidate`/`attempt`). `host-top-frame` names the
 * outer-runtime-page navigation from the spec's second scenario; it has no mini-app source because
 * `src/host/NetworkDenyProbeScreen.tsx` injects it directly into the outer page instead.
 *
 * Every source here compiles under the production bundle contract only
 * (`synthrun/builder.ts`'s `buildCandidateSource` — one file importing only `vc-sdk`, IIFE,
 * classic JSX). Nothing here imports a Node built-in.
 */

export type NetdenyVariant =
  | 'loc-href'
  | 'loc-assign'
  | 'meta-refresh'
  | 'anchor-click'
  | 'loc-href-https'
  | 'dns-name'
  | 'host-top-frame';

/** Every variant a canary mini-app can perform, in the order the probe runs them. Excludes
 *  `host-top-frame`, which has no mini-app source (see module comment). */
export type NavigationVariant = Exclude<NetdenyVariant, 'host-top-frame'>;

export const NAVIGATION_VARIANTS: readonly NavigationVariant[] = [
  'loc-href',
  'loc-assign',
  'meta-refresh',
  'anchor-click',
  'loc-href-https',
  'dns-name',
];

/** The variants `--expect leak` requires a hit for, plus `host-top-frame` (the outer-page
 *  navigation, which has no mini-app source — see module comment). `loc-href-https` and
 *  `dns-name` are deliberately excluded: they prove the TLS/DNS legs are blocked, not that a
 *  leak landed. */
export const LEAK_REQUIRED_VARIANTS: readonly NetdenyVariant[] = ['loc-href', 'loc-assign', 'meta-refresh', 'anchor-click', 'host-top-frame'];

/** The addresses and run label a canary app source is parameterized over. `httpBase` and
 *  `tlsBase` are full origins (`http://host:port`, `https://host:port`); `runId` labels every hit
 *  so a shared canary can tell runs apart. */
export interface CanaryTarget {
  httpBase: string;
  tlsBase: string;
  runId: string;
}

/** The self-navigation statement for one variant, evaluated after the module-scope `delay(300)`.
 *  Every statement targets a plain `http`/`https` URL on the canary — nothing here is reachable
 *  through the sandbox's three web legs (CSP has no directive for it, the iframe sandbox has no
 *  token against it, `location` can't be stripped without breaking the runtime). */
function actionFor(variant: NavigationVariant, target: CanaryTarget): string {
  const { httpBase, tlsBase, runId } = target;
  const hitUrl = (name: string): string => httpBase + '/wnd/hit/' + name + '?run=' + runId;
  switch (variant) {
    case 'loc-href':
      return `location.href = ${JSON.stringify(hitUrl('loc-href'))};`;
    case 'loc-assign':
      return `location.assign(${JSON.stringify(hitUrl('loc-assign'))});`;
    case 'meta-refresh': {
      const refresh = '0;url=' + hitUrl('meta-refresh');
      return (
        `const m = document.createElement('meta'); m.httpEquiv = 'refresh'; ` +
        `m.content = ${JSON.stringify(refresh)}; ` +
        `document.head.appendChild(m);`
      );
    }
    case 'anchor-click':
      return (
        `const a = document.createElement('a'); ` +
        `a.href = ${JSON.stringify(hitUrl('anchor-click'))}; ` +
        `document.body.appendChild(a); a.click();`
      );
    case 'loc-href-https':
      return `location.href = ${JSON.stringify(tlsBase + '/wnd/hit/loc-href-https')};`;
    case 'dns-name': {
      // Plain `http` is the point of this variant: it targets a DNS name (not an IP), watched
      // with `tcpdump` for the query, and the leak this reproduces is the request leaving at all
      // — a real endpoint's scheme is irrelevant to that.
      // eslint-disable-next-line sonarjs/no-clear-text-protocols -- see comment above
      const dnsUrl = 'http://wnd-' + runId + '.whim-netdeny.test/wnd/hit/dns-name';
      return `location.href = ${JSON.stringify(dnsUrl)};`;
    }
  }
}

/**
 * The full TSX source for one canary mini-app. Renders a heading naming the variant, waits
 * `delay(300)` at module scope (so the probe screen sees a delivered, trusted, painted realm
 * before the navigation), then performs the variant's action with every error swallowed — the
 * point is the navigation, not a diagnostic about it.
 */
export function canaryAppSource(variant: NavigationVariant, target: CanaryTarget): string {
  const action = actionFor(variant, target);
  return `import { defineApp, Screen, Stack, Heading, delay } from 'vc-sdk';
function attempt(fn: () => unknown) {
  try {
    const r = fn() as any;
    if (r && typeof r.catch === 'function') r.catch(() => undefined);
  } catch (e) {
    return e;
  }
  return undefined;
}
delay(300).then(() => attempt(() => {
  ${action}
}));
function Home() {
  return (
    <Screen>
      <Stack>
        <Heading size="title">netdeny ${variant}</Heading>
      </Stack>
    </Screen>
  );
}
export default defineApp({ name: 'Netdeny', initial: 'Home', screens: { Home }, capabilities: [] });
`;
}
