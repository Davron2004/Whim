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
 *
 * Its consent practice is `reports`, declared exempt: a report is a user act on a screen that says
 * what goes, so it needs no grant (ai-data-consent's report exception) — a request sent with
 * consent `none` is accepted.
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { ReportRequest, ReportResponse, type ApiError } from '@whim/contract';
import type { UsageStore } from '../usage-store';
import type { ReportStore } from '../reports/store';
import type { ServerConfig } from '../config';
import type { SlotController } from '../admission/slots';
import { dailyLimitRefusal, payloadTooLargeRefusal, serverBusyCeilingRefusal, serverBusyRefusal } from '../admission/refusals';
import type { ServerLogger } from '../logger';
import type { V1Env } from '../request-edge';
import { consentPractice } from '../consent-practices';

export interface ReportRouteOptions {
  config: ServerConfig;
  clock: () => number;
  slots: SlotController;
}

export function makeReportRoute(usageStore: UsageStore, reportStore: ReportStore, options: ReportRouteOptions): Hono<V1Env> {
  const app = new Hono<V1Env>();
  const { config, clock, slots } = options;

  app.post(
    '/',
    consentPractice('reports', 'exempt'),
    bodyLimit({
      maxSize: config.maxBodyBytesReport,
      onError: (c) => {
        const r = payloadTooLargeRefusal();
        return c.json(r.body, r.status, r.headers);
      },
    }),
    async (c) => {
      const deviceId = c.get('deviceId');
      const reportLog = c.get('log').child({ scope: 'report' });
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
        requestId: c.get('requestId'),
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

      let reportId: string;
      try {
        reportId = await reportStore.insert({
          deviceId,
          reason: parsed.data.reason,
          note: parsed.data.note,
          appName: parsed.data.appName,
          prompt: parsed.data.prompt,
          source: parsed.data.source,
          now: clock(),
        });
        await usageStore.settle(requestId, { outcome: 'ok' });
      } catch (err) {
        await settleFailedReportAdmission(usageStore, requestId, clock, err, reportLog);
        throw err;
      }

      reportLog.info({ reportId, reason: parsed.data.reason, promptBytes, sourceBytes }, 'report accepted');
      return c.json({ reportId } satisfies ReportResponse, 202);
    },
  );

  return app;
}

/** A failure after report admission can happen while persisting the report or settling its normal
 * `ok` outcome. Close the row best-effort so it cannot keep consuming an allowance forever, while
 * preserving the original error for the app-level 500 handler. */
async function settleFailedReportAdmission(
  usageStore: UsageStore,
  requestId: string,
  clock: () => number,
  cause: unknown,
  reportLog: ServerLogger,
): Promise<void> {
  try {
    await usageStore.settle(requestId, { outcome: 'error', now: clock() });
  } catch (settleErr) {
    reportLogError(reportLog, settleErr, cause);
  }
}

/** `reportLog` is bound to the request id, which is also the ledger row's id. */
function reportLogError(reportLog: ServerLogger, settleErr: unknown, cause: unknown): void {
  reportLog.error(
    {
      detail: settleErr instanceof Error ? settleErr.message : String(settleErr),
      cause: cause instanceof Error ? cause.message : String(cause),
    },
    'could not settle the ledger row of a failed report admission',
  );
}
