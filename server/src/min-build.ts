/**
 * server/src/min-build.ts — the `/v1` minimum-build gate (app-update-gate; request-envelope D4).
 *
 * Mounted on `/v1/*` after the envelope and before every route, so it covers each `/v1` route by
 * path prefix, report and usage included, and refuses before any admission, ledger row or model
 * call. A request whose build is below its platform's minimum gets `426 update_required`; the
 * request id and the request log line come from the edge middleware around it.
 */
import type { MiddlewareHandler } from 'hono';
import { updateRequiredRefusal } from './admission/refusals';
import { LEGACY_ENVELOPE, type EdgeEnv, type RequestEnvelope } from './request-edge';

/** The lowest build each platform may use `/v1` with. `0` serves every build of that platform. */
export interface MinimumBuilds {
  readonly ios: number;
  readonly android: number;
}

/** A legacy envelope names no platform and counts as build `0` on both, so it is below as soon as
 *  either minimum is above `0`. */
function isBelowMinimumBuild(envelope: RequestEnvelope, minimums: MinimumBuilds): boolean {
  if (envelope.platform === 'unknown') return envelope.build < Math.max(minimums.ios, minimums.android);
  return envelope.build < minimums[envelope.platform];
}

export function minimumBuildGate(minimums: MinimumBuilds): MiddlewareHandler<EdgeEnv> {
  return async (c, next) => {
    if (isBelowMinimumBuild(c.get('envelope') ?? LEGACY_ENVELOPE, minimums)) {
      const r = updateRequiredRefusal();
      return c.json(r.body, r.status, r.headers);
    }
    await next();
  };
}
