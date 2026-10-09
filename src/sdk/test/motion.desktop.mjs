// ─────────────────────────────────────────────────────────────────────────────
// SDK motion desktop verification (design-system-v1 task 6.5; system.md §4.4 M24, §4.5, §4.7).
// ─────────────────────────────────────────────────────────────────────────────
// Runs a mini-app that uses every moving SDK part inside the runtime's real sandboxed realm (the same
// outer page and locked CSP the app ships with, delivered by source) under headless Chromium, and
// checks each moment as a Reduce Motion PAIR, from inside the frame with `document.getAnimations()`:
//   - `reduceMotion: false`: the trigger starts motion (a transform, translate, width or stroke
//     animation; for the rAF parts, the element is drawn off its place on the next frames). This is
//     the negative control that proves the harness can see motion at all.
//   - `reduceMotion: true`: the identical trigger starts no motion, only the reduced form (opacity
//     cross-fades, colour fades) where the moment has one.
// It also checks that motion needs nothing beyond the sandbox's own surface (no CSP violation, no
// style sheet or script added), that Chromium plays the sampled `linear()` springs, that a keyed
// list animates only the row that left and closes the gap while an index-keyed one stays still, and
// that the off Switch track and the empty Slider track hold 3:1 against `surface` (WCAG 1.4.11) in
// both schemes on both platforms. Not part of `invariants/` (owner-authored); the invariant it
// motivates is drafted in openspec/changes/design-system-v1/invariant-proposal.md.
//
//   npm run build && node src/sdk/test/motion.desktop.mjs
/* global getComputedStyle, PointerEvent, DOMMatrix -- used inside the browser frame through evaluate() */
import { chromium } from 'playwright';
import { build as esbuild } from 'esbuild';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { buildSrcdoc, buildOuterHtml } from '../../../build/assemble.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

const { parts } = JSON.parse(await readFile(join(ROOT, 'src/runtime/generated/runtime-artifacts.json'), 'utf8'));

/** The mini-app, compiled with build/build.mjs's app-bundle options. */
async function bundleSource(contents) {
  const out = await esbuild({
    stdin: { contents, loader: 'tsx', resolveDir: ROOT, sourcefile: 'motion-check.app.tsx' },
    bundle: true, format: 'iife', globalName: '__WHIM_APP_MODULE__',
    platform: 'browser', target: 'es2019',
    tsconfigRaw: '{}',
    jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment',
    inject: [join(ROOT, 'build/react-inject-shim.ts')],
    external: ['vc-sdk', 'react', 'react-dom', 'react-dom/client'],
    minify: false, write: false, logLevel: 'warning',
  });
  return out.outputFiles[0].text;
}

const APP = await bundleSource(`import {
  defineApp, Screen, Stack, Button, List, ListItem, Modal, ProgressBar, Switch, Checkbox, Stepper,
  SegmentedControl, Slider, Card, Text, toast, nav, useState,
} from 'vc-sdk';
interface Item { id: string; name: string }
function Home() {
  const [items, setItems] = useState<Item[]>([{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }, { id: 'c', name: 'Gamma' }]);
  const [plain, setPlain] = useState<string[]>(['One', 'Two']);
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState(0.2);
  const [remind, setRemind] = useState(false);
  const [stretch, setStretch] = useState(false);
  const [laps, setLaps] = useState(1);
  const [effort, setEffort] = useState('Easy');
  const [pace, setPace] = useState(0);
  return (
    <Screen title="Motion">
      <Stack>
        <Button label="Press me" variant="secondary" />
        <Button label="Push" onPress={() => nav.navigate('Second')} />
        <Button label="Open sheet" variant="secondary" onPress={() => setOpen(true)} />
        <Button label="Toast" variant="secondary" onPress={() => toast('Hello')} />
        <Button label="Add" variant="secondary" onPress={() => setItems([...items, { id: 'd', name: 'Delta' }])} />
        <Button label="Remove B" variant="secondary" onPress={() => setItems(items.filter((i) => i.id !== 'b'))} />
        <Button label="Add plain" variant="secondary" onPress={() => setPlain([...plain, 'Three'])} />
        <Button label="Progress" variant="secondary" onPress={() => setProgress(0.9)} />
        <List items={items} keyBy="id" renderItem={(i) => <ListItem title={i.name} />} />
        <List items={plain} keyBy={(s) => plain.indexOf(s)} renderItem={(s) => <ListItem title={s} />} />
        <ProgressBar value={progress} />
        <Card>
          <Stack>
            <Switch label="Remind" value={remind} onChange={setRemind} />
            <Checkbox label="Stretch" checked={stretch} onChange={setStretch} />
            <Stepper label="Laps" value={laps} min={0} max={9} onChange={setLaps} />
            <SegmentedControl options={['Easy', 'Fast']} value={effort} onChange={setEffort} />
            <Slider label="Pace" value={pace} min={0} max={100} onChange={setPace} />
          </Stack>
        </Card>
      </Stack>
      <Modal visible={open} title="Sheet" onClose={() => setOpen(false)}><Text>Inside</Text></Modal>
    </Screen>
  );
}
function Second() { return <Screen title="Second"><Text>Pushed</Text></Screen>; }
export default defineApp({ name: 'Motion check', initial: 'Home', screens: { Home, Second }, capabilities: [] });
`);

const dir = await mkdtemp(join(tmpdir(), 'whim-motion-'));
const pageFile = join(dir, 'realm.html');
await writeFile(pageFile, buildOuterHtml({
  srcdoc: buildSrcdoc({ parts, channel: 'b' }), bundles: {}, initial: 'motion-check', channel: 'b',
  autostart: false, showDiagnostics: false,
}));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(ready, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await ready()) return true;
    await sleep(25);
  }
  return false;
}

/** Installed in the realm: find controls, run a trigger and report the animations it started. */
function installProbe() {
  const MOVING = new Set(['transform', 'translate', 'scale', 'rotate', 'width', 'height', 'left', 'top', 'strokeDashoffset', 'stroke-dashoffset', 'filter']);
  const IGNORED = new Set(['offset', 'computedOffset', 'easing', 'composite']);
  const violations = [];
  document.addEventListener('securitypolicyviolation', (e) => violations.push(`${e.violatedDirective} ${e.blockedURI}`));
  const describe = (a) => {
    const props = new Set();
    for (const frame of a.effect?.getKeyframes?.() ?? []) for (const k of Object.keys(frame)) if (!IGNORED.has(k)) props.add(k);
    if (a.transitionProperty) props.add(a.transitionProperty);
    const target = a.effect?.target;
    return {
      props: [...props],
      moving: [...props].some((p) => MOVING.has(p)),
      easing: a.effect?.getTiming?.().easing ?? '',
      text: target ? (target.textContent || '').trim().slice(0, 30) : '',
      inOffList: Boolean(target?.closest?.('[data-list-motion="off"]')),
    };
  };
  const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
  window.__probe = {
    violations,
    sheets: () => document.styleSheets.length,
    scripts: () => document.scripts.length,
    find: {
      button,
      label: (label) => document.querySelector(`[aria-label="${label}"]`),
      role: (role, text) => [...document.querySelectorAll(`[role="${role}"]`)].find((el) => text === undefined || el.textContent.trim() === text),
      text: (text) => document.body.textContent.includes(text),
    },
    /** Run `trigger()` and describe the animations that exist once React has committed what it
     *  caused (a discrete event's update commits in a microtask) and not before it. */
    async started(trigger) {
      const before = new Set(document.getAnimations());
      trigger();
      await new Promise((resolve) => setTimeout(resolve, 0));
      return document.getAnimations().filter((a) => !before.has(a)).map(describe);
    },
    mark() {
      window.__probe.before = new Set(document.getAnimations());
    },
    sinceMark() {
      return document.getAnimations().filter((a) => !window.__probe.before.has(a)).map(describe);
    },
    /** The `translate` an element is drawn with two frames after `trigger()`. */
    async drift(trigger, element) {
      trigger();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await new Promise((resolve) => setTimeout(resolve, 40));
      return getComputedStyle(element()).translate;
    },
    idle: () => document.getAnimations().every((a) => a.playState !== 'running'),
  };
}

function rgb(value) {
  const m = /rgba?\(([^)]*)\)/.exec(value);
  if (!m) throw new Error(`not an rgb colour: ${value}`);
  return m[1].split(',').slice(0, 3).map((n) => Number.parseFloat(n));
}
function luminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a, b) {
  const [x, y] = [luminance(rgb(a)), luminance(rgb(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const failures = [];
function check(name, ok, detail) {
  const why = ok ? '' : ` — ${detail}`;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${why}`);
  if (!ok) failures.push(name);
}

async function openRealm(browser, theme) {
  const page = await browser.newPage({ viewport: { width: 420, height: 2400 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e?.message || e)));
  // The outer page relays every realm frame to RN; keep them, to know when the runtime's own
  // containment probes (which try eval and data: scripts on purpose) have finished.
  await page.addInitScript(() => {
    if (window.top !== window) return;
    const frames = [];
    Object.defineProperty(window, '__relayed', { value: frames });
    window.ReactNativeWebView = { postMessage: (s) => frames.push(JSON.parse(s)) };
  });
  await page.goto(pathToFileURL(pageFile).href, { waitUntil: 'load', timeout: 20000 });
  await page.evaluate(({ src, th }) => globalThis.__whimControl.reinject({
    reset: true, bundle: 'motion-check', bundleSource: src, generation: 2, theme: th,
  }), { src: APP, th: theme });
  const realm = () => page.frames().find((f) => f !== page.mainFrame());
  await until(async () => (await realm()?.evaluate(() => document.body.textContent.includes('Press me')).catch(() => false)) === true);
  const probed = await until(() => page.evaluate(() => window.__relayed.some((f) => f.kind === 'probes')));
  if (!probed) throw new Error('the realm never reported its containment probes');
  // The probes' own CSP reports are queued as tasks after their verdict: let them land first.
  await sleep(300);
  await realm().evaluate(installProbe);
  return { page, realm: realm(), errors };
}

async function settle(realm) {
  await until(() => realm.evaluate(() => window.__probe.idle()), 3000);
  await sleep(50);
}

/** The off tracks hold 3:1 against surface (task 6.0) */
async function offTracks({ tag, realm, theme }) {
  // ── The off tracks hold 3:1 against surface (task 6.0) ──────────────────────
  const tracks = await realm.evaluate((platform) => {
    const surface = getComputedStyle(document.querySelector('[role="switch"]').closest('div[style*="border-radius: 20px"]')).backgroundColor;
    const track = document.querySelector('[role="switch"]').lastElementChild;
    const style = getComputedStyle(track);
    const switchEdge = platform === 'android' ? style.borderTopColor : style.backgroundColor;
    const slider = getComputedStyle(document.querySelector('[role="slider"]').firstElementChild).backgroundColor;
    return { surface, switchEdge, slider };
  }, theme.platform);
  const switchRatio = contrast(tracks.switchEdge, tracks.surface);
  const sliderRatio = contrast(tracks.slider, tracks.surface);
  check(`${tag} the off Switch track holds 3:1 on surface (${switchRatio.toFixed(2)})`, switchRatio >= 3, JSON.stringify(tracks));
  check(`${tag} the empty Slider track holds 3:1 on surface (${sliderRatio.toFixed(2)})`, sliderRatio >= 3, JSON.stringify(tracks));
}

/** M1 press */
async function pressMoment({ tag, reduced, realm, pair }) {
  // ── M1 press ────────────────────────────────────────────────────────────────
  const press = await realm.evaluate(() => window.__probe.started(() => {
    const b = window.__probe.find.button('Press me');
    const r = b.getBoundingClientRect();
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + 5, clientY: r.top + 5, pointerId: 7 }));
  }));
  pair('press', press, { fade: true });
  check(`${tag} press: ${reduced ? 'dims to 0.7' : 'scales'}`, press.some((a) => a.props.includes(reduced ? 'opacity' : 'transform')), JSON.stringify(press));
  await realm.evaluate(() => window.__probe.find.button('Press me').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 })));
  await settle(realm);
}

/** M15 selection: checkbox stroke, stepper digits (WAAPI); colour fades stay */
async function selection({ tag, reduced, realm, pair }) {
  // ── M15 selection: checkbox stroke, stepper digits (WAAPI); colour fades stay ─
  const checkbox = await realm.evaluate(() => window.__probe.started(() => window.__probe.find.role('checkbox').click()));
  pair('checkbox', checkbox, { fade: true });
  if (!reduced) check(`${tag} checkbox: the check's stroke draws`, checkbox.some((a) => a.props.some((p) => /dashoffset/i.test(p))), JSON.stringify(checkbox));
  await settle(realm);
  const stepper = await realm.evaluate(() => window.__probe.started(() => window.__probe.find.label('Increase').click()));
  pair('stepper digits', stepper);
  await settle(realm);
}

/** M15 selection on the rAF spring: the element is drawn off its place, then springs */
async function springs({ tag, reduced, page, realm }) {
  // ── M15 selection on the rAF spring: the element is drawn off its place, then springs ─
  const drifts = {};
  drifts.switch = await realm.evaluate(() => window.__probe.drift(
    () => window.__probe.find.role('switch').click(),
    () => window.__probe.find.role('switch').lastElementChild.firstElementChild,
  ));
  drifts.segment = await realm.evaluate(() => window.__probe.drift(
    () => window.__probe.find.role('radio', 'Fast').click(),
    () => window.__probe.find.role('radiogroup').children[1],
  ));
  const box = await realm.locator('[role="slider"]').boundingBox();
  await realm.evaluate(() => window.__probe.mark());
  await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
  await page.mouse.down();
  drifts.slider = await realm.evaluate(() => window.__probe.drift(() => undefined, () => document.querySelector('[role="slider"]').firstElementChild.lastElementChild));
  await page.mouse.up();
  for (const [name, translate] of Object.entries(drifts)) {
    const off = translate !== 'none' && translate !== '' && Number.parseFloat(translate) !== 0;
    check(`${tag} ${name}: ${reduced ? 'is at its place at once' : 'springs from where it was'} (translate ${translate})`, reduced ? !off : off, translate);
  }
  await sleep(600);
  await settle(realm);
}

/** M24 progress */
async function progressMoment({ realm, pair }) {
  // ── M24 progress ────────────────────────────────────────────────────────────
  const progress = await realm.evaluate(() => window.__probe.started(() => window.__probe.find.button('Progress').click()));
  pair('progress', progress);
  await settle(realm);
}

/** M24 keyed list: enter, leave, gap; an index-keyed list stays still */
async function keyedList({ tag, reduced, page, realm, pair }) {
  // ── M24 keyed list: enter, leave, gap; an index-keyed list stays still ───────
  const add = await realm.evaluate(() => window.__probe.started(() => window.__probe.find.button('Add').click()));
  pair('list enter', add, { fade: true });
  check(`${tag} list enter: only the new row`, add.length > 0 && add.every((a) => a.text.includes('Delta')), JSON.stringify(add));
  await settle(realm);
  await realm.evaluate(() => window.__probe.mark());
  const leave = await realm.evaluate(() => window.__probe.started(() => window.__probe.find.button('Remove B').click()));
  check(`${tag} list leave: only the removed row fades out`, leave.length > 0 && leave.every((a) => a.text.includes('Beta') && a.props.includes('opacity') && !a.moving), JSON.stringify(leave));
  await until(() => realm.evaluate(() => !window.__probe.find.text('Beta')), 2000);
  const gap = (await realm.evaluate(() => window.__probe.sinceMark())).filter((a) => !a.text.includes('Beta') && !a.props.includes('transitionProperty'));
  const gapMoves = gap.filter((a) => a.props.includes('translate'));
  if (reduced) check(`${tag} list gap: closes at once`, gapMoves.length === 0, JSON.stringify(gap));
  else check(`${tag} list gap: the rows below close it, from where they were`, gapMoves.length > 0 && gapMoves.every((a) => /Gamma|Delta/.test(a.text)), JSON.stringify(gap));
  check(`${tag} list leave: the row is gone afterwards`, !(await realm.evaluate(() => window.__probe.find.text('Beta'))), 'Beta still on the page');
  await settle(realm);
  const plain = await realm.evaluate(() => window.__probe.started(() => window.__probe.find.button('Add plain').click()));
  check(`${tag} index-keyed list: no motion at all`, plain.every((a) => !a.inOffList), JSON.stringify(plain));
  await settle(realm);
}

/** M14 toast */
async function toastMoment({ realm, pair }) {
  // ── M14 toast ───────────────────────────────────────────────────────────────
  const toast = await realm.evaluate(() => window.__probe.started(() => window.__probe.find.button('Toast').click()));
  pair('toast', toast, { fade: true });
  await settle(realm);
}

/** M11 sheet: present and dismiss */
async function sheet({ tag, realm, pair }) {
  // ── M11 sheet: present and dismiss ──────────────────────────────────────────
  const present = await realm.evaluate(() => window.__probe.started(() => window.__probe.find.button('Open sheet').click()));
  pair('sheet present', present, { fade: true });
  await settle(realm);
  const dismiss = await realm.evaluate(() => window.__probe.started(() => window.__probe.find.label('Close').click()));
  pair('sheet dismiss', dismiss, { fade: true });
  check(`${tag} sheet dismiss: drawn until it is gone`, await realm.evaluate(() => Boolean(document.querySelector('[role="dialog"]'))), 'unmounted at once');
  await until(() => realm.evaluate(() => !document.querySelector('[role="dialog"]')), 2000);
  check(`${tag} sheet dismiss: then gone`, await realm.evaluate(() => !document.querySelector('[role="dialog"]')), 'still mounted');
}

/** M11 sheet drag: 1:1 after the slop, back when it won't reach, away on a fling */
async function sheetDrag({ tag, page, realm }) {
  // ── M11 sheet drag: 1:1 after the slop, back when it won't reach, away on a fling ─
  await realm.evaluate(() => window.__probe.find.button('Open sheet').click());
  await settle(realm);
  const grab = await realm.locator('[role="dialog"] h2').boundingBox();
  const sheetY = () => realm.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('[role="dialog"]')).transform).m42);
  await page.mouse.move(grab.x + 10, grab.y + 5);
  await page.mouse.down();
  await page.mouse.move(grab.x + 10, grab.y + 45, { steps: 8 });
  const held = await sheetY();
  check(`${tag} sheet drag: follows the finger 1:1 after the slop (${held.toFixed(1)} px for 40)`, Math.abs(held - 30) < 2, String(held));
  await sleep(250);
  await page.mouse.up();
  await sleep(700);
  check(`${tag} sheet drag: a slow short drag puts it back`, await realm.evaluate(() => Boolean(document.querySelector('[role="dialog"]'))) && Math.abs(await sheetY()) < 0.5, String(await sheetY()));
  await page.mouse.move(grab.x + 10, grab.y + 5);
  await page.mouse.down();
  for (let i = 1; i <= 4; i++) await page.mouse.move(grab.x + 10, grab.y + 5 + i * 20);
  await page.mouse.up();
  await until(() => realm.evaluate(() => !document.querySelector('[role="dialog"]')), 2000);
  check(`${tag} sheet drag: a fling dismisses it through onClose`, await realm.evaluate(() => !document.querySelector('[role="dialog"]')), 'still open');
}

/** M24 push and pop */
async function pushPop({ tag, realm, pair }) {
  // ── M24 push and pop ────────────────────────────────────────────────────────
  const push = await realm.evaluate(() => window.__probe.started(() => window.__probe.find.button('Push').click()));
  pair('push', push, { fade: true });
  check(`${tag} push: both screens are drawn while it moves`, await realm.evaluate(() => window.__probe.find.text('Pushed') && window.__probe.find.text('Press me')), 'one screen only');
  await until(() => realm.evaluate(() => !window.__probe.find.text('Press me')), 2000);
  check(`${tag} push: the covered screen goes when it ends`, !(await realm.evaluate(() => window.__probe.find.text('Press me'))), 'still mounted');
  const pop = await realm.evaluate(() => window.__probe.started(() => window.__probe.find.label('Back').click()));
  pair('pop', pop, { fade: true });
  await until(() => realm.evaluate(() => !window.__probe.find.text('Pushed')), 2000);
  check(`${tag} pop: back on the first screen`, await realm.evaluate(() => window.__probe.find.text('Press me') && !window.__probe.find.text('Pushed')), 'wrong screen');
}

/** One theme: every moment, and the facts about this realm. */
async function runTheme(browser, theme) {
  const tag = `${theme.platform}/${theme.scheme}/${theme.reduceMotion ? 'reduced' : 'full'}`;
  const reduced = theme.reduceMotion;
  const { page, realm, errors } = await openRealm(browser, theme);
  const before = await realm.evaluate(() => ({ sheets: window.__probe.sheets(), scripts: window.__probe.scripts() }));
  const easings = [];
  const pair = (name, anims, { fade = false } = {}) => {
    easings.push(...anims.map((a) => a.easing));
    const moving = anims.filter((a) => a.moving);
    if (!reduced) {
      check(`${tag} ${name}: moves`, moving.length > 0, JSON.stringify(anims));
      return;
    }
    const fades = anims.filter((a) => a.props.includes('opacity') || a.props.some((p) => /color/i.test(p)));
    check(`${tag} ${name}: no motion under Reduce Motion${fade ? ', a fade instead' : ''}`, moving.length === 0 && (!fade || fades.length > 0), JSON.stringify(anims));
  };
  const c = { tag, reduced, page, realm, pair, theme };
  await offTracks(c);
  await pressMoment(c);
  await selection(c);
  await springs(c);
  await progressMoment(c);
  await keyedList(c);
  await toastMoment(c);
  await sheet(c);
  await sheetDrag(c);
  await pushPop(c);

  // ── Nothing beyond the sandbox's own surface ────────────────────────────────
  const after = await realm.evaluate(() => ({ sheets: window.__probe.sheets(), scripts: window.__probe.scripts(), violations: window.__probe.violations }));
  check(`${tag} no CSP violation, style sheet or script added`, after.violations.length === 0 && after.sheets === before.sheets && after.scripts === before.scripts, JSON.stringify({ before, after }));
  check(`${tag} no page error`, errors.length === 0, errors.join('; '));
  if (!reduced) {
    check(`${tag} springs play as sampled linear() curves`, easings.some((e) => e.startsWith('linear(')), easings.join(' | '));
  }
  await page.close();
}

const browser = await chromium.launch();
try {
  for (const theme of [
    { platform: 'ios', scheme: 'light', reduceMotion: false },
    { platform: 'ios', scheme: 'dark', reduceMotion: true },
    { platform: 'android', scheme: 'dark', reduceMotion: false },
    { platform: 'android', scheme: 'light', reduceMotion: true },
  ]) {
    await runTheme(browser, { ...theme, tint: 'purple', fontScale: 1, increaseContrast: false });
  }
} finally {
  await browser.close();
  await rm(dir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\n❌ SDK motion: ${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\n✅ SDK motion: every moment moves with full motion and only fades under Reduce Motion, inside the unchanged sandbox.');
