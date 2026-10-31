/**
 * haptics (design-system-v1 chain-8, system.md §5): the shell's moment map and the app cue
 * backend, played into the `WhimHaptics` module. The moment map is checked against the §5 table
 * itself, so the doc and the map can't drift apart; app cues run through the real bridge
 * dispatcher so the rate cap is observed where it applies, after the at-most-once dedupe.
 */
import fs from 'node:fs';
import path from 'node:path';
import { hapticCalls } from './native-host';
import { Harness } from './harness';
import { createHaptics, haptics, SHELL_HAPTICS, type HapticMoment } from '../../haptics';
import { createCueBackend } from '../../cue-backend';
import { createDefaultRegistry, Dispatcher, launchApp, type RealmRecord, type SysretFrame } from '../../bridge';
import type { Spec } from '../../../native/NativeWhimHaptics';

const SYSTEM_MD = path.join(process.cwd(), 'docs/design/system.md');

/** Which moments each §5 row names, by the start of its "Moment" cell. */
const ROW_MOMENTS: Record<string, HapticMoment[]> = {
  'Selection moves': ['selection'],
  'Switch toggles': ['toggle-on', 'toggle-off'],
  'Long-press opens a menu': ['long-press'],
  'A drag crosses its commit point': ['commit'],
  'Work handed to Whim': ['handoff'],
  'App ready': ['success'],
  'Making failed': ['failure'],
  'App deleted': ['warning'],
};

/** The native call §5 documents for each moment, as `hapticCalls` records it: the iOS cell names
 *  the generator and its arguments, the Android cell's first constant (one per moment where a
 *  row lists one per moment, as toggles do) is the `android` argument. */
function documentedCalls(): Map<HapticMoment, string> {
  const doc = fs.readFileSync(SYSTEM_MD, 'utf8');
  const section = /## 5\. Haptics\n([\s\S]*?)\n## 6\./.exec(doc)?.[1];
  if (!section) throw new Error('system.md no longer has a §5 Haptics section');
  const calls = new Map<HapticMoment, string>();
  for (const line of section.split('\n')) {
    const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
    if (cells.length !== 3 || cells[0] === 'Moment' || cells[0].startsWith('---')) continue;
    const [label, ios, android] = cells;
    const moments = Object.entries(ROW_MOMENTS).find(([start]) => label.startsWith(start))?.[1];
    if (!moments) throw new Error(`system.md §5 has a row no moment covers: "${label}"`);
    const constants = (android.split(',')[0].match(/`([A-Z_]+)`/g) ?? []).map((c) => c.slice(1, -1));
    const words = ios.split(' ');
    moments.forEach((moment, i) => {
      const constant = constants.length === moments.length ? constants[i] : constants[0];
      if (words[0] === 'selection') calls.set(moment, `selection:${constant}`);
      else if (words[0] === 'impact') calls.set(moment, `impact:${words[1]},${words[2] ?? 1},${constant}`);
      else calls.set(moment, `notification:${words[1]},${constant}`);
    });
  }
  return calls;
}

function played(): string[] {
  return hapticCalls.splice(0);
}

/** The clock every capped cue backend here reads, in ms. */
const clock = { t: 0 };

/** A cues-only app's realm and a dispatcher over a registry whose cue backend reads `clock`. */
function cueRealm(appId: string, registry = createDefaultRegistry({ cueBackend: createCueBackend({ now: () => clock.t }) })): { realm: RealmRecord; d: Dispatcher } {
  const launched = launchApp({ appId, name: appId, manifest: { capabilities: ['cues'] } }, () => {
    throw new Error('a cues-only app opens no storage');
  });
  if (!launched.ok) throw new Error('launch refused: ' + launched.error.hint);
  return { realm: launched.realm, d: Dispatcher.forRealm(launched.realm, registry) };
}
let nextId = 1;
function hapticFrame(kind: string, id = nextId++): object {
  return { whim: 'syscall', v: 1, id, gen: 1, method: 'cues.haptic', params: { kind } };
}
const cuesPlayed = (): number => played().filter((c) => c.startsWith('cue:')).length;

export async function runHapticsTests(h: Harness): Promise<void> {
  await h.test('haptics: every shell moment plays the call system.md §5 documents', () => {
    const documented = documentedCalls();
    h.eq([...documented.keys()].sort((x, y) => x.localeCompare(y)), Object.keys(SHELL_HAPTICS).sort((x, y) => x.localeCompare(y)), 'the §5 table and the moment map name the same moments');
    played();
    for (const [moment, call] of documented) {
      haptics.play(moment);
      h.eq(played(), [call], `${moment} plays ${call} on the installed WhimHaptics module`);
    }
  });

  await h.test('haptics: prepare warms the generator the moment will play', () => {
    played();
    for (const moment of ['selection', 'commit', 'handoff', 'warning'] as const) haptics.prepare(moment);
    h.eq(played(), ['prepare:selection', 'prepare:rigid', 'prepare:medium', 'prepare:notification'], 'each moment prepares its own generator');
  });

  await h.test('haptics: a build without the module, or a module that throws, never reaches the caller', () => {
    const absent = createHaptics(null);
    absent.play('handoff');
    absent.prepare('handoff');
    const failing = new Proxy({}, { get: () => () => { throw new Error('engine unavailable'); } }) as Spec;
    let thrown: unknown = null;
    try {
      createHaptics(failing).play('failure');
    } catch (e) {
      thrown = e;
    }
    h.eq(thrown, null, 'a throwing module is swallowed');
  });

  await h.test('cue-backend: each app cue token reaches WhimHaptics as its own token', async () => {
    const { d } = cueRealm('tokens', createDefaultRegistry({ cueBackend: createCueBackend() }));
    played();
    for (const kind of ['tap', 'double', 'heavy']) {
      const s = await d.handle(hapticFrame(kind));
      h.eq(s?.ok ? s.result : s, {}, `cues.haptic('${kind}') resolves {}`);
    }
    h.eq(played(), ['cue:tap', 'cue:double', 'cue:heavy'], 'tap, double and heavy each play once, through WhimHaptics');
  });

  await h.test('cue-backend: a burst of 20 within 100 ms plays 3, every call resolves, and a second later one plays again', async () => {
    clock.t = 0;
    const { d } = cueRealm('burst');
    played();
    const results: (SysretFrame | null)[] = [];
    for (let i = 0; i < 20; i++) {
      clock.t = i * 5;
      results.push(await d.handle(hapticFrame('tap')));
    }
    h.ok(results.every((s) => s?.ok === true && JSON.stringify(s.result) === '{}'), 'all 20 calls resolve {}, dropped or not');
    h.eq(cuesPlayed(), 3, 'only the burst of 3 plays');
    clock.t = 1095;
    await d.handle(hapticFrame('tap'));
    h.eq(cuesPlayed(), 1, 'a call a second later plays again');
  });

  await h.test('cue-backend: past the burst, cues play at 10 a second and no faster', async () => {
    clock.t = 0;
    const { d } = cueRealm('rate');
    for (let i = 0; i < 3; i++) await d.handle(hapticFrame('tap'));
    played();
    for (let i = 1; i <= 10; i++) {
      clock.t = i * 100;
      await d.handle(hapticFrame('tap'));
    }
    h.eq(cuesPlayed(), 10, 'one cue every 100 ms plays every time');
    clock.t = 1050;
    await d.handle(hapticFrame('tap'));
    h.eq(cuesPlayed(), 0, 'a cue 50 ms after the last is dropped');
  });

  await h.test('cue-backend: each realm has its own cap', async () => {
    clock.t = 0;
    const registry = createDefaultRegistry({ cueBackend: createCueBackend({ now: () => clock.t }) });
    const a = cueRealm('a', registry);
    const b = cueRealm('b', registry);
    played();
    for (let i = 0; i < 5; i++) await a.d.handle(hapticFrame('tap'));
    h.eq(cuesPlayed(), 3, 'realm a is capped at its burst');
    for (let i = 0; i < 5; i++) await b.d.handle(hapticFrame('heavy'));
    h.eq(cuesPlayed(), 3, 'realm b still plays its own burst');
  });

  await h.test('cue-backend: a deduped retry never counts against the cap twice', async () => {
    clock.t = 0;
    const { d } = cueRealm('retry');
    played();
    const retried = nextId++;
    for (let i = 0; i < 5; i++) await d.handle(hapticFrame('tap', retried));
    h.eq(cuesPlayed(), 1, 'five deliveries of one request play once');
    await d.handle(hapticFrame('tap'));
    await d.handle(hapticFrame('tap'));
    h.eq(cuesPlayed(), 2, 'the retries spent no tokens: two more fresh calls play');
    await d.handle(hapticFrame('tap'));
    h.eq(cuesPlayed(), 0, 'the fourth distinct call is over the burst');
  });

  await h.test('cue-backend: a build without WhimHaptics resolves haptic cues silently', async () => {
    const { d } = cueRealm('absent', createDefaultRegistry({ cueBackend: createCueBackend({ haptics: null }) }));
    played();
    const s = await d.handle(hapticFrame('tap'));
    h.eq(s?.ok ? s.result : s, {}, 'the cue still resolves {}');
    h.eq(played(), [], 'nothing reaches a module');
  });
}
