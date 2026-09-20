/**
 * connectivity-ux — pure visibility derivation for the two offline UX surfaces (server-connectivity
 * chain-5; design.md decision 7): the home screen's quiet connectivity indicator (`app-launcher`
 * "The home screen shows a quiet connectivity indicator") and the compose entry point's "server
 * unreachable" notice (`prompt-flow` "The compose entry point shows a server-unreachable notice
 * without blocking generation"). No `react-native` import — `LauncherRoot.tsx` computes both
 * booleans through this module at its `HomeScreen`/`ComposeStep` call sites, mirroring this repo's
 * pure-logic-in-non-RN-siblings convention (`tile-pill.ts`, `server-probe.ts`), so the visibility
 * matrix is exercisable under Node without rendering either screen.
 */

import type { Connectivity } from './connectivity';

/** The home screen's quiet indicator: visible only once the session state is `'offline'` — never
 *  for `'unknown'` (no address configured yet, spec "MUST NOT appear when no server address is
 *  configured"), `'checking'`, or `'online'`. */
export function showOfflineIndicator(connectivity: Connectivity): boolean {
  return connectivity === 'offline';
}

/** The compose entry point's "server unreachable" notice: offline AND a server address is
 *  configured. An unconfigured address always shows the existing unconfigured message instead —
 *  never this one — independent of what `connectivity` happens to read (spec "distinct,
 *  non-overlapping messages"). */
export function showServerUnreachableNotice(connectivity: Connectivity, serverConfigured: boolean): boolean {
  return connectivity === 'offline' && serverConfigured;
}
