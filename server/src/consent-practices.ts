/**
 * server/src/consent-practices.ts — which data practices each consent version covers
 * (request-envelope D7; #63 B10). The server runs a practice that sends data to a model provider or
 * stores data only when the request's consent version covers that practice's category, so a
 * server-side change can never widen what a phone agreed to.
 *
 * Every `/v1` route that calls a model or stores data declares its practice with `consentPractice`
 * as its first handler; a static check in the server suite fails when one does not. Clarify,
 * rewrite and generate require `request-material`, so a request sent with consent `none` is
 * refused `consent_required` before any admission or model work — a backstop, since the phone's
 * own gate never sends one. Report requires no grant: it is a user act on a screen that says what
 * goes (ai-data-consent's report exception). Server logging and the usage ledger are
 * `connection-logs` and `usage-records`, both covered from version 1. The report exemption also
 * covers the report's own usage-records ledger row and connection-log line: a report sent under
 * consent `none` still writes both, under that same exception, although `permits('none', …)` is
 * false for every category.
 *
 * The table is computed from the disclosure manifest (legal-surface-v2 D2): a version covers
 * exactly the categories its manifest lists, so the server and the published text can't drift.
 */
import type { MiddlewareHandler } from 'hono';
import type { ConsentVersion } from '@whim/contract';
import { CATEGORY_IDS, MANIFESTS, type CategoryId, type DisclosureManifest } from '../../contract/src/disclosure-manifest';
import { consentRequiredRefusal } from './admission/refusals';
import type { V1Env } from './request-edge';

/** The closed set of data categories a consent version can cover: the manifest's category ids. */
export const PRACTICE_CATEGORIES = CATEGORY_IDS;
export type PracticeCategory = CategoryId;

export type PracticeTable = Readonly<Record<number, ReadonlySet<PracticeCategory>>>;

/** Consent version → the category ids that version's manifest lists. */
export function practicesFrom(manifests: Readonly<Record<number, DisclosureManifest<PracticeCategory>>>): PracticeTable {
  return Object.freeze(
    Object.fromEntries(Object.entries(manifests).map(([version, manifest]) => [Number(version), new Set(manifest.categories.map((c) => c.id))])),
  );
}

/** Consent version → the categories it covers. APPEND-ONLY, as the manifest is: a new version is a
 *  new key, and an existing version never gains a category — a phone's grant means what it meant
 *  when it was given. */
export const PRACTICES: PracticeTable = practicesFrom(MANIFESTS);

/** The highest consent version `table` knows. */
export function highestConsentVersion(table: PracticeTable = PRACTICES): number {
  return Math.max(...Object.keys(table).map(Number));
}

/** Whether a request sent under `consent` may run a practice of `category`. `none` covers nothing.
 *  A version the table does not know is read as the highest known version at or below it — so a
 *  newer phone's higher version never grants this server more than the categories it knows. */
export function permits(consent: ConsentVersion, category: PracticeCategory, table: PracticeTable = PRACTICES): boolean {
  if (consent === 'none') return false;
  const known = Object.keys(table)
    .map(Number)
    .filter((version) => version <= consent);
  if (known.length === 0) return false;
  return table[Math.max(...known)]?.has(category) ?? false;
}

/** Whether a route's practice needs the request's consent to cover its category (`required`), or
 *  runs for any request (`exempt` — the report exception only). */
export type GrantRule = 'required' | 'exempt';

/** Declares a route's data practice and enforces it: with `required`, a request whose consent
 *  version does not cover `category` is refused `consent_required` (`403`) before the route's own
 *  handlers run. With `exempt` it only declares the category. */
export function consentPractice(category: PracticeCategory, grant: GrantRule): MiddlewareHandler<V1Env> {
  return async (c, next) => {
    if (grant === 'required' && !permits(c.get('envelope').consent, category)) {
      const r = consentRequiredRefusal();
      return c.json(r.body, r.status, r.headers);
    }
    await next();
  };
}
