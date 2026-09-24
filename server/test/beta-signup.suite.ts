/**
 * POST /beta/signup acceptance (beta-waitlist task 2.6): every scenario of the spec's "Signup
 * route", "Abuse limits" and "Emails never logged", against `createApp()` with the in-memory
 * waitlist store and the server's real logger captured.
 */
import { check, eq, section } from './harness';
import { TIMED_OUT, within } from './route-doubles';
import { captureLogs, withMessage, type LogCapture } from './log-capture';
import { createApp, type AppOptions } from '../src/app';
import { createStubPipeline } from '../src/pipeline';
import { InMemoryUsageStore } from '../src/usage-store';
import { loadServerConfig, type ServerConfig } from '../src/config';
import { shapeOnlyVerifier } from '../src/device-identity';
import { createServerLogger, REDACTED } from '../src/logger';
import { MAX_EMAIL_BYTES, TRAP_FIELD } from '../src/routes/beta-signup';
import { CURRENT_NOTICE_ID } from '../src/waitlist/notices';
import { InMemoryWaitlistStore, type WaitlistStore } from '../src/waitlist/store';

const PAGES = 'https://pages.example.test';
const THANKS = `${PAGES}/beta/thanks`;
const RETRY = `${PAGES}/beta/retry`;
const CLIENT = '203.0.113.9';
const OTHER_CLIENT = '198.51.100.4';
const NOW = Date.UTC(2026, 8, 24, 19, 0, 0);

interface Harness {
  readonly app: ReturnType<typeof createApp>;
  readonly store: InMemoryWaitlistStore;
}

function harness(config: Partial<ServerConfig> = {}, options: Partial<AppOptions> = {}): Harness {
  const store = new InMemoryWaitlistStore();
  const app = createApp({
    pipeline: createStubPipeline(0),
    usageStore: new InMemoryUsageStore(),
    waitlistStore: store,
    ...options,
    config: { ...loadServerConfig({ WHIM_WEB_ORIGIN: PAGES }), now: () => NOW, ...config },
  });
  return { app, store };
}

type Fields = Readonly<Record<string, string>>;

const VALID: Fields = { email: 'Person@Example.com', platform: 'android' };

async function post(
  app: ReturnType<typeof createApp>,
  body: Fields | string,
  headers: Readonly<Record<string, string>> = { 'x-forwarded-for': CLIENT },
  contentType = 'application/x-www-form-urlencoded',
): Promise<Response> {
  const res = await within(
    Promise.resolve(
      app.request('/beta/signup', {
        method: 'POST',
        headers: { 'content-type': contentType, ...headers },
        body: typeof body === 'string' ? body : new URLSearchParams(body).toString(),
      }),
    ),
  );
  if (res === TIMED_OUT) throw new Error('/beta/signup did not answer in time');
  return res;
}

function redirectsTo(res: Response): string {
  return `${res.status} ${res.headers.get('location') ?? '(no location)'}`;
}

async function signupRouteTests(): Promise<void> {
  section('Beta signup: a valid signup is stored and thanked');

  {
    const { app, store } = harness();
    const res = await post(app, VALID);
    eq('a valid form post answers 303 to the pages host\'s /beta/thanks', redirectsTo(res), `303 ${THANKS}`);
    eq('  ... storing one row for the normalized email, android, no opt-out, the current notice id', store.export().map((row) => ({ email: row.email, platform: row.platform, updatesOptOut: row.updatesOptOut, noticeId: row.noticeId })), [
      { email: 'person@example.com', platform: 'android', updatesOptOut: false, noticeId: CURRENT_NOTICE_ID },
    ]);
    const optedOut = await post(app, { email: 'quiet@example.com', platform: 'ios', updates_opt_out: '1' });
    eq('the opt-out box (value 1) is stored as an opt-out', [redirectsTo(optedOut), store.export().find((row) => row.email === 'quiet@example.com')?.updatesOptOut], [`303 ${THANKS}`, true]);
  }

  section('Beta signup: an invalid signup stores nothing and goes to retry');

  const longest = `${'a'.repeat(MAX_EMAIL_BYTES - '@example.com'.length)}@example.com`;
  const invalid: ReadonlyArray<readonly [string, Fields]> = [
    ['no @', { email: 'person.example.com', platform: 'ios' }],
    ['two @', { email: 'a@b@example.com', platform: 'ios' }],
    ['a domain with no dot', { email: 'person@localhost', platform: 'ios' }],
    ['a space inside', { email: 'per son@example.com', platform: 'ios' }],
    ['an empty label', { email: 'person@example..com', platform: 'ios' }],
    ['a spreadsheet-formula start', { email: '=HYPERLINK(1)@example.com', platform: 'ios' }],
    [`${MAX_EMAIL_BYTES + 1} bytes`, { email: `a${longest}`, platform: 'ios' }],
    ['no email', { platform: 'ios' }],
    ['a platform outside the set', { email: 'person@example.com', platform: 'windows' }],
    ['no platform', { email: 'person@example.com' }],
    ['an opt-out value other than 1', { email: 'person@example.com', platform: 'ios', updates_opt_out: 'on' }],
  ];
  for (const [what, fields] of invalid) {
    const { app, store } = harness();
    const res = await post(app, fields);
    eq(`${what}: 303 to /beta/retry, nothing stored`, [redirectsTo(res), store.export().length], [`303 ${RETRY}`, 0]);
  }
  {
    const { app, store } = harness();
    const res = await post(app, { email: longest, platform: 'other' });
    eq(`exactly ${MAX_EMAIL_BYTES} bytes is still a valid email`, [redirectsTo(res), store.export().length], [`303 ${THANKS}`, 1]);
  }
  {
    const { app, store } = harness();
    const res = await post(app, JSON.stringify(VALID), undefined, 'application/json');
    eq('a JSON body is not the form: retry, nothing stored', [redirectsTo(res), store.export().length], [`303 ${RETRY}`, 0]);
  }

  section('Beta signup: no device header, and /v1 still refuses without one');

  {
    const { app, store } = harness();
    const res = await post(app, VALID, { 'x-forwarded-for': CLIENT });
    eq('a signup with no x-whim-device is stored', [redirectsTo(res), store.export().length], [`303 ${THANKS}`, 1]);
    const expected = await shapeOnlyVerifier.verify(new Headers());
    const v1 = await within(Promise.resolve(app.request('/v1/usage')));
    if (v1 === TIMED_OUT) throw new Error('/v1/usage did not answer in time');
    const gate = expected.ok ? undefined : { status: expected.status, error: expected.body.error };
    eq('GET /v1/usage without x-whim-device gets the device gate\'s own refusal', { status: v1.status, error: ((await v1.json()) as { error?: string }).error }, gate);
  }

  section('Beta signup: a store failure still answers the browser with a redirect');

  {
    const failing: WaitlistStore = {
      upsert: () => {
        throw new Error('database is locked');
      },
      export: () => [],
      remove: () => false,
      purge: () => 0,
    };
    const { app } = harness({}, { waitlistStore: failing });
    eq('303 to /beta/retry', redirectsTo(await post(app, VALID)), `303 ${RETRY}`);
  }
}

async function abuseLimitTests(): Promise<void> {
  section('Beta signup: abuse limits');

  {
    const { app, store } = harness();
    const padding = 'x'.repeat(5000);
    const res = await post(app, { ...VALID, padding });
    eq('a post over WHIM_MAX_BODY_BYTES_BETA (4096) goes to retry and stores nothing', [redirectsTo(res), store.export().length], [`303 ${RETRY}`, 0]);
    const under = await post(app, { ...VALID, padding: 'x'.repeat(3000) });
    eq('  ... while the same form under the cap is stored', [redirectsTo(under), store.export().length], [`303 ${THANKS}`, 1]);
  }

  {
    const { app, store } = harness({ betaLimitPerClientHour: 2 });
    const answers: string[] = [];
    for (const n of [1, 2, 3]) answers.push(redirectsTo(await post(app, { email: `person${n}@example.com`, platform: 'ios' })));
    eq('one client address over its hourly limit: the third signup goes to retry', answers, [`303 ${THANKS}`, `303 ${THANKS}`, `303 ${RETRY}`]);
    eq('  ... and is not stored', store.export().map((row) => row.email), ['person1@example.com', 'person2@example.com']);
    const other = await post(app, { email: 'neighbour@example.com', platform: 'ios' }, { 'x-forwarded-for': OTHER_CLIENT });
    eq('  ... while a different client address is still accepted', [redirectsTo(other), store.export().length], [`303 ${THANKS}`, 3]);
  }

  {
    const { app, store } = harness({ betaLimitPerDay: 2 });
    const answers: string[] = [];
    for (const n of [1, 2, 3]) answers.push(redirectsTo(await post(app, { email: `day${n}@example.com`, platform: 'ios' }, { 'x-forwarded-for': `192.0.2.${n}` })));
    eq('over the global daily cap, a signup from a fresh address goes to retry', answers, [`303 ${THANKS}`, `303 ${THANKS}`, `303 ${RETRY}`]);
    eq('  ... and is not stored', store.export().length, 2);
  }

  {
    const { app, store } = harness();
    const res = await post(app, { ...VALID, [TRAP_FIELD]: 'Acme Corp' });
    eq('a filled trap field redirects to thanks and stores nothing', [redirectsTo(res), store.export().length], [`303 ${THANKS}`, 0]);
    const trappedInvalid = await post(app, { email: 'not-an-email', platform: 'nope', [TRAP_FIELD]: 'x' });
    eq('  ... even when the rest of the form is invalid, so a bot learns nothing', redirectsTo(trappedInvalid), `303 ${THANKS}`);
    const empty = await post(app, { ...VALID, [TRAP_FIELD]: '' });
    eq('an empty trap field is a person: stored', [redirectsTo(empty), store.export().length], [`303 ${THANKS}`, 1]);
  }

  {
    const { app, store } = harness();
    const res = await post(app, { ...VALID, [TRAP_FIELD]: '', company: 'Acme Corp', organization: 'Acme Corp' });
    eq('a person whose browser autofilled an organization field is stored, not trapped', [redirectsTo(res), store.export().length], [`303 ${THANKS}`, 1]);
  }
}

function signupLines(capture: LogCapture): Record<string, unknown>[] {
  return withMessage(capture, 'beta signup');
}

async function loggingTests(): Promise<void> {
  section('Beta signup: emails, platforms and client addresses never reach the log');

  const secretEmail = 'Secret.Person+tag@Example.org';
  const clientAddress = '203.0.113.77';
  const { app } = harness({ betaLimitPerClientHour: 2 });
  const capture = captureLogs();
  try {
    const headers = { 'x-forwarded-for': clientAddress };
    await post(app, { email: secretEmail, platform: 'android' }, headers);
    await post(app, { email: secretEmail, platform: 'android', updates_opt_out: '1' }, headers);
    await post(app, { email: secretEmail, platform: 'android' }, headers);
    await post(app, { email: `${secretEmail}.`, platform: 'android' }, headers);
    await post(app, { email: secretEmail, platform: 'android', [TRAP_FIELD]: 'bot' }, headers);
    await post(app, { email: secretEmail, platform: 'android', padding: 'x'.repeat(5000) }, headers);
  } finally {
    capture.stop();
  }
  const lines = signupLines(capture);
  eq('one signup line per request, carrying its outcome code', lines.map((line) => line.outcome), ['stored', 'updated', 'limited', 'invalid', 'trap', 'limited']);
  check('every signup line carries a request id', lines.every((line) => typeof line.requestId === 'string' && line.requestId !== ''), JSON.stringify(lines));
  const fields = new Set(lines.flatMap((line) => Object.keys(line)));
  eq('a signup line carries nothing beyond the outcome, the request id and the logger\'s own fields', [...fields].sort((a, b) => a.localeCompare(b)), [
    'hostname',
    'level',
    'msg',
    'outcome',
    'pid',
    'requestId',
    'scope',
    'severity',
    'time',
  ]);
  const everything = capture.raw.join('\n').toLowerCase();
  for (const [what, value] of [
    ['the email', secretEmail.toLowerCase()],
    ['the email\'s local part', 'secret.person'],
    ['the client address', clientAddress],
    ['the platform', 'android'],
  ] as const) {
    check(`no captured line, request lines included, contains ${what}`, !everything.includes(value));
  }
  check('the capture saw the per-request lines too (the check above is not vacuous)', capture.raw.some((line) => line.includes('/beta/signup')));

  section('Beta signup: the logger redacts a field named email');

  const out: string[] = [];
  const logger = createServerLogger({
    destination: {
      write: (line: string) => {
        out.push(line);
      },
    },
  });
  logger.info({ email: secretEmail, fields: { Email: secretEmail }, outcome: 'stored' }, 'backstop');
  const parsed = JSON.parse(out[0] ?? '{}') as { email?: unknown; fields?: { Email?: unknown }; outcome?: unknown };
  eq('a top-level and a nested, capitalized email are both the marker', [parsed.email, parsed.fields?.Email, parsed.outcome], [REDACTED, REDACTED, 'stored']);
  check('  ... and the address appears nowhere in the line', !out.join('').includes(secretEmail));
}

export async function runBetaSignupTests(): Promise<void> {
  await signupRouteTests();
  await abuseLimitTests();
  await loggingTests();
}
