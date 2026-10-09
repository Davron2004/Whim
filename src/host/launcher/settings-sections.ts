/**
 * settings-sections — pure derivations for Settings and Advanced (design-system-v1 task 14.3; spec
 * app-launcher "Settings puts common settings first and diagnostics under Advanced"; spec
 * privacy-settings "Settings shows this phone's ID and can make a new one").
 *
 * No React Native import — this module must load under the Node acceptance suite.
 */
import type { AppInfo } from './app-info';
import { sanitizeServerUrl, serverAddressAllowed } from './server-address';
import type { ProbeResult } from './server-probe';

/** The phone ID as Advanced's row shows it: its start and end with an ellipsis between, so the row
 *  stays one line. An ID short enough to fit is shown whole. The copy button copies it whole. */
export function middleTruncated(id: string, head = 8, tail = 6): string {
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

/** About's Version row: the installed marketing version and build, or `undefined` when the
 *  installed app can't say (its native module is missing), so the row is left out. */
export function versionLabel(read: () => AppInfo): string | undefined {
  try {
    const info = read();
    return `${info.version} (${info.build})`;
    // eslint-disable-next-line no-restricted-syntax -- intentional: a build without the module leaves the row out; every request reports the same read failing (`app-info.ts`)
  } catch {
    return undefined;
  }
}

/** The latest result of the session's health probe and the address it went to: the saved address
 *  as `server-address.ts` stored it (sanitized), or Whim's own. */
export interface SessionProbe {
  readonly address: string;
  readonly result: ProbeResult;
}

/**
 * The line under Advanced's address field (spec app-launcher "One probe per pause"): the field
 * sends nothing itself; once a typing pause saves the address, the session's own connectivity probe
 * checks it, and the field shows that one result. `neutral` while AI features are off (nothing is
 * probed then), the probe's result once it has answered for the address in the field, else nothing:
 * mid-edit, while the probe is out, or for an address the rule refuses, which is never sent.
 */
export function addressCheck(canProbe: boolean, draft: string, probe: SessionProbe | null): 'neutral' | ProbeResult | null {
  if (!canProbe) return 'neutral';
  const address = sanitizeServerUrl(draft);
  if (address === undefined || !serverAddressAllowed(address) || probe === null) return null;
  return probe.address === address ? probe.result : null;
}
