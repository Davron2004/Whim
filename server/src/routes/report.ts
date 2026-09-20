/**
 * POST /v1/report — devices report objectionable or broken content (specs/content-reports
 * "Devices can report content with POST /v1/report"). Gated by the same `/v1` device-identity
 * middleware as every other route, but otherwise deliberately thin: no model call, no content
 * policy check (a report of objectionable content must never itself be refused for containing
 * it), and no credit check (specs/server-admission-control's fixed order excludes `/v1/report`
 * from the operator-credit check).
 *
 * Order (specs/server-admission-control "Admission checks run in a fixed order"): raw body cap,
 * body validation, prompt/source byte caps, drain state, the device's daily report allowance then
 * the global daily ceiling, then storage. A refused report stores nothing and its log record
 * carries only the refusal code.
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { ReportRequest, ReportResponse, type ApiError } from '@whim/contract';
import type { UsageStore } from '../usage-store';
import type { ReportStore } from '../reports/store';
import type { ServerConfig } from '../config';
import type { SlotController } from '../admission/slots';
import { dailyLimitRefusal, payloadTooLargeRefusal, serverBusyCeilingRefusal, serverBusyRefusal } from '../admission/refusals';
import { log } from '../logger';

type Env = { Variables: { deviceId: string } };

export interface ReportRouteOptions {
  config: ServerConfig;
  clock: () => number;
  slots: SlotController;
}

export function makeReportRoute(usageStore: UsageStore, reportStore: ReportStore, options: ReportRouteOptions): Hono<Env> {
  const app = new Hono<Env>();
  const { config, clock, slots } = options;
  const reportLog = log.child({ scope: 'report' });

  app.post(
    '/',
    bodyLimit({
      maxSize: config.maxBodyBytesReport,
      onError: (c) => {
        const r = payloadTooLargeRefusal();
        return c.json(r.body, r.status, r.headers);
      },
    }),
    async (c) => {
      const deviceId = c.get('deviceId');
      const body = await c.req.json().catch(() => null);
      const parsed = ReportRequest.safeParse(body);
      if (!parsed.success) {
        return c.json(
          { error: 'invalid_request', hint: parsed.error.issues[0]?.message ?? 'Invalid request body' } satisfies ApiError,
          400,
        );
      }

      const promptBytes = Buffer.byteLength(parsed.data.prompt ?? '', 'utf8');
      const sourceBytes = Buffer.byteLength(parsed.data.source ?? '', 'utf8');
      if (promptBytes > config.maxPromptBytes || sourceBytes > config.maxReportSourceBytes) {
        const r = payloadTooLargeRefusal();
        return c.json(r.body, r.status, r.headers);
      }

      if (slots.isDraining()) {
        const r = serverBusyRefusal();
        reportLog.info({ error: r.body.error }, 'report refused');
        return c.json(r.body, r.status, r.headers);
      }

      const admitted = await usageStore.admit({
        deviceId,
        kind: 'report',
        now: clock(),
        deviceLimit: config.limitReportsPerDeviceDay,
        globalLimit: config.limitReportsPerDay,
      });
      if (!admitted.ok) {
        const r = admitted.reason === 'device' ? dailyLimitRefusal(clock) : serverBusyCeilingRefusal(clock);
        reportLog.info({ error: r.body.error }, 'report refused');
        return c.json(r.body, r.status, r.headers);
      }
      const { requestId } = admitted;

      const reportId = await reportStore.insert({
        deviceId,
        reason: parsed.data.reason,
        note: parsed.data.note,
        appName: parsed.data.appName,
        prompt: parsed.data.prompt,
        source: parsed.data.source,
        now: clock(),
      });
      await usageStore.settle(requestId, { outcome: 'ok' });

      reportLog.info({ reportId, reason: parsed.data.reason, promptBytes, sourceBytes }, 'report accepted');
      return c.json({ reportId } satisfies ReportResponse, 202);
    },
  );

  return app;
}
