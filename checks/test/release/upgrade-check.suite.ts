/**
 * Acceptance for the release upgrade check (beta-1 tasks 9.1–9.2; spec release-upgrade-check):
 * `scripts/release/lib/{mmkv,upgrade-record}.ts`, the `upgrade-record`/`upgrade-diff` commands of
 * `scripts/release/run.mjs`, the Maestro flows' selectors, and `scripts/release/upgrade-check.sh`
 * itself, run end to end with fake `adb`/`emulator`/`maestro`/`curl` on PATH.
 *
 * The capture fixture (`fixtures/upgrade-check/`) is real: `maestro hierarchy` dumps and the
 * launcher's MMKV store pulled with `run-as`, from an emulator running an offline build from before
 * 382511 (build 382100, the same UI). Its state is an ordinary dev session, not a seed: the three
 * examples, a fork of Tip Splitter and a fork of Water Counter, no saved glasses, and a History dump
 * for Style Gallery only. `fixtures/upgrade-check-ios/` is real too: the grid dumps and stores of a
 * passing iOS check (382511 seeded on a new simulator, then beta-1 over it), and 382511's tile menu,
 * where iOS reads a pressable and everything in it as one element with a joined label.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import nodeAssert from 'node:assert';
import { test } from '../harness';
import { readMmkv } from '../../../scripts/release/lib/mmkv';
import {
  buildRecord,
  diffRecords,
  readCapture,
  seedFindings,
  tilesOnGrid,
  versionsFromHistory,
  SAVED_DATA_APP,
  SAVED_DATA_LABELS,
  type UpgradeRecord,
} from '../../../scripts/release/lib/upgrade-record';
import { COPY, historySubtitle } from '../../../src/host/launcher/copy';
import { RELEASE } from '../../../src/host/launcher/release-config';

const REPO_ROOT = process.cwd();
const CAPTURE = path.join(REPO_ROOT, 'checks/test/release/fixtures/upgrade-check');
// The captures of a passing iOS check: 382511 seeded on a new simulator, then beta-1 over it.
const IOS_BEFORE = path.join(REPO_ROOT, 'checks/test/release/fixtures/upgrade-check-ios/before');
const IOS_AFTER = path.join(REPO_ROOT, 'checks/test/release/fixtures/upgrade-check-ios/after');
// 382511's tile menu on iOS, open on the seed's generated app: one element, its rows joined.
const IOS_TILE_MENU = path.join(REPO_ROOT, 'checks/test/release/fixtures/upgrade-check-ios/tile-menu-382511.json');
// 382511's Settings on Android with the keyboard up, as Maestro saw it when a seed tap failed there:
// the app's window (its root view below) and the keyboard's, whose back key is labelled "Back" too.
const ANDROID_SETTINGS_KEYBOARD = path.join(REPO_ROOT, 'checks/test/release/fixtures/upgrade-check-android/settings-keyboard-382511.json');
const ANDROID_APP_WINDOW = 'com.anycognition.whim:id/action_bar_root';
const STORE = path.join(CAPTURE, 'storage/whim.launcher');
const FLOWS = path.join(REPO_ROOT, 'scripts/release/upgrade-check');
const DEVICE_ID = 'dbc53eef-5ac9-46f0-b171-3b57cb3e4fab';
const GRANT = { version: 1, grantedAt: '2026-09-24T04:47:44.866Z' };

const scratchDirs: string[] = [];

function scratch(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-upgrade-check-suite-'));
  scratchDirs.push(dir);
  return dir;
}

/** The fixture's record with what a seed adds: two versions for the fork, one for every example,
 *  and two saved glasses. */
function completeSeed(): UpgradeRecord {
  const record = buildRecord(readCapture(CAPTURE));
  return {
    ...record,
    tiles: record.tiles.map((tile) => ({ ...tile, versions: tile.example ? 1 : 2 })),
    savedData: { 'Water Counter / Glasses': '2', 'Water Counter / History entries': '2' },
  };
}

function writeRecord(dir: string, name: string, record: UpgradeRecord): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(record));
  return file;
}

function releaseCli(args: string[]) {
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts/release/run.mjs'), ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// ── the flows' selectors against the app's own strings ──────────────────────────────────────────

/** Every double-quoted selector value in a flow (`tapOn`, `longPressOn`, `visible`, `text`), YAML
 *  escapes undone; `${…}` values come from `-e` and are skipped. */
function flowSelectors(yaml: string): string[] {
  const out: string[] = [];
  for (const match of yaml.matchAll(/\b(?:tapOn|longPressOn|visible|text):\s*"((?:[^"\\]|\\.)*)"/g)) {
    const value = match[1].replace(/\\(.)/g, '$1');
    if (!value.includes('${')) out.push(value);
  }
  return out;
}

/** The quoted selector of a flow's first `<command>:` line, `${…}` left in, YAML escapes undone. */
function commandSelector(file: string, command: string): string {
  const yaml = fs.readFileSync(path.join(FLOWS, file), 'utf8');
  const match = new RegExp(`\\b${command}:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(yaml);
  nodeAssert.ok(match, `${file} has a quoted ${command}`);
  return match[1].replace(/\\(.)/g, '$1');
}

interface DumpNode {
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly children?: readonly DumpNode[];
}

/** Whether a selector's whole-string pattern matches a node's text, hint or accessibility label. */
function labelMatches(node: DumpNode, pattern: RegExp): boolean {
  return ['text', 'hintText', 'accessibilityText'].some((key) => {
    const value = node.attributes?.[key];
    return typeof value === 'string' && pattern.test(value);
  });
}

/** Whether a Maestro text selector finds a node in a `maestro hierarchy` dump: its regex must match
 *  the whole of a node's text, hint or accessibility label. Case-sensitive, so stricter than Maestro. */
function selectorFinds(root: unknown, selector: string): boolean {
  const pattern = new RegExp(`^(?:${selector})$`);
  const visit = (node: DumpNode): boolean => labelMatches(node, pattern) || (node.children ?? []).some(visit);
  return visit(root as DumpNode);
}

interface PlacedNode {
  readonly node: DumpNode;
  /** Inside the app's window, rather than a system bar or the keyboard. */
  readonly inApp: boolean;
  /** It or a node around it is clickable, so a tap on it presses something. */
  readonly pressable: boolean;
  /** It sits in a scrollable node, which in React Native drops the keyboard on a tap nothing presses. */
  readonly inScrollView: boolean;
}

/** Every node of an Android `maestro hierarchy` dump, with where it sits. */
function placeNodes(root: unknown): PlacedNode[] {
  const out: PlacedNode[] = [];
  const visit = (node: DumpNode, around: Omit<PlacedNode, 'node'>) => {
    const attributes = node.attributes ?? {};
    const here = {
      inApp: around.inApp || attributes['resource-id'] === ANDROID_APP_WINDOW,
      pressable: around.pressable || attributes.clickable === 'true',
      inScrollView: around.inScrollView || attributes.scrollable === 'true',
    };
    out.push({ node, ...here });
    for (const child of node.children ?? []) visit(child, here);
  };
  visit(root as DumpNode, { inApp: false, pressable: false, inScrollView: false });
  return out;
}

/** A flow's `env:` block. `fallback` is set when the value defers to a `-e` value of the same name
 *  (`${NAME || 'fallback'}`): Maestro lets a plain env value override `-e`. */
function flowEnv(yaml: string): Map<string, { value: string; fallback?: string }> {
  const out = new Map<string, { value: string; fallback?: string }>();
  const config = yaml.split(/^---$/m)[0];
  const block = /^env:\n((?: {2}.*\n)*)/m.exec(config);
  for (const line of block?.[1].split('\n') ?? []) {
    const entry = /^ {2}(\w+):(.*)$/.exec(line);
    if (!entry) continue;
    const name = entry[1];
    const value = entry[2].trim();
    const deferring = /^\$\{(\w+) \|\| '([^']*)'\}$/.exec(value);
    out.set(name, deferring?.[1] === name ? { value, fallback: deferring[2] } : { value });
  }
  return out;
}

/** String literals and JSX text in a source file. */
function literalsIn(file: string): string[] {
  const source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
  return [...source.matchAll(/'([^'\n]*)'|"([^"\n]*)"|>([^<>{}\n]+)</g)].map((m) => (m[1] ?? m[2] ?? m[3]).trim());
}

function appStrings(): string[] {
  const copy = Object.values(COPY).filter((value): value is string => typeof value === 'string');
  return [
    ...copy,
    // Eyebrow text renders uppercase ("YOUR APPS", "ADVANCED").
    ...copy.map((value) => value.toUpperCase()),
    historySubtitle(2, 'just now'),
    // The server-address field's placeholder (SettingsScreen).
    RELEASE.serverUrl.replace(/^https?:\/\//, ''),
    ...literalsIn('fixtures/water-counter.app.tsx'),
  ];
}

// ── upgrade-check.sh with fake device tools ─────────────────────────────────────────────────────

const FAKE_ADB = `#!/bin/bash
[ "$1" = "-s" ] && shift 2
case "$1" in
  devices) printf 'List of devices attached\\n\\n' ;;
  emu) kill "$(cat "$FAKE_STATE/emulator.pid")" 2>/dev/null; exit 0 ;;
  install) [ "$2" = "-r" ] && shift; cat "$2" >> "$FAKE_STATE/installs"; echo Success ;;
  exec-out)
    case "$2" in
      screencap) printf 'png' ;;
      run-as) cat "$FAKE_CAPTURE/storage/$(basename "$5")" ;;
    esac ;;
  shell)
    case "$2" in
      getprop) echo 1 ;;
      dumpsys) printf '    versionCode=%s minSdk=24 targetSdk=36\\n' "$(tail -n 1 "$FAKE_STATE/installs")" ;;
    esac ;;
esac
exit 0
`;

const FAKE_EMULATOR = `#!/bin/bash
echo $$ > "$FAKE_STATE/emulator.pid"
exec sleep 600
`;

// `test` remembers the flow and its TILE; `hierarchy` answers with that screen. The Water Counter
// screen shows two glasses, or FAKE_GLASSES_AFTER once the second APK is installed.
const FAKE_MAESTRO = `#!/bin/bash
[ "$1" = "--device" ] && shift 2
command="$1"; shift
if [ "$command" = "test" ]; then
  tile=""
  while [ $# -gt 1 ]; do
    case "$1" in
      -e) case "$2" in TILE=*) tile="\${2#TILE=}" ;; esac; shift 2 ;;
      --debug-output) shift 2 ;;
      *) shift ;;
    esac
  done
  flow="$(basename "$1" .yaml)"
  printf '%s|%s\\n' "$flow" "$tile" > "$FAKE_STATE/last-flow"
  if [ "$flow" = "\${FAKE_FAIL_FLOW:-}" ]; then echo 'Assertion is false: "Build it" is visible'; exit 1; fi
  echo "Flow $flow COMPLETED"
  exit 0
fi
IFS='|' read -r flow tile < "$FAKE_STATE/last-flow"
case "$flow" in
  read-grid) cat "$FAKE_CAPTURE/grid.json" ;;
  read-history)
    count="1 version"; [ "$tile" = "Tip Splitter" ] && count="2 versions"
    printf '{"children":[{"attributes":{"text":"%s history"}},{"attributes":{"text":"%s · started 1d ago"}}]}\\n' "$tile" "$count" ;;
  read-water-counter)
    glasses=2; [ "$(wc -l < "$FAKE_STATE/installs")" -ge 2 ] && glasses="\${FAKE_GLASSES_AFTER:-2}"
    printf '{"children":[{"attributes":{"text":"Glasses"}},{"attributes":{"text":"%s"}},{"attributes":{"text":"History entries"}},{"attributes":{"text":"2"}}]}\\n' "$glasses" ;;
esac
`;

const FAKE_CURL = `#!/bin/bash
printf '{"ok":true,"service":"whim-server"}'
`;

interface ScriptRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly evidence: string;
  readonly from: string;
  readonly to: string;
  readonly emulator: 'never started' | 'stopped' | 'still running';
}

function runUpgradeCheck(opts: { toBuild?: string; env?: Record<string, string> } = {}): ScriptRun {
  const root = scratch();
  const bin = path.join(root, 'bin');
  const state = path.join(root, 'state');
  for (const dir of [bin, state]) fs.mkdirSync(dir);
  const fakes: Record<string, string> = { adb: FAKE_ADB, emulator: FAKE_EMULATOR, maestro: FAKE_MAESTRO, curl: FAKE_CURL };
  for (const [name, body] of Object.entries(fakes)) fs.writeFileSync(path.join(bin, name), body, { mode: 0o755 });
  const from = path.join(root, 'from.apk');
  const to = path.join(root, 'to.apk');
  fs.writeFileSync(from, '382511\n');
  fs.writeFileSync(to, `${opts.toBuild ?? '390000'}\n`);
  const evidence = path.join(root, 'evidence');
  const result = spawnSync(
    '/bin/bash',
    [path.join(REPO_ROOT, 'scripts/release/upgrade-check.sh'), '--platform', 'android', '--avd', 'Fake_AVD', '--from', from, '--to', to, '--evidence', evidence],
    {
      cwd: REPO_ROOT,
      env: { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`, HOME: root, FAKE_STATE: state, FAKE_CAPTURE: CAPTURE, ...opts.env },
      encoding: 'utf8',
      timeout: 120_000,
    },
  );
  let emulator: ScriptRun['emulator'] = 'never started';
  const pidFile = path.join(state, 'emulator.pid');
  if (fs.existsSync(pidFile)) {
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    try {
      process.kill(pid, 0);
      emulator = 'still running';
      process.kill(pid);
      // eslint-disable-next-line no-restricted-syntax -- intentional: ESRCH means the script already stopped its emulator, which is the expected case
    } catch {
      emulator = 'stopped';
    }
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, evidence, from, to, emulator };
}

export async function run(): Promise<void> {
  try {
    await runCases();
  } finally {
    for (const dir of scratchDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function runCases(): Promise<void> {
  const readStore = () => [fs.readFileSync(STORE), fs.readFileSync(`${STORE}.crc`)];

  await test('mmkv: reads the launcher store a device wrote: the device id, the consent grant and the app order', () => {
    const [data, meta] = readStore();
    const store = readMmkv(data, meta, STORE);
    nodeAssert.strictEqual(store.getString('whim.device:v1'), DEVICE_ID);
    nodeAssert.deepStrictEqual(JSON.parse(store.getString('whim.ai-consent:v1') ?? 'null'), GRANT);
    nodeAssert.deepStrictEqual(JSON.parse(store.getString('order') ?? 'null'), [
      'tip-splitter',
      'water-counter',
      'style-gallery',
      'app-muf1xv18-g4xhofh3',
      'app-muf24dhi-lgu1pmy9',
    ]);
    nodeAssert.ok((store.getString('lastrun:app-muf24dhi-lgu1pmy9') ?? '').startsWith('[{"t":1790225636392,'), 'a value longer than 127 bytes reads whole');
  });

  await test('mmkv: a key deleted by its latest write reads as absent, though stale bytes past the data still hold an older value', () => {
    const [data, meta] = readStore();
    const key = 'journal:app-muf24dhi-lgu1pmy9';
    const last = data.lastIndexOf(key);
    nodeAssert.ok(data.toString('latin1', last, last + 200).includes('"kind":"stage"'), 'the last raw occurrence of the key carries a journal');
    const store = readMmkv(data, meta, STORE);
    nodeAssert.strictEqual(store.getString(key), undefined);
    const launcherKey = /^(?:whim\.[a-z-]+:v1|order|seed:version|(?:app|pending|journal|lastrun):[\w-]+)$/;
    nodeAssert.deepStrictEqual(store.keys().filter((k) => !launcherKey.test(k)), [], 'every key read is one the launcher writes');
  });

  await test('mmkv: a store whose bytes no longer match the meta crc is refused, naming the store', () => {
    const [data, meta] = readStore();
    const corrupted = Buffer.from(data);
    corrupted[40] = 255 - corrupted[40];
    nodeAssert.throws(() => readMmkv(corrupted, meta, 'the-store'), /^Error: the-store: crc32/);
  });

  await test('upgrade-record: the real capture reads into apps, their tiles, versions, saved data, consent and device id', () => {
    const record = buildRecord(readCapture(CAPTURE));
    nodeAssert.deepStrictEqual(
      record.tiles.map((tile) => [tile.name, tile.example, tile.onGrid]),
      [
        ['Tip Splitter', true, true],
        ['Water Counter', true, true],
        ['Style Gallery', true, true],
        ['Tip Splitter', false, true],
        ['Water Counter', false, true],
      ],
    );
    nodeAssert.deepStrictEqual(
      record.tiles.map((tile) => tile.versions),
      [null, null, 1, null, null],
      'only Style Gallery has a History dump',
    );
    nodeAssert.deepStrictEqual(record.savedData, { 'Water Counter / Glasses': '0', 'Water Counter / History entries': '0' });
    nodeAssert.deepStrictEqual(record.consent, GRANT);
    nodeAssert.strictEqual(record.deviceId, DEVICE_ID);
  });

  await test('upgrade-record: real iOS grids, where a tile reads as one joined label, show every app before and after the upgrade', () => {
    const before = buildRecord(readCapture(IOS_BEFORE));
    const after = buildRecord(readCapture(IOS_AFTER));
    nodeAssert.deepStrictEqual(
      after.tiles.map((tile) => [tile.name, tile.example, tile.onGrid]),
      [
        ['Tip Splitter', true, true],
        ['Water Counter', true, true],
        ['Style Gallery', true, true],
        ['Hello App', false, true],
      ],
    );
    nodeAssert.deepStrictEqual(diffRecords(before, after), []);
  });

  await test('upgrade-record: on a screen that shows none of the names, no app has a tile and none gets its History read', () => {
    const capture = readCapture(CAPTURE);
    const notTheGrid = capture.histories['style-gallery'];
    nodeAssert.ok(buildRecord({ ...capture, grid: notTheGrid }).tiles.every((tile) => !tile.onGrid));
    nodeAssert.deepStrictEqual(tilesOnGrid(capture.store, notTheGrid), []);
  });

  await test('upgrade-record: reads the version count History shows, in the words copy.ts writes it', () => {
    for (const count of [1, 2, 12]) nodeAssert.strictEqual(versionsFromHistory([historySubtitle(count, 'just now')]), count);
  });

  await test("upgrade-record: the saved-data app and labels are the Water Counter example's own", () => {
    const source = fs.readFileSync(path.join(REPO_ROOT, 'fixtures/water-counter.app.tsx'), 'utf8');
    nodeAssert.ok(source.includes(`name: '${SAVED_DATA_APP}'`), `the example is named ${SAVED_DATA_APP}`);
    for (const label of SAVED_DATA_LABELS) nodeAssert.ok(source.includes(`>${label}</Text>`), `the example shows "${label}"`);
  });

  await test('seed: the dev-session capture is not a seed, and the check names what it lacks', () => {
    const findings = seedFindings(buildRecord(readCapture(CAPTURE)));
    for (const expected of [
      'seed: no generated app with at least two versions',
      'seed: Water Counter shows no saved glasses',
      'seed: no version count read for "Tip Splitter"',
    ]) {
      nodeAssert.ok(findings.includes(expected), `${expected} — got ${JSON.stringify(findings)}`);
    }
  });

  await test('seed: a record with every seeded item has no findings, and an unchanged record no differences', () => {
    const seed = completeSeed();
    nodeAssert.deepStrictEqual(seedFindings(seed), []);
    nodeAssert.deepStrictEqual(diffRecords(seed, completeSeed()), []);
  });

  await test('diff: each loss after the upgrade is its own line', () => {
    const before = completeSeed();
    const after: UpgradeRecord = {
      deviceId: 'a-new-id',
      consent: null,
      tiles: before.tiles
        .filter((tile) => tile.id !== 'tip-splitter')
        .map((tile) => (tile.id === 'app-muf1xv18-g4xhofh3' ? { ...tile, versions: 1 } : tile)),
      savedData: { 'Water Counter / Glasses': '2' },
    };
    nodeAssert.deepStrictEqual(diffRecords(before, after), [
      `device id: "${DEVICE_ID}" became "a-new-id"`,
      `consent grant: ${JSON.stringify(GRANT)} became nothing`,
      'app "Tip Splitter" (tip-splitter) is no longer installed',
      'app "Tip Splitter": 2 versions became 1',
      'saved data "Water Counter / History entries": "2" became nothing',
    ]);
  });

  await test('upgrade-diff: a saved datum missing after the upgrade fails the check and names it; the same record passes', () => {
    const dir = scratch();
    const seed = completeSeed();
    const before = writeRecord(dir, 'before.json', seed);
    const same = writeRecord(dir, 'same.json', seed);
    const lost = writeRecord(dir, 'lost.json', { ...seed, savedData: { 'Water Counter / History entries': '2' } });

    const pass = releaseCli(['upgrade-diff', before, same]);
    nodeAssert.strictEqual(pass.status, 0, pass.stdout + pass.stderr);
    nodeAssert.match(pass.stdout, /^upgrade-diff: PASS: 5 apps, 7 versions, 2 saved values/m);

    const fail = releaseCli(['upgrade-diff', before, lost]);
    nodeAssert.strictEqual(fail.status, 1, fail.stdout + fail.stderr);
    nodeAssert.match(fail.stdout, /^saved data "Water Counter \/ Glasses": "2" became nothing$/m);
    nodeAssert.match(fail.stdout, /^upgrade-diff: FAIL \(1 finding\)$/m);
  });

  await test('upgrade-diff: an incomplete seed fails even when nothing changed across the upgrade', () => {
    const record = writeRecord(scratch(), 'seed.json', buildRecord(readCapture(CAPTURE)));
    const result = releaseCli(['upgrade-diff', record, record]);
    nodeAssert.strictEqual(result.status, 1, result.stdout + result.stderr);
    nodeAssert.match(result.stdout, /^seed: no generated app with at least two versions$/m);
  });

  await test('flows: every literal selector in the upgrade-check flows matches something the app shows, as a string or as the joined label iOS reads', () => {
    const shown = appStrings();
    const tileMenu = JSON.parse(fs.readFileSync(IOS_TILE_MENU, 'utf8')) as unknown;
    const misses: string[] = [];
    const files = fs.readdirSync(FLOWS).filter((file) => file.endsWith('.yaml'));
    nodeAssert.ok(files.includes('seed.yaml') && files.length >= 4, `flows found: ${files.join(', ')}`);
    for (const file of files) {
      for (const selector of flowSelectors(fs.readFileSync(path.join(FLOWS, file), 'utf8'))) {
        const pattern = new RegExp(`^(?:${selector})$`);
        if (!shown.some((text) => pattern.test(text)) && !selectorFinds(tileMenu, selector)) misses.push(`${file}: "${selector}"`);
      }
    }
    nodeAssert.deepStrictEqual(misses, []);
  });

  await test('flows: the tile selectors find every installed app on real home grids of both platforms, before and after the upgrade', () => {
    const history = commandSelector('read-history.yaml', 'longPressOn');
    const generated = commandSelector('seed.yaml', 'longPressOn');
    const waterCounter = commandSelector('read-water-counter.yaml', 'tapOn');
    const misses: string[] = [];
    for (const [label, dir] of [['android', CAPTURE], ['ios 382511', IOS_BEFORE], ['ios beta-1', IOS_AFTER]]) {
      const capture = readCapture(dir);
      const tiles = buildRecord(capture).tiles;
      nodeAssert.ok(tiles.some((tile) => tile.name === SAVED_DATA_APP), `${label}: ${SAVED_DATA_APP} is installed`);
      for (const tile of tiles) {
        if (!selectorFinds(capture.grid, history.split('${TILE}').join(tile.name))) misses.push(`${label}: read-history.yaml, "${tile.name}"`);
        if (!tile.example && !selectorFinds(capture.grid, generated.split('${GENERATED_APP}').join(tile.name))) {
          misses.push(`${label}: seed.yaml, "${tile.name}"`);
        }
      }
      if (!selectorFinds(capture.grid, waterCounter)) misses.push(`${label}: read-water-counter.yaml`);
    }
    nodeAssert.deepStrictEqual(misses, []);
  });

  await test("flows: on Android's keyboard, which has a Back key of its own, the seed drops the keyboard with a plain label on screen and waits that key out before tapping Back", () => {
    const seed = fs.readFileSync(path.join(FLOWS, 'seed.yaml'), 'utf8');
    const steps =
      /- inputText: \$\{SERVER_URL\}\n- tapOn: "((?:[^"\\]|\\.)*)"\n- extendedWaitUntil:\n +notVisible:\n +id: "([^"]+)"\n +timeout: \d+\n- tapOn: "((?:[^"\\]|\\.)*)"/.exec(seed);
    nodeAssert.ok(steps, 'seed.yaml types the server address, taps a label, waits for an id to go, then taps Back');
    const [drop, keyboardKey, back] = steps.slice(1).map((value) => new RegExp(`^(?:${value.replace(/\\(.)/g, '$1')})$`));
    const placed = placeNodes(JSON.parse(fs.readFileSync(ANDROID_SETTINGS_KEYBOARD, 'utf8')));
    const describe = (entry: PlacedNode) => JSON.stringify({ ...entry, node: entry.node.attributes });
    const drops = placed.filter((entry) => labelMatches(entry.node, drop));
    nodeAssert.ok(drops.length > 0, `${drop} finds nothing on the screen the keyboard leaves`);
    for (const entry of drops) {
      nodeAssert.ok(entry.inApp && entry.inScrollView && !entry.pressable, `${drop} finds more than a plain label in the app's ScrollView: ${describe(entry)}`);
    }
    const backs = placed.filter((entry) => labelMatches(entry.node, back));
    nodeAssert.ok(backs.some((entry) => entry.inApp && entry.pressable), `${back} finds the header's back button`);
    const keys = backs.filter((entry) => !entry.inApp).map((entry) => String(entry.node.attributes?.['resource-id']));
    nodeAssert.ok(keys.length > 0, `${back} finds a key of the keyboard`);
    for (const key of keys) nodeAssert.match(key, keyboardKey, `the seed waits out every key ${back} finds on the keyboard`);
  });

  await test("flows: the seed's generated-app name is the one the stub pipeline gives every app", () => {
    const name = flowEnv(fs.readFileSync(path.join(FLOWS, 'seed.yaml'), 'utf8')).get('GENERATED_APP')?.fallback;
    nodeAssert.ok(name !== undefined, 'seed.yaml declares GENERATED_APP with a default');
    nodeAssert.ok(fs.readFileSync(path.join(REPO_ROOT, 'server/src/pipeline.ts'), 'utf8').includes(`name: '${name}'`), `the stub names its app "${name}"`);
  });

  await test('flows: every -e value upgrade-check.sh passes reaches its flow, since a plain env default would override it', () => {
    const script = fs.readFileSync(path.join(REPO_ROOT, 'scripts/release/upgrade-check.sh'), 'utf8');
    const passed = [...script.matchAll(/run_flow \S+ ([\w-]+)((?: -e "\w+=[^"]*")+)/g)].flatMap((call) =>
      [...call[2].matchAll(/-e "(\w+)=/g)].map((param) => ({ flow: call[1], name: param[1] })),
    );
    nodeAssert.ok(
      passed.some((param) => param.flow === 'seed' && param.name === 'SERVER_URL'),
      `the script's -e parameters were found: ${JSON.stringify(passed)}`,
    );
    const blocking = passed.filter((param) => {
      const entry = flowEnv(fs.readFileSync(path.join(FLOWS, `${param.flow}.yaml`), 'utf8')).get(param.name);
      return entry !== undefined && entry.fallback === undefined;
    });
    nodeAssert.deepStrictEqual(blocking, []);
  });

  await test('upgrade-check.sh: a clean upgrade passes, records both builds, and stops its emulator', () => {
    const result = runUpgradeCheck();
    nodeAssert.strictEqual(result.status, 0, result.stdout + result.stderr);
    nodeAssert.match(result.stdout, /^RESULT: PASS$/m);
    const summary = fs.readFileSync(path.join(result.evidence, 'result.txt'), 'utf8');
    nodeAssert.ok(summary.includes(`from: ${result.from}, build 382511`), summary);
    nodeAssert.ok(summary.includes(`to: ${result.to}, build 390000`), summary);
    const seed = JSON.parse(fs.readFileSync(path.join(result.evidence, 'before.json'), 'utf8')) as UpgradeRecord;
    nodeAssert.strictEqual(seed.deviceId, DEVICE_ID);
    nodeAssert.strictEqual(result.emulator, 'stopped');
  });

  await test('upgrade-check.sh: a saved count that changed across the upgrade fails the diff step and names it', () => {
    const result = runUpgradeCheck({ env: { FAKE_GLASSES_AFTER: '0' } });
    nodeAssert.strictEqual(result.status, 1, result.stdout + result.stderr);
    nodeAssert.match(result.stdout, /^saved data "Water Counter \/ Glasses": "2" became "0"$/m);
    nodeAssert.match(result.stdout, /^RESULT: FAIL$/m);
    nodeAssert.match(result.stderr, /FAILED at step "diff"/);
  });

  await test('upgrade-check.sh: a failing seed flow stops at the seed step, shows Maestro’s output, and stops the emulator', () => {
    const result = runUpgradeCheck({ env: { FAKE_FAIL_FLOW: 'seed' } });
    nodeAssert.strictEqual(result.status, 1, result.stdout + result.stderr);
    nodeAssert.match(result.stderr, /Assertion is false/);
    nodeAssert.match(result.stderr, /FAILED at step "seed"/);
    nodeAssert.strictEqual(result.emulator, 'stopped');
  });

  await test('upgrade-check.sh: installing the same build over itself is refused, since it would prove nothing', () => {
    const result = runUpgradeCheck({ toBuild: '382511' });
    nodeAssert.strictEqual(result.status, 1, result.stdout + result.stderr);
    nodeAssert.match(result.stderr, /step "install-to": build 382511 is installed after the upgrade; it must be higher/);
  });
}
