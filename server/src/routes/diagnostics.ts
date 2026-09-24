/**
 * POST /v1/diagnostics — device error records, logged and never stored (developer-observability
 * D2, specs/device-diagnostics "The diagnostics route validates, bounds and logs without storing").
 *
 * Order: consent practice, the 32 KB body cap, `DiagnosticsBatch` validation (a `.strict()`
 * allowlist, so an unknown key is a `400`, never silently dropped), then the per-device daily
 * record allowance and the global daily ceiling. Only a batch that passes all of them is logged,
 * whole: one `scope: "device"` line per record at the record's own level. A refused batch logs no
 * record.
 *
 * The allowance lives in this process's memory and resets at UTC midnight. Nothing here touches a
 * database or a file: the records, the batch and the device id exist only in the log lines, and
 * the device id not even there.
 *
 * Its consent practice is `error-details`, required: only a consent version whose disclosure lists
 * error details (v2 on) may send them, whatever the phone's own gate did.
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { DIAGNOSTICS_MAX_BODY_BYTES, DiagnosticsBatch, type ApiError } from '@whim/contract';
import type { ServerConfig } from '../config';
import { dailyLimitRefusal, payloadTooLargeRefusal, serverBusyCeilingRefusal } from '../admission/refusals';
import { consentPractice } from '../consent-practices';
import { log } from '../logger';
import { envelopeLogFields, type V1Env } from '../request-edge';

export interface DiagnosticsRouteOptions {
  config: Pick<ServerConfig, 'limitDiagnosticsPerDeviceDay' | 'limitDiagnosticsPerDay'>;
  clock: () => number;
}

/** The device lines' logger. Deliberately the root logger's child, not the request-scoped one: a
 *  record's own `requestId` names the request the device error is about, and a line carrying two
 *  would be ambiguous. The upload's own request id is on its `scope: "request"` line. */
const deviceLog = log.child({ scope: 'device' });

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Records accepted today, per device and in total. In memory only; a new UTC day starts empty. */
class DailyRecordAllowance {
  private day = '';
  private total = 0;
  private readonly perDevice = new Map<string, number>();

  constructor(private readonly deviceLimit: number, private readonly globalLimit: number) {}

  /** Takes `count` records for `deviceId`, or refuses the whole batch naming the limit it would
   *  cross. The device limit is checked first. */
  take(deviceId: string, count: number, now: number): 'ok' | 'device' | 'global' {
    const today = utcDay(now);
    if (today !== this.day) {
      this.day = today;
      this.total = 0;
      this.perDevice.clear();
    }
    const used = this.perDevice.get(deviceId) ?? 0;
    if (used + count > this.deviceLimit) return 'device';
    if (this.total + count > this.globalLimit) return 'global';
    this.perDevice.set(deviceId, used + count);
    this.total += count;
    return 'ok';
  }
}

export function makeDiagnosticsRoute(options: DiagnosticsRouteOptions): Hono<V1Env> {
  const app = new Hono<V1Env>();
  const { config, clock } = options;
  const allowance = new DailyRecordAllowance(config.limitDiagnosticsPerDeviceDay, config.limitDiagnosticsPerDay);

  app.post(
    '/',
    consentPractice('error-details', 'required'),
    bodyLimit({
      maxSize: DIAGNOSTICS_MAX_BODY_BYTES,
      onError: (c) => {
        const r = payloadTooLargeRefusal();
        return c.json(r.body, r.status, r.headers);
      },
    }),
    async (c) => {
      const body = await c.req.json().catch(() => null);
      const parsed = DiagnosticsBatch.safeParse(body);
      if (!parsed.success) {
        return c.json(
          { error: 'invalid_request', hint: parsed.error.issues[0]?.message ?? 'Invalid diagnostics batch' } satisfies ApiError,
          400,
        );
      }
      const { osVersion, records } = parsed.data;

      const taken = allowance.take(c.get('deviceId'), records.length, clock());
      if (taken !== 'ok') {
        const r = taken === 'device' ? dailyLimitRefusal(clock) : serverBusyCeilingRefusal(clock);
        return c.json(r.body, r.status, r.headers);
      }

      const envelope = envelopeLogFields(c.get('envelope'));
      for (const { level, message, ...fields } of records) {
        deviceLog[level]({ ...envelope, osVersion, ...fields }, message);
      }
      return c.body(null, 204);
    },
  );

  return app;
}
