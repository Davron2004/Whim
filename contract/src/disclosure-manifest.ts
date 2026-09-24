/**
 * disclosure-manifest — what Whim discloses, version by version (legal-surface-v2 design D1–D4;
 * spec ai-data-consent "The consent version changes only when the disclosure manifest widens" and
 * "The server's consent practices are derived from the manifest").
 *
 * Plain TypeScript data and pure functions: no zod and no import, so it never widens a consumer's
 * module graph. The server and `scripts/release/` import it at runtime; the device never does
 * (it names `WideningId` with `import type` through the package entry only).
 *
 * Versions are APPEND-ONLY. A released version (one with a snapshot under `RELEASED_SNAPSHOT_DIR`)
 * may only narrow or change wording; anything wider is a new version, and `AI_CONSENT_VERSION` in
 * `src/host/launcher/release-config.ts` must equal the highest key. `disclosureReleaseFindings` is
 * the release check: the fast gate, the release preflight and `deploy/deploy.sh` run it.
 */

/** Every category id any version lists. `request-envelope`'s four keep their ids (design D2). */
export const CATEGORY_IDS = [
  'request-material',
  'phone-id',
  'app-integrity',
  'usage-records',
  'error-details',
  'connection-logs',
  'reports',
] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];

/** How a category is consented to: the one Agree, its own opt-in, or an act the user takes for that
 *  purpose on a screen that says what goes (sending a report, buying a subscription). */
export type ConsentPath = 'main' | 'own-opt-in' | 'user-act';

/** Whether a Settings switch controls the category, and where it starts. */
export type Toggle = 'none' | 'default-on' | 'default-off';

/** The form in which the category carries anything saved inside a mini-app. */
export type SavedDataForm = 'none' | 'encrypted-on-phone' | 'readable';

/** The published maximum keep-period. `with`: kept only inside those categories' records, for as
 *  long as they are. `after: 'last-use'`: the period counts from the phone ID's last use. */
export type KeepRule<C extends string = string> =
  | { readonly kind: 'not-kept' }
  | { readonly kind: 'max-days'; readonly days: number; readonly after: 'collection' | 'last-use' }
  | { readonly kind: 'with'; readonly categories: readonly C[] };

/** One App Store declaration: `type` is the `app-privacy.json` category, `manifestType` the
 *  `PrivacyInfo.xcprivacy` data type, `purposes` the `app-privacy.json` purpose tokens. */
export interface AppleStoreType {
  readonly type: string;
  readonly manifestType: string;
  readonly linked: boolean;
  readonly purposes: readonly string[];
}

/** One Play Data safety declaration: `type` is the `data-safety.json` id. `shared` follows one rule:
 *  Shared when the data reaches a recipient whose service-provider status isn't confirmed. */
export interface PlayStoreType {
  readonly type: string;
  readonly optional: boolean;
  readonly shared: boolean;
  readonly purposes: readonly string[];
}

/** Several categories may map to one store type; a type's declaration is their union (required if
 *  any is required, shared if any is shared, every purpose any of them lists). */
export interface StoreMapping {
  readonly apple: readonly AppleStoreType[];
  readonly play: readonly PlayStoreType[];
}

export interface DisclosureRow {
  readonly name: string;
  readonly description: string;
}

export interface DisclosureCategory<C extends string = string> {
  readonly id: C;
  /** Display rows; `request-material` has two (the request and the app material). */
  readonly rows: readonly DisclosureRow[];
  /** What the category never carries, by stable id. Dropping an id is a widening. */
  readonly excludes: Readonly<Record<string, string>>;
  readonly keep: KeepRule<C>;
  readonly consent: ConsentPath;
  readonly toggle: Toggle;
  /** The consent screen's "What gets sent" names this category. */
  readonly onScreen: boolean;
  readonly savedData: SavedDataForm;
  readonly store: StoreMapping;
}

export interface RecipientRole {
  readonly id: string;
  readonly description: string;
  /** The consent screen's "Who gets it" must name this role; otherwise the policy alone does. */
  readonly namedOnScreen: boolean;
}

export interface Purpose {
  readonly id: string;
  readonly description: string;
  readonly advertisingOrTracking: boolean;
}

/** Allowed (category, role, purpose) triples: every role in `roles` × every purpose in `purposes`.
 *  An empty `purposes` records a recipient the text named without saying why. */
export interface DataUse<C extends string = string> {
  readonly category: C;
  readonly roles: readonly string[];
  readonly purposes: readonly string[];
}

export type CorePromiseId = 'saved-data-unreadable' | 'no-advertising' | 'requests-not-kept';

export interface CorePromise {
  readonly id: CorePromiseId;
  readonly text: string;
}

export interface DisclosureManifest<C extends string = string> {
  readonly categories: readonly DisclosureCategory<C>[];
  readonly roles: readonly RecipientRole[];
  readonly purposes: readonly Purpose[];
  readonly uses: readonly DataUse<C>[];
  readonly promises: readonly CorePromise[];
}

/** One clause of the widening rule that a change trips, with a stable id. */
export type WideningId =
  | `category:${string}`
  | `exclusion:${string}:${string}`
  | `recipient:${string}:${string}`
  | `purpose:${string}:${string}`
  | `role:${string}`
  | `keep:${string}`
  | `default:${string}`
  | `consent:${string}`
  | `promise:${CorePromiseId}`;

export const RELEASED_SNAPSHOT_DIR = 'contract/disclosure/released';

// ── Store mapping building blocks ────────────────────────────────────────────────────────────

const APPLE_USER_CONTENT = { type: 'OTHER_USER_CONTENT', manifestType: 'NSPrivacyCollectedDataTypeOtherUserContent' } as const;
const APPLE_DEVICE_ID = { type: 'DEVICE_ID', manifestType: 'NSPrivacyCollectedDataTypeDeviceID' } as const;
const NO_STORE_TYPE: StoreMapping = { apple: [], play: [] };

// ── Version 1: the v1 disclosure (consent screen, privacy page and store answers until v2) ────
//
// Only what v1 disclosed. Its text named no authorities, no successor and no legal-obligation
// purpose; its service providers were the AI companies, which got request material and nothing
// else; it used requests only to make the app; and it said server logs exist on AnyCognition's
// server but not why (a use with no purpose). Version 2 widening any of these is named in its
// what's-new line. Its store mapping is what v1 declared, "not linked" included.

const OPERATE_ONLY = ['operate'] as const;

const MANIFEST_V1: DisclosureManifest<CategoryId> = {
  categories: [
    {
      id: 'request-material',
      rows: [
        { name: 'Request', description: 'What you ask for: your description, your answers to Whim’s questions, and the plan you approve' },
        { name: 'App material', description: 'When you change an app: its name, its code, its current description, and the layout of its saved data' },
      ],
      excludes: { 'saved-data': 'Anything you save inside your apps' },
      keep: { kind: 'not-kept' },
      consent: 'main',
      toggle: 'none',
      onScreen: true,
      savedData: 'none',
      store: {
        apple: [{ ...APPLE_USER_CONTENT, linked: false, purposes: ['APP_FUNCTIONALITY'] }],
        play: [{ type: 'other_user_generated_content', optional: true, shared: true, purposes: ['app_functionality'] }],
      },
    },
    {
      id: 'phone-id',
      rows: [{ name: 'Phone ID', description: 'An anonymous ID for this phone, used for daily limits' }],
      excludes: {},
      keep: { kind: 'with', categories: ['usage-records', 'reports'] },
      consent: 'main',
      toggle: 'none',
      onScreen: true,
      savedData: 'none',
      store: {
        apple: [{ ...APPLE_DEVICE_ID, linked: false, purposes: ['APP_FUNCTIONALITY'] }],
        play: [{ type: 'device_or_other_ids', optional: true, shared: false, purposes: ['app_functionality', 'fraud_prevention_security_compliance'] }],
      },
    },
    {
      id: 'usage-records',
      rows: [{ name: 'Usage ledger', description: 'One row per request: the phone’s ID, the request type, timestamps, the outcome, token counts and cost' }],
      excludes: { 'request-content': 'Request content' },
      keep: { kind: 'max-days', days: 90, after: 'collection' },
      consent: 'main',
      toggle: 'none',
      onScreen: false,
      savedData: 'none',
      store: NO_STORE_TYPE,
    },
    {
      id: 'connection-logs',
      rows: [{ name: 'Server logs', description: 'What the server logs about each request' }],
      excludes: { 'request-content': 'Request content' },
      keep: { kind: 'max-days', days: 90, after: 'collection' },
      consent: 'main',
      toggle: 'none',
      onScreen: false,
      savedData: 'none',
      store: NO_STORE_TYPE,
    },
    {
      id: 'reports',
      rows: [
        {
          name: 'Reports',
          description: 'The reason picked, any note, the app’s name, the phone’s ID, the reported version’s code when saved, and the prompt if the user includes it',
        },
      ],
      excludes: {},
      keep: { kind: 'max-days', days: 90, after: 'collection' },
      consent: 'user-act',
      toggle: 'none',
      onScreen: false,
      savedData: 'none',
      store: {
        apple: [{ ...APPLE_USER_CONTENT, linked: false, purposes: ['APP_FUNCTIONALITY'] }],
        play: [{ type: 'other_user_generated_content', optional: true, shared: false, purposes: ['app_functionality'] }],
      },
    },
  ],
  roles: [
    { id: 'anycognition', description: 'AnyCognition’s server', namedOnScreen: true },
    { id: 'service-providers', description: 'Other companies whose AI models write the app, which may process requests outside Canada', namedOnScreen: true },  ],
  purposes: [
    { id: 'build', description: 'Make or change an app', advertisingOrTracking: false },
    { id: 'operate', description: 'Daily limits', advertisingOrTracking: false },
    { id: 'safety', description: 'Investigate what a report says went wrong', advertisingOrTracking: false },
  ],
  uses: [
    { category: 'request-material', roles: ['anycognition', 'service-providers'], purposes: ['build'] },
    { category: 'phone-id', roles: ['anycognition'], purposes: ['operate', 'safety'] },
    { category: 'usage-records', roles: ['anycognition'], purposes: OPERATE_ONLY },
    { category: 'connection-logs', roles: ['anycognition'], purposes: [] },
    { category: 'reports', roles: ['anycognition'], purposes: ['safety'] },
  ],
  promises: [
    { id: 'saved-data-unreadable', text: 'Anything you save inside your apps never gets sent.' },
    { id: 'no-advertising', text: 'No ads, and no advertising SDKs.' },
  ],
};

// ── Version 2: README "Manifest, version 2", owner decisions of 2026-09-23 applied ─────────────

const MANIFEST_V2: DisclosureManifest<CategoryId> = {
  categories: [
    {
      id: 'request-material',
      rows: [
        { name: 'Request', description: 'What you type or dictate, your answers, and the plan you approve' },
        { name: 'App material', description: 'For a change: an app’s name, code, description and data layout' },
      ],
      excludes: { 'saved-data': 'Anything saved in the app' },
      keep: { kind: 'not-kept' },
      consent: 'main',
      toggle: 'none',
      onScreen: true,
      savedData: 'none',
      store: {
        apple: [{ ...APPLE_USER_CONTENT, linked: true, purposes: ['APP_FUNCTIONALITY'] }],
        play: [
          { type: 'other_user_generated_content', optional: false, shared: true, purposes: ['app_functionality', 'fraud_prevention_security_compliance'] },
        ],
      },
    },
    {
      id: 'phone-id',
      rows: [{ name: 'Phone ID', description: 'A random ID made on the phone' }],
      excludes: { 'hardware-ids': 'Hardware IDs', name: 'Your name', 'phone-number': 'Your phone number' },
      keep: { kind: 'with', categories: ['usage-records', 'reports'] },
      consent: 'main',
      toggle: 'none',
      onScreen: true,
      savedData: 'none',
      store: {
        apple: [{ ...APPLE_DEVICE_ID, linked: true, purposes: ['APP_FUNCTIONALITY', 'ANALYTICS'] }],
        play: [
          { type: 'device_or_other_ids', optional: false, shared: false, purposes: ['app_functionality', 'analytics', 'fraud_prevention_security_compliance'] },
        ],
      },
    },
    {
      id: 'app-integrity',
      rows: [
        {
          name: 'App-integrity check',
          description:
            'A key made on the phone and a verdict from Apple or Google on whether a request comes from a genuine Whim app on a real device, bound to the phone ID',
        },
      ],
      excludes: { 'hardware-ids': 'Hardware IDs', 'store-account': 'Your Apple or Google account' },
      keep: { kind: 'max-days', days: 365, after: 'last-use' },
      consent: 'main',
      toggle: 'none',
      onScreen: false,
      savedData: 'none',
      store: {
        apple: [{ ...APPLE_DEVICE_ID, linked: true, purposes: ['APP_FUNCTIONALITY'] }],
        play: [{ type: 'device_or_other_ids', optional: false, shared: false, purposes: ['fraud_prevention_security_compliance'] }],
      },
    },
    {
      id: 'usage-records',
      rows: [
        {
          name: 'Usage records',
          description:
            'Per request: type, times, how it ended (including an error code), size, cost and request number; running lifetime totals per phone ID',
        },
      ],
      excludes: { 'request-content': 'Request content' },
      keep: { kind: 'max-days', days: 365, after: 'last-use' },
      consent: 'main',
      toggle: 'none',
      onScreen: false,
      savedData: 'none',
      store: {
        apple: [
          {
            type: 'PRODUCT_INTERACTION',
            manifestType: 'NSPrivacyCollectedDataTypeProductInteraction',
            linked: true,
            purposes: ['APP_FUNCTIONALITY', 'ANALYTICS'],
          },
        ],
        play: [{ type: 'app_interactions', optional: false, shared: false, purposes: ['app_functionality', 'analytics', 'fraud_prevention_security_compliance'] }],
      },
    },
    {
      id: 'error-details',
      rows: [
        {
          name: 'Error details',
          description: 'Technical details when something breaks: versions, error type from a fixed list, code location, screen and request number',
        },
      ],
      excludes: {
        'typed-text': 'Anything you typed',
        'saved-data': 'Anything saved in your apps',
        'free-text-errors': 'Any free-text error name or message from a mini-app',
      },
      keep: { kind: 'max-days', days: 90, after: 'collection' },
      consent: 'main',
      toggle: 'default-on',
      onScreen: true,
      savedData: 'none',
      store: {
        apple: [
          { type: 'CRASH_DATA', manifestType: 'NSPrivacyCollectedDataTypeCrashData', linked: true, purposes: ['APP_FUNCTIONALITY', 'ANALYTICS'] },
          {
            type: 'OTHER_DIAGNOSTIC_DATA',
            manifestType: 'NSPrivacyCollectedDataTypeOtherDiagnosticData',
            linked: true,
            purposes: ['APP_FUNCTIONALITY', 'ANALYTICS'],
          },
        ],
        play: [
          { type: 'crash_logs', optional: true, shared: false, purposes: ['analytics', 'app_functionality'] },
          { type: 'diagnostics', optional: true, shared: false, purposes: ['analytics', 'app_functionality'] },
        ],
      },
    },
    {
      id: 'connection-logs',
      rows: [
        {
          name: 'Connection and log data',
          description:
            'IP address, times, the app’s version and build number, the consent version and similar details any server sees, including visits to Whim’s website; security and operational logs',
        },
      ],
      excludes: { 'request-content': 'Request content' },
      keep: { kind: 'max-days', days: 90, after: 'collection' },
      consent: 'main',
      toggle: 'none',
      onScreen: false,
      savedData: 'none',
      // IP addresses are declared by how they're used, and Whim uses them for neither location nor limits.
      store: NO_STORE_TYPE,
    },
    {
      id: 'reports',
      rows: [{ name: 'Reports', description: 'Reason, note, app name, the app’s code if saved, and the prompt if the user includes it' }],
      excludes: { 'saved-data': 'Anything saved in the app, unless the user types it into the note' },
      keep: { kind: 'max-days', days: 365, after: 'collection' },
      consent: 'user-act',
      toggle: 'none',
      onScreen: false,
      savedData: 'none',
      store: {
        apple: [{ ...APPLE_USER_CONTENT, linked: true, purposes: ['APP_FUNCTIONALITY'] }],
        play: [
          { type: 'other_user_generated_content', optional: true, shared: false, purposes: ['app_functionality', 'fraud_prevention_security_compliance'] },
        ],
      },
    },
  ],
  roles: [
    { id: 'anycognition', description: 'AnyCognition, the company that makes Whim', namedOnScreen: true },
    {
      id: 'service-providers',
      description:
        'Companies acting only for AnyCognition, such as hosting, AI, logging and email, some outside Canada. They may keep data briefly for their own security and legal duties, but never train AI on it or use it for their own products',
      namedOnScreen: true,
    },
    {
      id: 'platform',
      description: 'The phone’s platform, Apple or Google, for app-integrity checks under its own terms, and for verifying a purchase the user made with it',
      namedOnScreen: true,
    },
    { id: 'authorities', description: 'Authorities when the law requires it, and when handling fraud, security or safety problems', namedOnScreen: true },
    { id: 'successor', description: 'A successor if Whim changes hands, bound by the same policy', namedOnScreen: false },
  ],
  purposes: [
    { id: 'build', description: 'Build and change your apps', advertisingOrTracking: false },
    {
      id: 'operate',
      description: 'Run Whim: daily limits, abuse and fraud prevention, security, keeping it working, finding and fixing problems, cost and capacity',
      advertisingOrTracking: false,
    },
    { id: 'safety', description: 'Handle reports and keep Whim safe', advertisingOrTracking: false },
    { id: 'legal', description: 'Meet legal obligations', advertisingOrTracking: false },
  ],
  uses: [
    { category: 'request-material', roles: ['anycognition', 'service-providers'], purposes: ['build', 'operate'] },
    { category: 'request-material', roles: ['authorities'], purposes: ['legal'] },
    { category: 'request-material', roles: ['successor'], purposes: ['build', 'operate'] },
    { category: 'phone-id', roles: ['anycognition', 'service-providers'], purposes: ['operate', 'safety'] },
    { category: 'phone-id', roles: ['authorities'], purposes: ['legal', 'safety'] },
    { category: 'phone-id', roles: ['successor'], purposes: ['operate', 'safety'] },
    { category: 'usage-records', roles: ['anycognition', 'service-providers'], purposes: OPERATE_ONLY },
    { category: 'usage-records', roles: ['authorities'], purposes: ['legal', 'safety'] },
    { category: 'usage-records', roles: ['successor'], purposes: OPERATE_ONLY },
    { category: 'connection-logs', roles: ['anycognition', 'service-providers'], purposes: ['operate', 'safety'] },
    { category: 'connection-logs', roles: ['authorities'], purposes: ['legal', 'safety'] },
    { category: 'connection-logs', roles: ['successor'], purposes: ['operate', 'safety'] },
    { category: 'reports', roles: ['anycognition', 'service-providers'], purposes: ['safety'] },
    { category: 'reports', roles: ['authorities'], purposes: ['legal', 'safety'] },
    { category: 'reports', roles: ['successor'], purposes: ['safety'] },
    { category: 'app-integrity', roles: ['anycognition', 'service-providers', 'platform'], purposes: OPERATE_ONLY },
    { category: 'app-integrity', roles: ['authorities'], purposes: ['legal', 'safety'] },
    { category: 'app-integrity', roles: ['successor'], purposes: OPERATE_ONLY },
    { category: 'error-details', roles: ['anycognition', 'service-providers'], purposes: OPERATE_ONLY },
    { category: 'error-details', roles: ['authorities'], purposes: ['legal'] },
    { category: 'error-details', roles: ['successor'], purposes: OPERATE_ONLY },
  ],
  promises: [
    {
      id: 'saved-data-unreadable',
      text: 'Nobody at Whim can read what you save inside your apps. It reaches Whim, if ever, only encrypted on the phone with a key Whim never has, and only through a feature you turn on.',
    },
    { id: 'no-advertising', text: 'No ads, no selling or sharing data for advertising, and no tracking across other apps and websites.' },
    { id: 'requests-not-kept', text: 'Requests aren’t kept after they’re handled, except inside a report.' },
  ],
};

/** Consent version → the disclosure that version's grant covers. APPEND-ONLY. */
export const MANIFESTS: Readonly<Record<number, DisclosureManifest<CategoryId>>> = { 1: MANIFEST_V1, 2: MANIFEST_V2 };

/** Reviewed reasons for a version that doesn't widen the one before it (a defect found in the
 *  previous consent, data sent without a grant). Keyed by the bumped version. */
export const BUMP_REASONS: Readonly<Record<number, string>> = {};

/** The highest version `manifests` holds (0 when empty). */
export function latestVersion(manifests: Readonly<Record<number, unknown>> = MANIFESTS): number {
  return Math.max(0, ...Object.keys(manifests).map(Number));
}

// ── The widening diff ─────────────────────────────────────────────────────────────────────────

/** A published maximum as days, and where it counts from. */
export interface KeepLimit {
  readonly days: number;
  readonly after: 'collection' | 'last-use';
}

/** A category's published maximum in `manifest`, resolving `with` to its longest carrier;
 *  `undefined` when the category isn't kept (or isn't listed). */
export function keepLimit(manifest: DisclosureManifest, categoryId: string): KeepLimit | undefined {
  const rule = manifest.categories.find((c) => c.id === categoryId)?.keep;
  if (rule === undefined || rule.kind === 'not-kept') return undefined;
  if (rule.kind === 'max-days') return { days: rule.days, after: rule.after };
  let limit: KeepLimit | undefined;
  for (const carrier of rule.categories) {
    const carried = manifest.categories.find((c) => c.id === carrier)?.keep;
    if (carried?.kind !== 'max-days') continue;
    limit = {
      days: Math.max(limit?.days ?? 0, carried.days),
      after: limit?.after === 'last-use' || carried.after === 'last-use' ? 'last-use' : 'collection',
    };
  }
  return limit;
}

function keepWidened(from: DisclosureManifest, to: DisclosureManifest, oldRule: KeepRule, newRule: KeepRule, id: string): boolean {
  if (newRule.kind === 'not-kept') return false;
  if (oldRule.kind === 'not-kept') return true;
  // Same carriers: a longer carrier is the carrier's own `keep:` widening, not this one's.
  if (oldRule.kind === 'with' && newRule.kind === 'with') return newRule.categories.some((c) => !oldRule.categories.includes(c));
  const was = keepLimit(from, id);
  const now = keepLimit(to, id);
  if (now === undefined) return false;
  if (was === undefined) return true;
  return now.days > was.days || (now.after === 'last-use' && was.after === 'collection');
}

function pairsOf(manifest: DisclosureManifest, categoryId: string, side: 'roles' | 'purposes'): Set<string> {
  return new Set(manifest.uses.filter((u) => u.category === categoryId).flatMap((u) => u[side]));
}

function sharedCategoryWidenings(from: DisclosureManifest, to: DisclosureManifest, before: DisclosureCategory, after: DisclosureCategory): WideningId[] {
  const id = after.id;
  const found: WideningId[] = [];
  for (const exclusion of Object.keys(before.excludes)) {
    if (!Object.hasOwn(after.excludes, exclusion)) found.push(`exclusion:${id}:${exclusion}`);
  }
  if (keepWidened(from, to, before.keep, after.keep, id)) found.push(`keep:${id}`);
  if (before.consent !== 'main' && after.consent === 'main') found.push(`consent:${id}`);
  else if (before.consent === after.consent && before.toggle === 'default-off' && after.toggle !== 'default-off') found.push(`default:${id}`);
  const oldRoles = new Set(from.roles.map((r) => r.id));
  const roles = pairsOf(from, id, 'roles');
  for (const role of pairsOf(to, id, 'roles')) {
    // A new role's pairs are covered by its own `role:` widening.
    if (!roles.has(role) && oldRoles.has(role)) found.push(`recipient:${id}:${role}`);
  }
  const purposes = pairsOf(from, id, 'purposes');
  for (const purpose of pairsOf(to, id, 'purposes')) {
    if (!purposes.has(purpose)) found.push(`purpose:${id}:${purpose}`);
  }
  return found;
}

/** Whether a new category leaves the phone before the user opts in or acts for it. */
function needsMainGrant(category: DisclosureCategory): boolean {
  return category.consent === 'main' || (category.consent === 'own-opt-in' && category.toggle !== 'default-off');
}

const PROMISE_HOLDS: Readonly<Record<CorePromiseId, (manifest: DisclosureManifest) => boolean>> = {
  'saved-data-unreadable': (m) =>
    m.categories.every((c) => c.savedData === 'none' || (c.savedData === 'encrypted-on-phone' && c.consent === 'own-opt-in')),
  'no-advertising': (m) => m.purposes.every((p) => !p.advertisingOrTracking),
  'requests-not-kept': (m) => m.categories.every((c) => c.id !== 'request-material' || c.keep.kind === 'not-kept'),
};

function isKnownPromise(id: string): id is CorePromiseId {
  return Object.hasOwn(PROMISE_HOLDS, id);
}

/** A promise id a parsed snapshot names but this module doesn't know counts as broken. */
function promiseHolds(id: string, manifest: DisclosureManifest): boolean {
  return isKnownPromise(id) && PROMISE_HOLDS[id](manifest);
}

/** Every widening from `from` to `to`, per spec ai-data-consent's widening list, sorted. A new
 *  category's (or role's) own pairs are covered by its `category:` (`role:`) id. */
export function diffManifests(from: DisclosureManifest, to: DisclosureManifest): WideningId[] {
  const found = new Set<WideningId>([...categoryWidenings(from, to), ...roleAndPromiseWidenings(from, to)]);
  return [...found].sort((a, b) => a.localeCompare(b));
}

function categoryWidenings(from: DisclosureManifest, to: DisclosureManifest): WideningId[] {
  return to.categories.flatMap((after): WideningId[] => {
    const before = from.categories.find((c) => c.id === after.id);
    if (before !== undefined) return sharedCategoryWidenings(from, to, before, after);
    return needsMainGrant(after) ? [`category:${after.id}`] : [];
  });
}

function roleAndPromiseWidenings(from: DisclosureManifest, to: DisclosureManifest): WideningId[] {
  const roles = to.roles.filter((role) => !from.roles.some((r) => r.id === role.id)).map((role): WideningId => `role:${role.id}`);
  const promises = from.promises
    .filter((promise) => !(to.promises.some((p) => p.id === promise.id) && promiseHolds(promise.id, to)))
    .map((promise): WideningId => `promise:${promise.id}`);
  return [...roles, ...promises];
}

// ── Manifest shape ────────────────────────────────────────────────────────────────────────────

function duplicateIds(kind: string, ids: readonly string[]): string[] {
  return ids.filter((id, index) => ids.indexOf(id) !== index).map((id) => `${kind} "${id}" is listed twice`);
}

function dataUseFindings(manifest: DisclosureManifest): string[] {
  const known = {
    category: new Set(manifest.categories.map((c) => c.id)),
    role: new Set(manifest.roles.map((r) => r.id)),
    purpose: new Set(manifest.purposes.map((p) => p.id)),
  };
  const findings: string[] = [];
  for (const use of manifest.uses) {
    if (!known.category.has(use.category)) findings.push(`a use names unknown category "${use.category}"`);
    if (use.roles.length === 0) findings.push(`a use of "${use.category}" names no role`);
    for (const role of use.roles.filter((r) => !known.role.has(r))) findings.push(`a use of "${use.category}" names unknown role "${role}"`);
    for (const purpose of use.purposes.filter((p) => !known.purpose.has(p))) findings.push(`a use of "${use.category}" names unknown purpose "${purpose}"`);
  }
  for (const id of known.category) {
    if (!manifest.uses.some((u) => u.category === id)) findings.push(`category "${id}" has no use`);
  }
  return findings;
}

function categoryFindings(manifest: DisclosureManifest, category: DisclosureCategory): string[] {
  const findings: string[] = [];
  const { keep } = category;
  if (keep.kind === 'max-days' && !(Number.isInteger(keep.days) && keep.days > 0)) {
    findings.push(`category "${category.id}" keeps for ${keep.days} days, not a positive whole number`);
  }
  if (keep.kind === 'with') {
    for (const carrier of keep.categories) {
      const carried = manifest.categories.find((c) => c.id === carrier)?.keep;
      if (carried?.kind !== 'max-days') findings.push(`category "${category.id}" is kept with "${carrier}", which is not a category with its own maximum`);
    }
  }
  if (category.consent === 'own-opt-in' && category.toggle === 'none') findings.push(`category "${category.id}" is its own opt-in but has no switch`);
  return findings;
}

/** Structural problems that would make `diffManifests` read a manifest wrongly. */
export function manifestShapeFindings(manifest: DisclosureManifest): string[] {
  return [
    ...duplicateIds('category', manifest.categories.map((c) => c.id)),
    ...duplicateIds('role', manifest.roles.map((r) => r.id)),
    ...duplicateIds('purpose', manifest.purposes.map((p) => p.id)),
    ...duplicateIds('promise', manifest.promises.map((p) => p.id)),
    ...dataUseFindings(manifest),
    ...manifest.categories.flatMap((c) => categoryFindings(manifest, c)),
    ...manifest.promises.filter((p) => !isKnownPromise(p.id)).map((p) => `core promise "${p.id}" is not one this module knows`),
    ...manifest.promises.filter((p) => isKnownPromise(p.id) && !promiseHolds(p.id, manifest)).map((p) => `lists core promise "${p.id}" but breaks it`),
  ];
}

// ── The release check (design D3/D4) ──────────────────────────────────────────────────────────

/** One authored what's-new line (design D4): `covers` must equal the widenings it names. */
export interface WhatsNewLine {
  readonly text: string;
  readonly covers: readonly string[];
}

export interface DisclosureReleaseInput {
  /** Defaults to `MANIFESTS`. */
  readonly manifests?: Readonly<Record<number, DisclosureManifest>>;
  /** Parsed snapshots under `RELEASED_SNAPSHOT_DIR`, by version. */
  readonly released: Readonly<Record<number, DisclosureManifest>>;
  /** `AI_CONSENT_VERSION` from the launcher's release config. */
  readonly consentVersion: number;
  /** Defaults to `BUMP_REASONS`. */
  readonly bumpReasons?: Readonly<Record<number, string>>;
  /** Language → the version a grant was given under → its what's-new line. */
  readonly whatsNew: Readonly<Record<string, Readonly<Record<number, WhatsNewLine>>>>;
}

type ResolvedReleaseInput = Required<DisclosureReleaseInput>;

function versionFindings(versions: readonly number[], current: number, consentVersion: number): string[] {
  const findings: string[] = [];
  if (versions.some((v, index) => v !== index + 1)) {
    findings.push(`manifest versions must run 1, 2, 3… with no gap; found ${versions.join(', ')}`);
  }
  if (consentVersion !== current) {
    findings.push(`AI_CONSENT_VERSION is ${consentVersion} but the highest disclosure manifest version is ${current}; they must be equal`);
  }
  return findings;
}

function releasedFindings(input: ResolvedReleaseInput, versions: readonly number[]): string[] {
  const findings: string[] = [];
  for (const released of Object.keys(input.released).map(Number)) {
    const manifest = input.manifests[released];
    if (manifest === undefined) {
      findings.push(`released version ${released} has no manifest; released versions are append-only`);
      continue;
    }
    const widened = diffManifests(input.released[released], manifest);
    if (widened.length > 0) {
      findings.push(`version ${released} was released and has widened since ${RELEASED_SNAPSHOT_DIR}/v${released}.json: ${widened.join(', ')}; add a new version instead`);
    }
  }
  for (const version of versions.filter((v) => input.released[v] === undefined)) {
    findings.push(`version ${version} has no snapshot at ${RELEASED_SNAPSHOT_DIR}/v${version}.json; check it in with the version`);
  }
  return findings;
}

function bumpFindings(input: ResolvedReleaseInput, versions: readonly number[]): string[] {
  const findings: string[] = [];
  for (let index = 1; index < versions.length; index++) {
    const version = versions[index];
    const widened = diffManifests(input.manifests[versions[index - 1]], input.manifests[version]);
    if (widened.length === 0 && (input.bumpReasons[version] ?? '').trim() === '') {
      findings.push(`version ${version} does not widen version ${versions[index - 1]} and BUMP_REASONS[${version}] is missing; a bump needs a widening or a reviewed reason`);
    }
  }
  return findings;
}

function coverFindings(language: string, version: number, line: WhatsNewLine, expected: readonly string[]): string[] {
  const where = `what's-new (${language}) for version ${version}`;
  if (line.text.trim() === '') return [`${where} has no text`];
  const missing = expected.filter((id) => !line.covers.includes(id));
  const extra = line.covers.filter((id) => !expected.includes(id));
  const findings: string[] = [];
  if (missing.length > 0) findings.push(`${where} does not cover ${missing.join(', ')}`);
  if (extra.length > 0) findings.push(`${where} covers ${extra.join(', ')}, which did not widen`);
  return findings;
}

function whatsNewFindings(input: ResolvedReleaseInput, versions: readonly number[], current: number): string[] {
  const older = versions.filter((v) => v < current);
  const languages = Object.keys(input.whatsNew);
  if (older.length > 0 && languages.length === 0) return ['no what\'s-new table exists; every older version needs a line'];
  const findings: string[] = [];
  for (const language of languages) {
    const table = input.whatsNew[language];
    for (const version of older) {
      const line = table[version];
      if (line === undefined) findings.push(`what's-new (${language}) has no line for version ${version}`);
      else findings.push(...coverFindings(language, version, line, diffManifests(input.manifests[version], input.manifests[current])));
    }
    for (const version of Object.keys(table).map(Number).filter((v) => !older.includes(v))) {
      findings.push(`what's-new (${language}) has a line for version ${version}, which is not an older version`);
    }
  }
  return findings;
}

/** Every reason a build or deploy must refuse under the re-consent rule; empty when it may ship. */
export function disclosureReleaseFindings(given: DisclosureReleaseInput): string[] {
  const input: ResolvedReleaseInput = { ...given, manifests: given.manifests ?? MANIFESTS, bumpReasons: given.bumpReasons ?? BUMP_REASONS };
  const versions = Object.keys(input.manifests)
    .map(Number)
    .sort((a, b) => a - b);
  if (versions.length === 0) return ['no disclosure manifest version exists'];
  const current = latestVersion(input.manifests);
  return [
    ...versionFindings(versions, current, input.consentVersion),
    ...versions.flatMap((v) => manifestShapeFindings(input.manifests[v]).map((f) => `version ${v}: ${f}`)),
    ...releasedFindings(input, versions),
    ...bumpFindings(input, versions),
    ...whatsNewFindings(input, versions, current),
  ];
}
