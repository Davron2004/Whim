/**
 * service-refusal — recognises a `GenerationClientError` as a service refusal, and the pure
 * retry-window arithmetic that goes with one (design D8/D11; spec "service-refusals").
 *
 * `ServiceRefusalCode` is imported TYPE-ONLY from `./contract-mirror` (a client-local stand-in
 * for `@whim/contract`'s not-yet-landed export — see that module's doc comment), so this module
 * pulls no zod into the Metro bundle graph, same discipline as every other `@whim/contract`
 * import in this directory.
 */
import type { ServiceRefusalCode } from './contract-mirror';
import { GenerationClientError, isNonEmptyString } from './transport-shared';
import {
  retryLineHoursFallback,
  retryLineMinutes,
  retryLineSameDay,
  retryLineSeconds,
  retryLineTomorrow,
} from './copy';

/** Where a refusal's primary text lands (design D9) and what tone its notice takes. Deliberately
 *  NOT keyed by status or hint text — matching is by the contract identifier alone. */
export interface RefusalRule {
  readonly landing: 'text' | 'sender';
  readonly tone: 'danger' | 'neutral';
}

/** A mapped type over the CLOSED `ServiceRefusalCode` set: a member added to the contract without
 *  a matching entry here fails the typecheck, so the table can never silently fall behind. */
export const REFUSAL_RULES: { readonly [K in ServiceRefusalCode]: RefusalRule } = {
  content_policy: { landing: 'text', tone: 'danger' },
  payload_too_large: { landing: 'text', tone: 'danger' },
  policy_unavailable: { landing: 'sender', tone: 'neutral' },
  budget_exhausted: { landing: 'sender', tone: 'neutral' },
  daily_limit: { landing: 'sender', tone: 'neutral' },
  device_busy: { landing: 'sender', tone: 'neutral' },
  server_busy: { landing: 'sender', tone: 'neutral' },
};

/** What `serviceRefusalOf` returns for a recognised refusal: the closed code, the server's own
 *  hint text, the HTTP status it arrived with (carried through for the log record only — never
 *  matched on), and the positive-integer `Retry-After` window when the server sent one. */
export interface ServiceRefusal {
  readonly code: ServiceRefusalCode;
  readonly hint: string;
  readonly status?: number;
  readonly retryAfterSeconds?: number;
}

/** Recognise `err` as a service refusal: an HTTP `GenerationClientError` whose body validated as
 *  `ApiError` (so `err.code` is set — see `transport-shared.ts#httpErrorFrom`), whose `code` is
 *  an OWN key of `REFUSAL_RULES`, and whose `hint` is non-empty. Every other error, including an
 *  identifier outside the vocabulary, returns `undefined` and keeps its existing handling. */
export function serviceRefusalOf(err: unknown): ServiceRefusal | undefined {
  if (!(err instanceof GenerationClientError) || err.kind !== 'http') {
    return undefined;
  }
  if (err.code === undefined || !isNonEmptyString(err.hint)) {
    return undefined;
  }
  if (!Object.prototype.hasOwnProperty.call(REFUSAL_RULES, err.code)) {
    return undefined;
  }
  return {
    code: err.code as ServiceRefusalCode,
    hint: err.hint,
    status: err.status,
    retryAfterSeconds: err.retryAfterSeconds,
  };
}

/** The moment (epoch ms) the landing screen's primary action re-enables, or `undefined` when the
 *  refusal carried no `Retry-After` window (design D11: `retryAt = receivedAt + seconds * 1000`). */
export function retryAtOf(refusal: ServiceRefusal, receivedAt: number): number | undefined {
  return refusal.retryAfterSeconds === undefined ? undefined : receivedAt + refusal.retryAfterSeconds * 1000;
}

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

/** One copy-table line saying when the retry window ends (spec "Retry-After holds the retry
 *  action until the window passes"): seconds under a minute, minutes under an hour, `after
 *  <time>` for later the same local day, `tomorrow after <time>` beyond that. `formatTime` is an
 *  injected local-time formatter (an `Intl.DateTimeFormat`-backed one in production, a fixed
 *  string in tests) so this function stays pure. When the global `Intl` is missing entirely (so
 *  no caller could have built a real `formatTime`), this falls back to `in about N hours` rather
 *  than call a formatter that cannot exist. */
export function retryLine(retryAt: number, now: number, formatTime: (date: Date) => string): string {
  const remainingMs = Math.max(0, retryAt - now);
  if (remainingMs < MINUTE_MS) {
    return retryLineSeconds(Math.round(remainingMs / SECOND_MS));
  }
  if (remainingMs < HOUR_MS) {
    return retryLineMinutes(Math.round(remainingMs / MINUTE_MS));
  }
  if (typeof Intl === 'undefined') {
    return retryLineHoursFallback(Math.round(remainingMs / HOUR_MS));
  }
  const nowDate = new Date(now);
  const retryDate = new Date(retryAt);
  const sameLocalDay =
    nowDate.getFullYear() === retryDate.getFullYear() &&
    nowDate.getMonth() === retryDate.getMonth() &&
    nowDate.getDate() === retryDate.getDate();
  return sameLocalDay ? retryLineSameDay(formatTime(retryDate)) : retryLineTomorrow(formatTime(retryDate));
}
