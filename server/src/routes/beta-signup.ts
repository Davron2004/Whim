/**
 * POST /beta/signup (beta-waitlist design D1–D3, D7; spec "Signup route", "Abuse limits", "Emails
 * never logged"). The pages site's `/beta` form posts here with no script, so every answer is a
 * `303 See Other` back to the pages host: `/beta/thanks` or `/beta/retry`.
 *
 * Mounted on the root app, outside `/v1`: a browser has no device id, and `/v1` stays device-gated
 * by construction. It passes through none of the device, envelope or minimum-build middlewares.
 *
 * Order: body cap → trap field → validation → limits → store. A filled trap field answers thanks
 * and stores nothing, so a bot learns nothing. Each request logs one line carrying its outcome code
 * and its request id: never the email, the platform or the client address.
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ServerConfig } from '../config';
import { assignRequestId, type EdgeEnv } from '../request-edge';
import { log } from '../logger';
import { isWaitlistPlatform, type WaitlistPlatform, type WaitlistStore } from '../waitlist/store';
import type { SignupLimiter } from '../waitlist/limiter';

/** The closed set of outcome codes a signup log line carries. */
export type SignupOutcome = 'stored' | 'updated' | 'invalid' | 'limited' | 'trap' | 'error';

/** The bot trap: a field people never see or fill. Its name matches no browser autofill heuristic
 *  (a `company` field gets a person's organization autofilled, and their signup dropped). */
export const TRAP_FIELD = 'hp_ref';

/** The longest email the route accepts, in bytes (the form's `maxlength`). */
export const MAX_EMAIL_BYTES = 254;

const LOCAL_PART_CHARS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
const DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
/** A cell starting with one of these is read as a formula by a spreadsheet opening the export. */
const FORMULA_LEAD = /^[=+\-@|%]/;

/**
 * A syntactically valid address, as a browser's `type="email"` checks it (the WHATWG rule), with a
 * dotted domain, at most `MAX_EMAIL_BYTES`, and not starting like a spreadsheet formula. Checked by
 * parts rather than with one pattern, so no input can make it backtrack.
 */
export function isValidSignupEmail(value: string): boolean {
  if (Buffer.byteLength(value, 'utf8') > MAX_EMAIL_BYTES) return false;
  const at = value.indexOf('@');
  if (at <= 0 || value.includes('@', at + 1)) return false;
  const local = value.slice(0, at);
  const labels = value.slice(at + 1).split('.');
  return LOCAL_PART_CHARS.test(local) && !FORMULA_LEAD.test(local) && labels.length >= 2 && labels.every((label) => DOMAIN_LABEL.test(label));
}

interface SignupForm {
  readonly email: string;
  readonly platform: WaitlistPlatform;
  readonly updatesOptOut: boolean;
}

/** The form's fields, or `undefined` when any breaks the contract. */
function readForm(fields: URLSearchParams): SignupForm | undefined {
  const email = (fields.get('email') ?? '').trim();
  const platform = fields.get('platform') ?? '';
  const optOut = fields.get('updates_opt_out');
  if (!isValidSignupEmail(email) || !isWaitlistPlatform(platform)) return undefined;
  if (optOut !== null && optOut !== '1') return undefined;
  return { email, platform, updatesOptOut: optOut === '1' };
}

export interface BetaSignupDeps {
  readonly store: WaitlistStore;
  readonly limiter: SignupLimiter;
  readonly config: ServerConfig;
  readonly clock: () => number;
  /** The notice id every stored row records (`waitlist/notices.ts`). */
  readonly noticeId: string;
}

export function makeBetaSignupRoute(deps: BetaSignupDeps): Hono<EdgeEnv> {
  const { store, limiter, config, clock, noticeId } = deps;
  const thanks = `${config.webOrigin}/beta/thanks`;
  const retry = `${config.webOrigin}/beta/retry`;
  const route = new Hono<EdgeEnv>();

  route.post(
    '/',
    assignRequestId,
    bodyLimit({
      maxSize: config.maxBodyBytesBeta,
      onError: (c) => {
        (c.get('log') ?? log).info({ scope: 'beta-signup', outcome: 'limited' satisfies SignupOutcome }, 'beta signup');
        return c.redirect(retry, 303);
      },
    }),
    async (c) => {
      const signupLog = (c.get('log') ?? log).child({ scope: 'beta-signup' });
      const answer = (outcome: SignupOutcome, to: string): Response => {
        signupLog.info({ outcome }, 'beta signup');
        return c.redirect(to, 303);
      };

      const contentType = c.req.header('content-type') ?? '';
      const text = await c.req.text();
      if (!contentType.toLowerCase().startsWith('application/x-www-form-urlencoded')) return answer('invalid', retry);
      const fields = new URLSearchParams(text);
      if ((fields.get(TRAP_FIELD) ?? '') !== '') return answer('trap', thanks);
      const form = readForm(fields);
      if (form === undefined) return answer('invalid', retry);
      const now = clock();
      if (!limiter.admit(c.req.header('x-forwarded-for'), now)) return answer('limited', retry);
      try {
        return answer(store.upsert({ ...form, noticeId, now }), thanks);
      } catch (err) {
        signupLog.error({ outcome: 'error' satisfies SignupOutcome, errorClass: err instanceof Error ? err.constructor.name : typeof err }, 'beta signup');
        return c.redirect(retry, 303);
      }
    },
  );

  return route;
}
