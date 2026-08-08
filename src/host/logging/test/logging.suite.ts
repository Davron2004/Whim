/**
 * logging.suite — acceptance for the device logging seam (obs-v1 chain B).
 *
 * Covers the spec scenarios from `host-observability`:
 *   - "Levels order and filter" (default and per-channel thresholds)
 *   - the channel registry is the ONE place a channel name is written
 *   - "A sensitive field is redacted at the seam" / "Redaction is not sink-dependent"
 *   - "Capacity is enforced by eviction" / "A snapshot is stable"
 *   - "Records are batched, not sent one by one" / "Off by default" /
 *     "An unreachable sink is invisible to the user" / "The failure record does not recurse"
 *
 * Runs under Node via `npm run launcher:test` (registered in `../../launcher/test/acceptance.ts`).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Harness } from '../../launcher/test/harness';
import { CHANNELS, ALL_CHANNELS } from '../channels';
import { REDACTED, SENSITIVE_FIELD_NAMES, isSensitiveField } from '../redact';
import { LogRing } from '../ring-buffer';
import { createSeam, LEVELS, LEVEL_ORDER } from '../index';
import type { PostBatch } from '../sink';

interface Sent {
  url: string;
  body: string;
}

/** The address the device would have persisted for `/v1/generate`; the sink reuses it. */
const BASE_URL = 'http://127.0.0.1:8787';

/** A sink transport that records what it was handed; `fail` makes every delivery reject. */
function recordingPost(sent: Sent[], fail = false): PostBatch {
  return async (url, body) => {
    sent.push({ url, body });
    if (fail) {
      throw new Error('connect ECONNREFUSED');
    }
    return { ok: true, status: 204 };
  };
}

/** Let queued microtasks and a zero-delay timer settle (fire-and-forget flushes). */
async function settle(): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
}

/** The interim disable token, assembled rather than written: the scan below reads this very file,
 *  and a literal here would make the assertion report itself. */
const INTERIM_TOKEN = ['obs', 'v1', 'interim'].join('-');

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js'];

/**
 * The FLAG-GATED on-device acceptance probe surfaces. Their `console.*` calls are not diagnostics:
 * they are how a probe reports its verdict on a device (CLAUDE.md, "Android build & run" — the
 * verdict is read from logcat `ReactNativeJS`), each one is off by default behind a `RUN_*_PROBE`
 * flag, and none is on the product's path. Written out one by one, never as a glob, so the
 * carve-out cannot silently widen.
 */
const PROBE_SURFACES: readonly string[] = [
  path.join('src', 'host', 'BridgeProbeScreen.tsx'),
  path.join('src', 'host', 'StorageProbeScreen.tsx'),
  path.join('src', 'host', 'VersionStoreProbeScreen.tsx'),
  path.join('src', 'host', 'bridge', 'device-acceptance.ts'),
  path.join('src', 'host', 'storage-engine', 'device-acceptance.ts'),
  path.join('src', 'host', 'version-store', 'device-acceptance.ts'),
];

/** Every source file under the given repo-relative roots, recursively. */
function sourceFiles(roots: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) {
        continue;
      }
      const full = path.join(dir, name);
      if (SOURCE_EXTENSIONS.some(ext => name.endsWith(ext))) {
        out.push(full);
        continue;
      }
      // This repo's ambient Node surface (`evals/env.d.ts`) has no `statSync`, so reading the
      // entry as a directory IS the directory test: `ENOTDIR` means it was a file. Any OTHER
      // read failure is real and rethrown — a skipped directory would silently weaken the scans.
      try {
        walk(full);
      } catch (notADirectory) {
        if (!String(notADirectory).includes('ENOTDIR')) {
          throw notADirectory;
        }
      }
    }
  };
  for (const root of roots) {
    const full = path.join(process.cwd(), root);
    if (fs.existsSync(full)) {
      walk(full);
    }
  }
  return out;
}

/** Repo-relative, for readable failure output (no `path.relative` in the ambient surface). */
function rel(file: string): string {
  const root = process.cwd() + '/';
  return file.startsWith(root) ? file.slice(root.length) : file;
}

/** The seam itself — the ONE place allowed to reach the console, plus its own tests. */
function isSeamModule(file: string): boolean {
  return rel(file).startsWith(path.join('src', 'host', 'logging'));
}

/**
 * A Node acceptance suite or its runner. Their `console.*` calls ARE their output — a suite prints
 * its results to a terminal, and there is no device, no logcat and no ring buffer in that process.
 * The requirement is about device diagnostics, so the scan stops at the test boundary.
 */
function isNodeSuite(file: string): boolean {
  return rel(file).split('/').includes('test');
}

function isProbeSurface(file: string): boolean {
  return PROBE_SURFACES.includes(rel(file));
}

export async function runLoggingTests(h: Harness): Promise<void> {
  await h.test('levels are ordered lowest-first and the threshold filters below it', () => {
    h.eq([...LEVELS], ['debug', 'info', 'warn', 'error'], 'level order');
    h.ok(
      LEVEL_ORDER.debug < LEVEL_ORDER.info &&
        LEVEL_ORDER.info < LEVEL_ORDER.warn &&
        LEVEL_ORDER.warn < LEVEL_ORDER.error,
      'ranks increase with severity',
    );

    const seam = createSeam({ console: false, level: 'warn' });
    seam.debug(CHANNELS.gen, 'below');
    seam.info(CHANNELS.gen, 'below');
    seam.warn(CHANNELS.gen, 'at');
    seam.error(CHANNELS.gen, 'above');
    h.eq(
      seam.buffer.snapshot().map(r => r.message),
      ['at', 'above'],
      'records below the threshold are not buffered',
    );
  });

  await h.test('a per-channel threshold overrides the default without touching other channels', () => {
    const seam = createSeam({ console: false, level: 'debug' });
    seam.setChannelLevel(CHANNELS.gen, 'error');
    h.eq(seam.thresholdFor(CHANNELS.gen), 'error', 'gen threshold raised');
    h.eq(seam.thresholdFor(CHANNELS.app), 'debug', 'app keeps the default');

    seam.info(CHANNELS.gen, 'gen-info');
    seam.info(CHANNELS.app, 'app-info');
    seam.error(CHANNELS.gen, 'gen-error');
    h.eq(
      seam.buffer.snapshot().map(r => r.message),
      ['app-info', 'gen-error'],
      'only the raised channel is filtered',
    );

    seam.setChannelLevel(CHANNELS.gen, undefined);
    h.eq(seam.thresholdFor(CHANNELS.gen), 'debug', 'clearing an override restores the default');
  });

  await h.test('a filtered record reaches no sink either', async () => {
    const sent: Sent[] = [];
    const seam = createSeam({
      console: false,
      level: 'error',
      sink: { enabled: true, baseUrl: BASE_URL, post: recordingPost(sent) },
    });
    seam.info(CHANNELS.gen, 'dropped');
    await seam.sink.flush();
    h.eq(sent.length, 0, 'nothing was delivered');
    seam.sink.stop();
  });

  await h.test('the channel registry is the only place a channel name is written', () => {
    h.eq(CHANNELS.gen, 'whim:gen', 'the generation prefix became a channel verbatim');
    h.eq(CHANNELS.app, 'whim', 'the container prefix became a channel verbatim');
    h.eq(CHANNELS.page, 'whim:page', 'the relayed sandbox-page prefix became a channel verbatim');
    h.ok(typeof CHANNELS.screen === 'string' && CHANNELS.screen.length > 0, 'the screen boundary has a channel');
    h.ok(typeof CHANNELS.sink === 'string' && CHANNELS.sink.length > 0, 'the sink has its own channel');
    h.eq(new Set(ALL_CHANNELS).size, ALL_CHANNELS.length, 'channel names are distinct');

    // Every module of the seam itself imports the constant; none re-writes the literal. (The
    // seam's own test folder is excluded — asserting the literals IS this test's job.)
    const dir = path.join(process.cwd(), 'src', 'host', 'logging');
    const modules = fs.readdirSync(dir).filter(f => f.endsWith('.ts'));
    h.ok(modules.includes('channels.ts'), 'the registry module exists');
    const offenders = modules.filter(file => {
      if (file === 'channels.ts') {
        return false;
      }
      const src = fs.readFileSync(path.join(dir, file), 'utf8');
      return ALL_CHANNELS.some(channel => src.includes(`'${channel}'`) || src.includes(`"${channel}"`));
    });
    h.eq(offenders, [], 'no seam module outside channels.ts writes a channel literal');
  });

  await h.test('every sensitive field name is redacted before the record is buffered', () => {
    const seam = createSeam({ console: false });
    for (const name of SENSITIVE_FIELD_NAMES) {
      h.ok(isSensitiveField(name.toUpperCase()), `${name} matches case-insensitively`);
    }
    const secret = 'SECRET-VALUE';
    const fields: Record<string, unknown> = { safe: 'kept' };
    for (const name of SENSITIVE_FIELD_NAMES) {
      fields[name] = secret;
    }
    fields.nested = { apiKey: secret, note: 'kept too' };
    seam.error(CHANNELS.gen, 'boom', fields);

    const [record] = seam.buffer.snapshot();
    h.eq(record.fields.safe, 'kept', 'a non-sensitive field survives');
    const leaked = SENSITIVE_FIELD_NAMES.filter(name => record.fields[name] !== REDACTED);
    h.eq(leaked, [], 'every sensitive field carries the marker');
    h.eq((record.fields.nested as Record<string, unknown>).apiKey, REDACTED, 'nested values are redacted too');
    h.eq((record.fields.nested as Record<string, unknown>).note, 'kept too', 'nested non-sensitive values survive');
    h.ok(!JSON.stringify(record).includes(secret), 'the original value appears nowhere in the record');
  });

  await h.test('the buffer reader and the sink reader observe the same redacted value', async () => {
    const sent: Sent[] = [];
    const seam = createSeam({
      console: false,
      sink: { enabled: true, baseUrl: BASE_URL, post: recordingPost(sent) },
    });
    seam.info(CHANNELS.gen, 'sending', { prompt: 'make me a timer', deviceId: 'device-abc' });
    await seam.sink.flush();

    const [record] = seam.buffer.snapshot();
    h.eq(record.fields.prompt, REDACTED, 'the overlay reader sees the marker');
    h.eq(sent.length, 1, 'one delivery');
    h.ok(!sent[0].body.includes('make me a timer'), 'the prompt text is in no sink');
    h.ok(!sent[0].body.includes('device-abc'), 'the device id is in no sink');
    h.eq((JSON.parse(sent[0].body).records[0].fields as Record<string, unknown>).prompt, REDACTED, 'the sink reader sees the marker');
    seam.sink.stop();
  });

  await h.test('the ring buffer evicts the oldest at capacity', () => {
    const ring = new LogRing(3);
    for (const n of [1, 2, 3, 4, 5]) {
      ring.push({ at: n, level: 'info', channel: CHANNELS.app, message: `m${n}`, fields: {} });
    }
    h.eq(ring.size, 3, 'the buffer holds exactly its capacity');
    h.eq(
      ring.snapshot().map(r => r.message),
      ['m3', 'm4', 'm5'],
      'the oldest are gone and the newest are in emission order',
    );
  });

  await h.test('a snapshot is stable and cannot be observed half-written', () => {
    const seam = createSeam({ console: false, capacity: 4 });
    seam.info(CHANNELS.app, 'first', { a: 1 });
    const snap = seam.buffer.snapshot();
    seam.info(CHANNELS.app, 'second');
    seam.info(CHANNELS.app, 'third');
    h.eq(snap.map(r => r.message), ['first'], 'the held snapshot is unchanged by later records');
    h.eq(seam.buffer.snapshot().length, 3, 'the buffer itself moved on');
    h.ok(Object.isFrozen(snap[0]) && Object.isFrozen(snap[0].fields), 'records and their fields are frozen');
    h.ok(
      snap[0].at > 0 && snap[0].level === 'info' && snap[0].channel === CHANNELS.app,
      'a record carries timestamp, level and channel',
    );
  });

  await h.test('the sink is off unless explicitly enabled', async () => {
    const sent: Sent[] = [];
    const post = recordingPost(sent);

    const offByDefault = createSeam({ console: false, sink: { baseUrl: BASE_URL, post } });
    h.ok(!offByDefault.sink.active, 'a sink with an address but no flag is inactive');
    offByDefault.error(CHANNELS.gen, 'never sent');
    await offByDefault.sink.flush();

    const noAddress = createSeam({ console: false, sink: { enabled: true, post } });
    h.ok(!noAddress.sink.active, 'an enabled sink with no persisted address is inactive');
    noAddress.error(CHANNELS.gen, 'never sent either');
    await noAddress.sink.flush();

    h.eq(sent.length, 0, 'no network request is made by the logging seam');
    h.eq(noAddress.sink.endpoint, undefined, 'no address means no endpoint');
  });

  await h.test('records are batched into one request bounded by count', async () => {
    const sent: Sent[] = [];
    const seam = createSeam({
      console: false,
      sink: {
        enabled: true,
        baseUrl: BASE_URL + '/',
        post: recordingPost(sent),
        maxBatch: 3,
        flushIntervalMs: 60_000,
      },
    });
    h.eq(seam.sink.endpoint, BASE_URL + '/dev/logs', 'the sink posts to the dev-log route on the persisted address');

    seam.info(CHANNELS.gen, 'one');
    seam.info(CHANNELS.gen, 'two');
    h.eq(sent.length, 0, 'below the count bound nothing is sent yet');
    seam.info(CHANNELS.gen, 'three');
    await settle();

    h.eq(sent.length, 1, 'the count bound flushed exactly one request');
    const batch = JSON.parse(sent[0].body);
    h.eq(batch.records.map((r: { message: string }) => r.message), ['one', 'two', 'three'], 'all three rode one body');
    h.ok(typeof batch.sentAt === 'number', 'the batch carries its send time');
    seam.sink.stop();
  });

  await h.test('the flush interval bounds delivery even below the count', async () => {
    const sent: Sent[] = [];
    const seam = createSeam({
      console: false,
      sink: {
        enabled: true,
        baseUrl: BASE_URL,
        post: recordingPost(sent),
        maxBatch: 100,
        flushIntervalMs: 5,
      },
    });
    seam.info(CHANNELS.gen, 'waiting');
    await new Promise<void>(resolve => setTimeout(resolve, 40));
    h.eq(sent.length, 1, 'the interval delivered the pending record');
    seam.sink.stop();
  });

  await h.test('a full pending queue drops the oldest rather than growing', async () => {
    const sent: Sent[] = [];
    const seam = createSeam({
      console: false,
      sink: {
        enabled: true,
        baseUrl: BASE_URL,
        post: recordingPost(sent),
        maxBatch: 100,
        maxPending: 2,
        flushIntervalMs: 60_000,
      },
    });
    seam.info(CHANNELS.gen, 'a');
    seam.info(CHANNELS.gen, 'b');
    seam.info(CHANNELS.gen, 'c');
    h.eq(seam.sink.dropped, 1, 'one pending record was dropped');
    await seam.sink.flush();
    h.eq(JSON.parse(sent[0].body).records.map((r: { message: string }) => r.message), ['b', 'c'], 'the OLDEST pending was the one dropped');
    h.eq(seam.buffer.snapshot().length, 3, 'the ring buffer still holds all three');
    seam.sink.stop();
  });

  await h.test('an unreachable sink buffers a failure, never throws, and does not retry', async () => {
    const sent: Sent[] = [];
    const seam = createSeam({
      console: false,
      sink: {
        enabled: true,
        baseUrl: 'http://127.0.0.1:1',
        post: recordingPost(sent, true),
        maxBatch: 1,
        flushIntervalMs: 60_000,
      },
    });

    // Fire-and-forget: the caller's stack must not see the rejection.
    seam.error(CHANNELS.gen, 'transport failed', { status: 0 });
    await settle();

    h.eq(sent.length, 1, 'exactly one delivery attempt');
    h.eq(seam.sink.attempts, 1, 'the failed batch is not retried');
    const failures = seam.buffer.snapshot().filter(r => r.channel === CHANNELS.sink);
    h.eq(failures.length, 1, 'the failure is recorded in the ring buffer');
    h.eq(failures[0].fields.detail, 'connect ECONNREFUSED', 'the failure record explains the silence');

    // The failure record itself must not become another delivery.
    await seam.sink.flush();
    await settle();
    h.eq(sent.length, 1, 'recording the failure triggered no further attempt');
    h.eq(seam.sink.attempts, 1, 'and no further batch was formed');
    seam.sink.stop();
  });

  await h.test('a non-2xx response is a recorded failure, not a throw', async () => {
    const sent: Sent[] = [];
    const seam = createSeam({
      console: false,
      sink: {
        enabled: true,
        baseUrl: BASE_URL,
        post: async (url, body) => {
          sent.push({ url, body });
          return { ok: false, status: 500 };
        },
        maxBatch: 100,
        flushIntervalMs: 60_000,
      },
    });
    seam.info(CHANNELS.gen, 'rejected');
    await seam.sink.flush();
    h.eq(sent.length, 1, 'the batch was attempted once');
    const failures = seam.buffer.snapshot().filter(r => r.channel === CHANNELS.sink);
    h.eq(failures.length, 1, 'the rejection is recorded');
    h.eq(failures[0].fields.status, 500, 'with the status as a named field');
    seam.sink.stop();
  });

  await h.test('disabling the sink drops what is pending and stops the timer', async () => {
    const sent: Sent[] = [];
    const seam = createSeam({
      console: false,
      sink: {
        enabled: true,
        baseUrl: BASE_URL,
        post: recordingPost(sent),
        maxBatch: 100,
        flushIntervalMs: 5,
      },
    });
    seam.info(CHANNELS.gen, 'pending');
    seam.sink.configure({ enabled: false });
    await new Promise<void>(resolve => setTimeout(resolve, 40));
    h.eq(sent.length, 0, 'a disabled sink sends nothing');
  });

  // ── The migration is complete (chain-E) ──────────────────────────────────────────────────
  // Three source-scanned standing invariants, each locking a state the migration reached and a
  // regression that would otherwise be invisible: the interim lint markers are gone, the seam is
  // the only console caller, and no retired prefix survives as a literal.

  await h.test(`no ${INTERIM_TOKEN} marker survives anywhere in the source tree`, () => {
    // `openspec/` is excluded on purpose and nowhere else is: the change folder is the RECORD of
    // this migration and necessarily spells the token out (tasks.md, chains.md, the handoffs).
    const offenders = sourceFiles(['src', 'server', 'contract', 'synthrun', 'scripts', 'build'])
      .filter(file => fs.readFileSync(file, 'utf8').includes(INTERIM_TOKEN))
      .map(rel);
    h.eq(offenders, [], 'every interim disable was resolved into a seam call, a rethrow or a documented intentional disable');
  });

  await h.test('the seam is the only diagnostic console caller in src/host', () => {
    const offenders = sourceFiles([path.join('src', 'host')])
      .filter(file => !isSeamModule(file) && !isProbeSurface(file) && !isNodeSuite(file))
      .filter(file => /\bconsole\s*\.\s*(log|warn|error|info|debug)\s*\(/.test(fs.readFileSync(file, 'utf8')))
      .map(rel);
    h.eq(offenders, [], 'no module outside the seam logs a diagnostic through console');
  });

  await h.test('the three retired prefixes survive at no call site', () => {
    // `whim:gen` / `whim` / `whim:page` are CHANNELS now (asserted verbatim above). A call site
    // that pastes one back into a message string has reinvented the thing this change removed.
    const prefixes = ['[whim:gen]', '[whim:page]', '[whim]'];
    const offenders = sourceFiles([path.join('src', 'host')])
      .filter(file => !isSeamModule(file) && !isProbeSurface(file))
      .filter(file => {
        const src = fs.readFileSync(file, 'utf8');
        return prefixes.some(prefix => src.includes(prefix));
      })
      .map(rel);
    h.eq(offenders, [], 'no source file writes a retired log prefix');
  });

  await h.test('the dev-log wire types cross the device seam type-only, and carry no runtime value', () => {
    // The device may name these types freely; what must never happen is a VALUE import, which
    // would put the contract package (and therefore zod) into the Metro graph.
    const names = ['DevLogRecord', 'DevLogBatch', 'DevLogLevel', 'DevLogSinkPath'];
    const offenders: string[] = [];
    for (const file of sourceFiles(['src'])) {
      const src = fs.readFileSync(file, 'utf8');
      // Every import statement in the file, `import type` or not, split into clause + specifier.
      for (const [statement, clause, specifier] of src.matchAll(/^import\s([\s\S]*?)from\s+'([^']+)';/gm)) {
        const isDevLogModule = /(^|\/)dev-log$/.test(specifier);
        const isWireTypeFromContract = specifier === '@whim/contract' && names.some(n => clause.includes(n));
        if ((isDevLogModule || isWireTypeFromContract) && !/^import\s+type\s/.test(statement)) {
          offenders.push(`${rel(file)}: ${statement.replace(/\s+/g, ' ')}`);
        }
      }
    }
    h.eq(offenders, [], 'every device-side dev-log import is an `import type`');

    // Non-vacuity: the scan found the imports it is meant to police at all.
    const seen = sourceFiles(['src']).filter(file =>
      /^import\s+type\s[\s\S]*?DevLogRecord[\s\S]*?from\s+'@whim\/contract';/m.test(fs.readFileSync(file, 'utf8')),
    );
    h.ok(seen.length >= 3, 'the wire types are actually imported by the device, so the scan is not vacuous');

    // …and the module on the other side of that import exports nothing executable.
    const contractSrc = fs.readFileSync(path.join(process.cwd(), 'contract', 'src', 'dev-log.ts'), 'utf8');
    const runtimeExports = [...contractSrc.matchAll(/^export\s+(?!type\b|interface\b)(\w+)/gm)].map(m => m[1]);
    h.eq(runtimeExports, [], 'contract/src/dev-log.ts exports only types — a value export would let zod in');
  });

  await h.test('the silent-catch tripwire still has both discard-shaped selectors', () => {
    // READ-ONLY: `.eslintrc.js` is protected config. The lint rules are what make "a swallowed
    // error is a lint failure" true, and a weakened selector would silently un-enforce the whole
    // migration — so the two shapes are asserted here rather than trusted.
    const src = fs.readFileSync(path.join(process.cwd(), '.eslintrc.js'), 'utf8');
    h.ok(
      src.includes('CatchClause[body.body.length=0]'),
      'the silent-catch tripwire was weakened: the empty-catch selector is gone from .eslintrc.js',
    );
    const paramless = src
      .split('\n')
      .filter(line => line.includes('CatchClause[param=null]'))
      .filter(line => line.includes(':not(:has(ThrowStatement))'));
    h.ok(
      paramless.length > 0,
      'the silent-catch tripwire was weakened: no `CatchClause[param=null]` selector excludes rethrows',
    );
  });

  await h.test('the launcher wraps its screen switch in the boundary, below the shell frame', () => {
    // `LauncherRoot.tsx` is RN and cannot be rendered under Node (the boundary's own behaviour is
    // exercised in `observability-ui.suite.ts`), so the WIRING is asserted statically — the
    // repo's established idiom for this file (`prompt-flow-wiring.suite.ts`).
    const src = fs.readFileSync(path.join(process.cwd(), 'src', 'host', 'launcher', 'LauncherRoot.tsx'), 'utf8');
    h.ok(
      /<ScreenBoundary screen=\{screen\.kind\} FallbackComponent=\{ScreenErrorFallback\}>/.test(src),
      'the boundary is keyed by the active screen and given the launcher fallback explicitly',
    );
    const frame = src.slice(src.indexOf('<SafeAreaView'), src.indexOf('</SafeAreaView>'));
    h.ok(frame.includes('<ScreenBoundary'), 'the boundary sits INSIDE the safe-area frame (design D1) — a screen failure keeps the shell');
    h.ok(
      src.indexOf('<ScreenBoundary') < src.indexOf('{content}'),
      'and it wraps the screen switch’s content value',
    );
    const devTools = src.slice(src.indexOf('function DevLogTools'), src.indexOf('function LauncherShell'));
    h.ok(src.includes('<DevLogTools '), 'the developer log surface is mounted in the shell');
    h.ok(
      devTools.includes('if (!devLogOverlayEnabled(__DEV__))') && devTools.includes('return null'),
      'the affordance AND the overlay are gated on the same predicate the overlay gates itself on',
    );
    h.ok(devTools.includes('<DevLogOverlay'), 'and that gate is the only route to the overlay');
  });
}
