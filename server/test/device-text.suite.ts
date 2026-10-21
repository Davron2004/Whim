/**
 * The server's text the device shows word for word speaks the shell's glossary (app-launcher
 * "Shell copy has one name per concept"; system.md §8): no retired word, run through the SAME
 * lint the device's copy table runs (`checks/test/repo/copy-glossary.ts`).
 *
 * What the device shows verbatim, from its render paths: a `failure` event's `reason` (the Failure
 * page's sentence for an `other` failure, and a "What happened" row) and its diagnostics' `hint`s
 * (rows under "What happened"); every `/v1` `ApiError.hint` that reaches the failure screen or a
 * refusal notice; `compat.notice` on a message the app can't use; the clarify `limit`, questions
 * and options; and the rewrite's plan rows. Each is read here from the module that writes it, or
 * from the stub server's own answers, never copied into this file.
 */
import {
  APP_VERSION_HEADER,
  BUILD_HEADER,
  CONSENT_HEADER,
  PLATFORM_HEADER,
  type ApiError,
  type ClarifyResponse,
  type RewriteResponse,
} from '@whim/contract';
import { check, section } from './harness';
import { readSseResponse } from './sse-reader';
import { PROTOCOL_HEADERS, TIMED_OUT, within } from './route-doubles';
import { lineFindings } from '../../checks/test/repo/copy-glossary';
import { runStaticChecks } from '../../checks/index';
import { createApp, INTERNAL_ERROR } from '../src/app';
import { loadServerConfig } from '../src/config';
import { createStubPipeline } from '../src/pipeline';
import { InMemoryUsageStore } from '../src/usage-store';
import { stubFutureFrame } from '../src/stub-markers';
import { parseRequestEnvelope } from '../src/request-edge';
import { REFUSAL_HINTS } from '../src/admission/refusals';
import * as machine from '../src/generation/machine';
import { createBuildStage } from '../src/generation/stages/build';
import * as clarifyRoute from '../src/routes/clarify';
import * as rewriteRoute from '../src/routes/rewrite';

const DEVICE_ID = '34343434-3434-4343-8343-343434343434';
const ENVELOPE: Readonly<Record<string, string>> = {
  [PLATFORM_HEADER]: 'android',
  [APP_VERSION_HEADER]: '1.0.0',
  [BUILD_HEADER]: '381500',
  [CONSENT_HEADER]: '1',
};
const HEADERS: Readonly<Record<string, string>> = { 'x-whim-device': DEVICE_ID, ...ENVELOPE, ...PROTOCOL_HEADERS, 'content-type': 'application/json' };

type Line = readonly [where: string, text: string];

function stubApp(): ReturnType<typeof createApp> {
  return createApp({ pipeline: createStubPipeline(0), usageStore: new InMemoryUsageStore(), stub: true, config: loadServerConfig({}) });
}

async function post(app: ReturnType<typeof createApp>, route: string, body: unknown, headers: Readonly<Record<string, string>> = HEADERS): Promise<Response | typeof TIMED_OUT> {
  return within(Promise.resolve(app.request(route, { method: 'POST', headers, body: JSON.stringify(body) })));
}

async function json<T>(label: string, res: Response | typeof TIMED_OUT): Promise<T | undefined> {
  check(`${label}: the stub server answered`, res !== TIMED_OUT);
  return res === TIMED_OUT ? undefined : ((await res.json()) as T);
}

/** What the stub's clarify and rewrite answer: the canned questions and options, the `[[limit]]`
 *  limit, and the canned plan rows. */
async function stubUnaryLines(): Promise<Line[]> {
  const app = stubApp();
  const lines: Line[] = [];
  const asked = await json<ClarifyResponse>('clarify', await post(app, '/v1/clarify', { prompt: 'a chore list' }));
  for (const q of asked?.questions ?? []) {
    lines.push([`stub clarify question ${q.id}`, q.question]);
    for (const option of q.options) lines.push([`stub clarify option ${q.id}`, option]);
  }
  check('setup: the stub clarify asks questions', (asked?.questions.length ?? 0) > 0);
  const limited = await json<ClarifyResponse>('clarify [[limit]]', await post(app, '/v1/clarify', { prompt: 'weather [[limit]]' }));
  check('setup: the stub clarify answers [[limit]] with a limit', limited?.limit !== undefined);
  if (limited?.limit) lines.push(['stub limit reason', limited.limit.reason], ['stub limit alternative', limited.limit.alternative]);
  const planned = await json<RewriteResponse>('rewrite', await post(app, '/v1/rewrite', { prompt: 'a chore list' }));
  check('setup: the stub rewrite answers plan rows', (planned?.plan?.length ?? 0) > 0);
  for (const row of planned?.plan ?? []) lines.push([`stub plan row ${row.label}`, `${row.label}: ${row.text}`]);
  return lines;
}

/** The stub generate stream's terminal for `prompt`: its failure reason and hints. */
async function stubStreamLines(prompt: string): Promise<Line[]> {
  const res = await post(stubApp(), '/v1/generate', { prompt });
  check(`setup: the stub stream for ${prompt} answered`, res !== TIMED_OUT && res.ok);
  if (res === TIMED_OUT || !res.ok) return [];
  const read = await within(readSseResponse(res));
  check(`setup: the stub stream for ${prompt} ended`, read !== TIMED_OUT);
  if (read === TIMED_OUT) return [];
  const lines: Line[] = [];
  for (const { data } of read.events) {
    if (data.type === 'failure') {
      lines.push([`stub ${prompt} failure reason`, data.reason]);
      for (const d of data.diagnostics) lines.push([`stub ${prompt} hint`, d.hint]);
    }
  }
  check(`setup: the stub stream for ${prompt} carries text the device shows`, lines.length > 0);
  return lines;
}

/** The device gate's hints, from a request with no device header and one with a malformed one. */
async function deviceGateLines(): Promise<Line[]> {
  const app = stubApp();
  const lines: Line[] = [];
  for (const [label, device] of [['missing', undefined], ['malformed', 'not-a-uuid']] as const) {
    const headers = { ...HEADERS, 'x-whim-device': device ?? '' };
    if (device === undefined) delete (headers as Record<string, string>)['x-whim-device'];
    const body = await json<ApiError>(`device gate (${label})`, await post(app, '/v1/clarify', { prompt: 'a timer' }, headers));
    if (body) lines.push([`device gate ${label} hint`, body.hint]);
  }
  return lines;
}

/** The repair feedback the check and build stages put on a run's diagnostics, which a failure
 *  carries to "What happened": every hint the checker writes for a source that reaches each
 *  forbidden-global answer, and the build stage's hint for a source that doesn't compile. */
async function diagnosticHintLines(): Promise<Line[]> {
  const source = [
    "import { defineApp, Screen, Text } from 'vc-sdk';",
    "eval('1');",
    'document.title;',
    "fetch('/x');",
    'localStorage.clear();',
    "new Worker('w.js');",
    'const o: any = {};',
    'o.__proto__ = null;',
    'export default defineApp({ screens: { main: () => <Screen><Text>hi</Text></Screen> } });',
  ].join('\n');
  const checked = runStaticChecks(source, { filename: 'app.tsx' });
  check('setup: the checker answers the forbidden globals', checked.diagnostics.some((d) => d.kind === 'forbidden_global'));
  const lines: Line[] = checked.diagnostics.map((d): Line => [`checker ${d.kind} hint`, d.hint]);
  const built = await createBuildStage().build('export const broken = (;');
  check('setup: the build stage refuses a source that does not compile', !built.ok);
  // The location esbuild names is a temporary file path, not words the stage wrote.
  if (!built.ok) lines.push(['build stage hint', built.diagnostic.hint.replace(/\([^()]*:\d+:\d+\)/, '(<where>)')]);
  return lines;
}

/** The notices the stub's `[[future:fail]]` and `[[future:update]]` frames carry, as its generate
 *  route sends them to this app. */
function stubNoticeLines(): Line[] {
  const notices = (['fail', 'update'] as const).map((fallback): Line => [`stub [[future:${fallback}]] notice`, stubFutureFrame(fallback).compat?.notice ?? '']);
  check('setup: both ending future frames carry a notice', notices.every(([, notice]) => notice.length > 0));
  return notices;
}

/** The envelope gate's hints, for envelope headers half sent and for a malformed one. The header
 *  names they quote are wire identifiers (`x-whim-build` is the installed build number), not words
 *  the glossary governs, so each is read as a placeholder. */
function envelopeLines(): Line[] {
  const halfSent = parseRequestEnvelope(new Headers({ [PLATFORM_HEADER]: 'android' }));
  const malformed = parseRequestEnvelope(new Headers({ ...ENVELOPE, [BUILD_HEADER]: 'many' }));
  const hints = [halfSent, malformed].flatMap((parsed) => (parsed.ok ? [] : [parsed.body.hint]));
  check('setup: the envelope gate refuses both envelopes', hints.length === 2);
  return hints.map((hint): Line => ['envelope hint', hint.replaceAll(/\bx-whim-[a-z-]+/g, '<header>')]);
}

/** Every failure reason the generation machine can end a run with (its exported `*_REASON`s). */
function machineReasonLines(): Line[] {
  const reasons = Object.entries(machine as Readonly<Record<string, unknown>>).filter(
    (entry): entry is [string, string] => entry[0].endsWith('_REASON') && typeof entry[1] === 'string',
  );
  check('setup: the machine exports its failure reasons', reasons.length > 0);
  return reasons;
}

/** The ApiError hints routes return as constants. */
function routeErrorLines(): Line[] {
  const bodies = [...Object.values(clarifyRoute), ...Object.values(rewriteRoute), INTERNAL_ERROR].filter(
    (value): value is ApiError => typeof value === 'object' && value !== null && typeof (value as ApiError).hint === 'string' && typeof (value as ApiError).error === 'string',
  );
  check('setup: the routes export their error bodies', bodies.length >= 5);
  return bodies.map((body): Line => [`${body.error} hint`, body.hint]);
}

export async function runDeviceTextTests(): Promise<void> {
  section('Server text the device shows word for word speaks the glossary');
  const lines: Line[] = [
    ...machineReasonLines(),
    ...Object.entries(REFUSAL_HINTS).map(([code, hint]): Line => [`refusal ${code}`, hint]),
    ...routeErrorLines(),
    ...(await deviceGateLines()),
    ...(await diagnosticHintLines()),
    ...(await stubUnaryLines()),
    ...(await stubStreamLines('[[fail]]')),
    ...stubNoticeLines(),
    ...envelopeLines(),
  ];
  const findings = lines.flatMap(([where, text]) => lineFindings(where, text, 'prose'));
  check(`no line the device shows from the server says a retired word (${lines.length} lines)`, findings.length === 0, findings.join('\n'));
}
