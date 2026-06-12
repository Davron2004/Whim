/**
 * capability-bridge — the gate (Decision #41, D4). `seccomp` + `capabilities(7)` for the
 * sandboxed process, with the host-held manifest as the declared capability set.
 *
 * Runs in FIXED order for every (already shape-validated) syscall frame:
 *
 *   1. method is registered                         → else `unknown_method`
 *   2. the row's capability ∈ the realm's HOST-HELD  → else `undeclared_capability`
 *      manifest (never the bundle's self-description)
 *   3. the permission hook allows it (pass-through    → else `permission_denied`
 *      for Tier-0 storage; the seam exists so
 *      notifications/sensors slot in later)
 *   4. params validate against the row's schema      → else `invalid_params`
 *
 * Every denial is structured data carrying a machine-readable kind and a fix hint — the bundle
 * sees a rejected Promise, the host logs the denial for the future telemetry/repair loop. The
 * gate NEVER throws; a denial is a normal return value.
 */

import {
  BridgeError,
  ParamsValidator,
  RealmRecord,
  RegistryRow,
  SyscallFrame,
} from './contract';
import { CapabilityRegistry } from './registry';

/**
 * The permission hook seam (D4 step 3). Pass-through for Tier-0 storage; later capabilities
 * (notifications, sensors) plug a real prompt/policy here. May be async (a prompt). Returning
 * false denies with `permission_denied`.
 */
export type PermissionHook = (ctx: {
  method: string;
  capability: string;
  realm: RealmRecord;
  params: { [key: string]: unknown };
}) => boolean | Promise<boolean>;

export const ALLOW_ALL: PermissionHook = () => true;

export type GateResult = { ok: true; row: RegistryRow } | { ok: false; error: BridgeError };

export async function runGate(
  frame: SyscallFrame,
  realm: RealmRecord,
  registry: CapabilityRegistry,
  permissionHook: PermissionHook = ALLOW_ALL,
): Promise<GateResult> {
  // 1 — registered?
  const row = registry.lookup(frame.method);
  if (!row) {
    return deny({
      kind: 'unknown_method',
      method: frame.method,
      hint: `No syscall named "${frame.method}" is registered; use one of the SDK capability verbs.`,
    });
  }

  // 2 — capability declared in the HOST-HELD manifest (D4: never the bundle's self-claim)?
  if (!realm.manifest.capabilities.includes(row.capability)) {
    return deny({
      kind: 'undeclared_capability',
      method: frame.method,
      capability: row.capability,
      hint: `This app's manifest does not declare "${row.capability}"; add it to the defineApp capabilities array.`,
    });
  }

  // 3 — permission hook (pass-through for Tier-0 storage).
  const allowed = await permissionHook({ method: frame.method, capability: row.capability, realm, params: frame.params });
  if (!allowed) {
    return deny({
      kind: 'permission_denied',
      method: frame.method,
      capability: row.capability,
      hint: `Permission for "${row.capability}" was not granted for "${frame.method}".`,
    });
  }

  // 4 — params shape.
  const reason = (row.paramsSchema as ParamsValidator)(frame.params);
  if (reason) {
    return deny({
      kind: 'invalid_params',
      method: frame.method,
      capability: row.capability,
      hint: `Invalid params for "${frame.method}": ${reason}.`,
    });
  }

  return { ok: true, row };
}

function deny(error: BridgeError): GateResult {
  return { ok: false, error };
}
