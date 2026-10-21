/**
 * The server's text the device shows word for word speaks the shell's glossary (app-launcher
 * "Shell copy has one name per concept"; system.md §8): no retired word and no straight
 * apostrophe or quote outside a code span, run through the SAME lint the device's copy table runs
 * (`checks/test/repo/copy-glossary.ts`).
 *
 * What the device shows verbatim, from its render paths: a `failure` event's `reason` (the Failure
 * page's sentence for an `other` failure, and a "What happened" row) and its diagnostics' `hint`s
 * (rows under "What happened"); every `/v1` `ApiError.hint` that reaches the failure screen or a
 * refusal notice (an `invalid_request` hint is the first zod issue's `message`); `compat.notice` on
 * a message the app can't use; the clarify `limit` (`reason`, `alternative`), questions and
 * options; and the rewrite's plan rows. Each is read here from the source that writes it, or from
 * the stub server's own answers, never copied into this file. The source is read as syntax, with no
 * type checker: a sentence is found where it is written into one of the fields, held by a name or
 * parameter named for one (`DEVICE_TEXT_NAME`), returned by a producer so named or called to fill
 * one, or reached from a field's value through a same-file name (`hint: message` reads the
 * arguments the same file's calls pass as `message`, by the function's plain name or, for a class's
 * method or function property, on a `this` bound to that class; a `for (const word of list)`
 * variable reads `list`), up to `NAME_HOPS` names deep. Text
 * reaching a field only through an import under another name, an object's property (`x.reason`), a
 * call on another receiver (`other.fail(…)`), a destructured name (`const { hint } = x`), a
 * `for … in` key or a callback is not followed: only the stub, checker and gate runs below see such
 * text, for the inputs they make.
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
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
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
  // What follows the stage's colon is esbuild's message and the temporary file it names, not words
  // the stage wrote.
  if (!built.ok) lines.push(['build stage hint', built.diagnostic.hint.replace(/: .*$/, ': <compiler message>.')]);
  return lines;
}

/** The notices the stub's `[[future:fail]]` and `[[future:update]]` frames carry, as its generate
 *  route sends them to this app. */
function stubNoticeLines(): Line[] {
  const notices = (['fail', 'update'] as const).map((fallback): Line => [`stub [[future:${fallback}]] notice`, stubFutureFrame(fallback).compat?.notice ?? '']);
  check('setup: both ending future frames carry a notice', notices.every(([, notice]) => notice.length > 0));
  return notices;
}

/** Wire names a hint quotes, header names (`x-whim-build` is the installed build number): wire
 *  identifiers, not words the glossary governs, so each is read as a placeholder. */
const WIRE_NAME = /\bx-whim-[a-z-]+/g;
/** Code a hint quotes in backticks (`import ... from 'vc-sdk'`, a field's name): code keeps its own
 *  quotes and names, so each span is read as a placeholder too. */
const CODE_SPAN = /`[^`]*`/g;

/** The envelope gate's hints, for envelope headers half sent and for a malformed one. */
function envelopeLines(): Line[] {
  const halfSent = parseRequestEnvelope(new Headers({ [PLATFORM_HEADER]: 'android' }));
  const malformed = parseRequestEnvelope(new Headers({ ...ENVELOPE, [BUILD_HEADER]: 'many' }));
  const hints = [halfSent, malformed].flatMap((parsed) => (parsed.ok ? [] : [parsed.body.hint]));
  check('setup: the envelope gate refuses both envelopes', hints.length === 2);
  return hints.map((hint): Line => ['envelope hint', hint]);
}

const REPO_ROOT = path.resolve(process.cwd());

/** The fields of a server message the device renders as written. */
const DEVICE_FIELDS = new Set(['reason', 'hint', 'notice', 'alternative']);
/** A name holding such text: the field itself, or a constant, variable or producer named for it
 *  (`CREDIT_EXHAUSTED_REASON`, `REFUSAL_HINTS`, `failureReason`, `hintFor`). */
const DEVICE_TEXT_NAME = /(?:reason|hint|notice|alternative)s?(?:For)?$/i;

/** Where the text comes from: the server, the contract's schemas (a zod refinement's `message` is
 *  an `invalid_request` hint) and the checker, whose diagnostics' hints a failure carries. */
const SCANNED: readonly { dir: string; fields: ReadonlySet<string> }[] = [
  { dir: 'server/src', fields: DEVICE_FIELDS },
  { dir: 'contract/src', fields: new Set([...DEVICE_FIELDS, 'message']) },
  { dir: 'checks', fields: DEVICE_FIELDS },
];
/** Operator tools and tests: what they write reaches a terminal or a report, never the device. */
const NOT_SERVED = ['server/src/admin', 'server/src/flowbench', 'server/src/loadtest', 'server/src/site', 'checks/test'];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (NOT_SERVED.includes(rel)) return [];
    if (entry.isDirectory()) return sourceFiles(rel);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [rel] : [];
  });
}

function nameOf(node: ts.Node | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return undefined;
}

type FunctionLike = ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression;

/** How many names deep a device-shown field's value is followed (`hint: message` → `message`'s
 *  argument → a constant it reads). */
const NAME_HOPS = 2;

/** `file:line` of `node`. */
function locationOf(node: ts.Node): string {
  const source = node.getSourceFile();
  return `${source.fileName}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
}

/** True when `id` is itself the value read: not a property's or member's name, not the object a
 *  property is read from (`unit.reason` reads a field of `unit`, not what `unit` was made from),
 *  not a callee, not a type. */
function isValueReference(id: ts.Identifier): boolean {
  const parent = id.parent;
  if (ts.isPropertyAccessExpression(parent)) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent)) && parent.name === id) return false;
  if (ts.isCallExpression(parent) && parent.expression === id) return false;
  return !ts.isTypeReferenceNode(parent) && !ts.isQualifiedName(parent);
}

/** The parameter of `scope`, the variable declared directly in it or the `for (const … of …)`
 *  variable it binds that is called `name`. */
function declaredIn(scope: ts.Node, name: string): ts.ParameterDeclaration | ts.VariableDeclaration | undefined {
  if (ts.isFunctionLike(scope)) return scope.parameters.find((p) => ts.isIdentifier(p.name) && p.name.text === name);
  if (ts.isForOfStatement(scope) && ts.isVariableDeclarationList(scope.initializer)) {
    return scope.initializer.declarations.find((d) => ts.isIdentifier(d.name) && d.name.text === name);
  }
  if (!ts.isBlock(scope) && !ts.isSourceFile(scope) && !ts.isModuleBlock(scope)) return undefined;
  for (const statement of scope.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const found = statement.declarationList.declarations.find((d) => ts.isIdentifier(d.name) && d.name.text === name);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** What `id` names in its own file, by lexical scope: a parameter of an enclosing function, or a
 *  variable declared in an enclosing block or at the top of the file. */
function declarationOf(id: ts.Identifier): ts.ParameterDeclaration | ts.VariableDeclaration | undefined {
  for (let scope: ts.Node | undefined = id.parent; scope !== undefined; scope = scope.parent) {
    const found = declaredIn(scope, id.text);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The name a function is called by: its own, or the variable or class property it is assigned to. */
function calledName(fn: ts.SignatureDeclaration): string | undefined {
  if (ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) return nameOf(fn.name);
  if ((ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && (ts.isVariableDeclaration(fn.parent) || ts.isPropertyDeclaration(fn.parent))) return nameOf(fn.parent.name);
  return undefined;
}

/** The class whose member `fn` is: a method of a class, or a function held by a class property
 *  (`fail = (m) => …`). */
function memberClassOf(fn: ts.SignatureDeclaration): ts.ClassLikeDeclaration | undefined {
  if (ts.isMethodDeclaration(fn) && ts.isClassLike(fn.parent)) return fn.parent;
  if ((ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && ts.isPropertyDeclaration(fn.parent) && ts.isClassLike(fn.parent.parent)) return fn.parent.parent;
  return undefined;
}

/** The class `this` names at `node`: the nearest enclosing class, through arrow functions (which
 *  keep their `this`), or none when a `function`, or a method or accessor of an object literal,
 *  binds `this` first. */
function thisClassAt(node: ts.Node): ts.ClassLikeDeclaration | undefined {
  for (let at = node.parent; at !== undefined; at = at.parent) {
    if (ts.isFunctionDeclaration(at) || ts.isFunctionExpression(at)) return undefined;
    if ((ts.isMethodDeclaration(at) || ts.isAccessor(at)) && ts.isObjectLiteralExpression(at.parent)) return undefined;
    if (ts.isClassLike(at)) return at;
  }
  return undefined;
}

/** The name `call` calls a same-file function by: a plain name (`hintFor(…)`), or a method's name
 *  on `this` (`this.fail(…)`). A call on any other receiver (`other.fail(…)`) may reach another
 *  object's function of that name, so it has none. */
function callName(call: ts.CallExpression): string | undefined {
  if (ts.isIdentifier(call.expression)) return call.expression.text;
  if (ts.isPropertyAccessExpression(call.expression) && call.expression.expression.kind === ts.SyntaxKind.ThisKeyword) return call.expression.name.text;
  return undefined;
}

/** True when `call`, found under `fn`'s name, calls `fn`: from `fn`'s own file, by its plain name,
 *  or for a class's method or function property, on a `this` that is that class's. An object
 *  literal's method is called on its object, which this scan does not follow. */
function callsFunction(call: ts.CallExpression, fn: ts.SignatureDeclaration): boolean {
  if (call.getSourceFile() !== fn.getSourceFile()) return false;
  const owner = memberClassOf(fn);
  if (owner === undefined) return !ts.isMethodDeclaration(fn) && ts.isIdentifier(call.expression);
  return !ts.isIdentifier(call.expression) && thisClassAt(call) === owner;
}

/** Every string a device-shown field can be written from, found in the source as syntax: the
 *  literal (or a template's text, its holes read as `<x>`) written into one of the fields, held by a
 *  name that says it is such text, passed as a parameter so named, or returned by a function so
 *  named or called to fill one. A name read on the way is followed to what it names in its file: a
 *  variable to its initialiser, a `for … of` variable to what it loops over, a parameter to the
 *  argument each call of its function in that file passes it (`hint: message` reads each `message`
 *  its callers there write). */
function scannedLines(files: readonly { fields: ReadonlySet<string>; source: ts.SourceFile }[]): Line[] {
  const functions = new Map<string, FunctionLike[]>();
  const declare = (name: string | undefined, fn: FunctionLike): void => {
    if (name !== undefined) functions.set(name, [...(functions.get(name) ?? []), fn]);
  };
  const calls = new Map<string, ts.CallExpression[]>();
  for (const { source } of files) {
    const visit = (node: ts.Node): void => {
      if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.body) declare(nameOf(node.name), node);
      if ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
        declare(nameOf(node.name), node.initializer);
      }
      const callee = ts.isCallExpression(node) ? callName(node) : undefined;
      if (callee !== undefined) calls.set(callee, [...(calls.get(callee) ?? []), node as ts.CallExpression]);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  const lines: Line[] = [];
  /** The literals in `expr`; a function it calls by name has its own literals read too, one call
   *  deep (a producer such as `hintFor`), so an unrelated body further down never counts. A name
   *  it reads is followed to what it names in the same file, at most `NAME_HOPS` names deep, each
   *  declaration once per field: further, every hint would read the whole server. */
  const collect = (where: string, expr: ts.Node, follow = true, hops = 0, resolved = new Set<ts.Node>()): void => {
    const resolve = (id: ts.Identifier): void => {
      const declaration = declarationOf(id);
      if (hops >= NAME_HOPS || declaration === undefined || resolved.has(declaration)) return;
      resolved.add(declaration);
      const via = `${where} via ${locationOf(declaration)}`;
      if (declaration.initializer && !ts.isArrowFunction(declaration.initializer) && !ts.isFunctionExpression(declaration.initializer)) {
        collect(via, declaration.initializer, follow, hops + 1, resolved);
      }
      const loop = declaration.parent.parent;
      if (ts.isForOfStatement(loop)) collect(via, loop.expression, follow, hops + 1, resolved);
      if (!ts.isParameter(declaration)) return;
      const fn = declaration.parent;
      const index = fn.parameters.indexOf(declaration);
      const name = calledName(fn);
      for (const call of name === undefined ? [] : (calls.get(name) ?? [])) {
        const arg = call.arguments.at(index);
        if (arg !== undefined && callsFunction(call, fn)) collect(`${via} from ${locationOf(arg)}`, arg, follow, hops + 1, resolved);
      }
    };
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        lines.push([where, node.text]);
        return;
      }
      if (ts.isTemplateExpression(node)) lines.push([where, node.head.text + node.templateSpans.map((span) => `<x>${span.literal.text}`).join('')]);
      if (follow && ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        for (const fn of functions.get(node.expression.text) ?? []) if (fn.body) collect(where, fn.body, false, hops, resolved);
      }
      if (ts.isIdentifier(node) && isValueReference(node)) resolve(node);
      ts.forEachChild(node, visit);
    };
    visit(expr);
  };

  for (const { fields, source } of files) {
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node) && fields.has(nameOf(node.name) ?? '')) collect(locationOf(node), node.initializer);
      if (ts.isShorthandPropertyAssignment(node) && fields.has(node.name.text)) collect(locationOf(node), node.name);
      if (ts.isVariableDeclaration(node) && node.initializer && DEVICE_TEXT_NAME.test(nameOf(node.name) ?? '')) collect(locationOf(node), node.initializer);
      if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.body && DEVICE_TEXT_NAME.test(nameOf(node.name) ?? '')) collect(locationOf(node), node.body);
      if (ts.isCallExpression(node)) {
        for (const fn of functions.get(nameOf(node.expression) ?? '') ?? []) {
          fn.parameters.forEach((param, i) => {
            const arg = node.arguments.at(i);
            if (arg !== undefined && fields.has(nameOf(param.name) ?? '')) collect(locationOf(arg), arg);
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return lines;
}

function parseSource(rel: string, text: string): ts.SourceFile {
  return ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
}

/** The scan over the repo's sources the device's text is written in. */
function scannedSourceLines(): Line[] {
  return scannedLines(SCANNED.flatMap(({ dir, fields }) => sourceFiles(dir).map((rel) => ({ fields, source: parseSource(rel, fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')) }))));
}

/** A name is followed to the calls of its own function only, and through a `for … of` loop. */
function checkScanFollowsNames(): void {
  const source = parseSource('fixture.ts', [
    'function fail(message: string) { return { hint: message }; }',
    "fail('called by its name');",
    "other.fail('called on another object');",
    'class Run {',
    '  stop(message: string) { return { reason: message }; }',
    "  go() { this.stop('called on this'); }",
    "  later() { setTimeout(function () { this.stop('called on the this of a nested function'); }); }",
    "  literal() { return { go() { this.stop('called on the this of an object literal method'); } }; }",
    "  inner() { return class { go() { this.stop('called on the this of a nested class'); } }; }",
    '}',
    "runner.stop('called on another runner');",
    'class Job {',
    '  halt = (message: string) => ({ notice: message });',
    "  run() { this.halt('called on this, a function property'); }",
    "  each() { ['x'].forEach(() => this.halt('called on this through an arrow')); }",
    '}',
    "job.halt('called on another job');",
    "for (const word of ['looped over']) send({ notice: word });",
  ].join('\n'));
  const seen = scannedLines([{ fields: DEVICE_FIELDS, source }]).map(([, text]) => text);
  const followed = ['called by its name', 'called on this', 'called on this, a function property', 'called on this through an arrow', 'looped over'];
  for (const text of followed) check(`the scan follows a name to ${text}`, seen.includes(text), seen.join('\n'));
  const notFollowed = [
    'called on another object',
    'called on another runner',
    'called on another job',
    'called on the this of a nested function',
    'called on the this of an object literal method',
    'called on the this of a nested class',
  ];
  for (const text of notFollowed) check(`the scan does not take ${text} for a call of the same-file function`, !seen.includes(text), seen.join('\n'));
}

/** The scan sees at least what the modules hand out as such text: every failure reason the
 *  machine exports, every refusal hint, and every error body the routes export. */
function checkScanCoverage(scanned: readonly Line[]): void {
  const seen = new Set(scanned.map(([, text]) => text));
  const machineReasons = Object.entries(machine as Readonly<Record<string, unknown>>).flatMap(([name, value]) => (name.endsWith('_REASON') && typeof value === 'string' ? [value] : []));
  const routeHints = [...Object.values(clarifyRoute), ...Object.values(rewriteRoute), INTERNAL_ERROR].flatMap((value) =>
    typeof value === 'object' && value !== null && typeof (value as ApiError).hint === 'string' && typeof (value as ApiError).error === 'string' ? [(value as ApiError).hint] : [],
  );
  for (const [label, texts] of [['the machine\'s exported failure reasons', machineReasons], ['the refusal hints', Object.values(REFUSAL_HINTS)], ['the routes\' exported error hints', routeHints]] as const) {
    const missed = texts.filter((text) => !seen.has(text));
    check(`the source scan finds every one of ${label} (${texts.length})`, texts.length > 0 && missed.length === 0, missed.join('\n'));
  }
}

export async function runDeviceTextTests(): Promise<void> {
  section('Server text the device shows word for word speaks the glossary');
  checkScanFollowsNames();
  const scanned = scannedSourceLines();
  checkScanCoverage(scanned);
  const lines: Line[] = [
    ...scanned,
    ...(await deviceGateLines()),
    ...(await diagnosticHintLines()),
    ...(await stubUnaryLines()),
    ...(await stubStreamLines('[[fail]]')),
    ...stubNoticeLines(),
    ...envelopeLines(),
  ];
  const findings = lines.flatMap(([where, text]) => lineFindings(where, text.replaceAll(WIRE_NAME, '<header>').replaceAll(CODE_SPAN, '<code>'), 'prose'));
  check(`no line the device shows from the server says a retired word or sets a straight apostrophe or quote outside code (${lines.length} lines)`, findings.length === 0, findings.join('\n'));
}
