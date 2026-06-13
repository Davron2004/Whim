// ─────────────────────────────────────────────────────────────────────────────
// effects-and-cues task 4.3 — desktop-Chromium fast filter for the SDK timer spec.
// ─────────────────────────────────────────────────────────────────────────────
// NOT the never-regress suite (that is runtime-owner authored — INV-TIMER, §16.4): this is the
// fast pre-on-device filter for test-spec.md §2 (E1–E4). It injects the REAL built SDK
// (parts.reactInject → resolver → parts.sdkInject from this build's runtime-artifacts.json) into
// a headless page, mounts a component that drives `interval`/`delay`, and observes:
//   E1 a 1s-style interval ticks (here 25ms for speed) — and ZERO syscall frames result;
//   E2 `await delay(ms)` resolves after ≥ ms;
//   E3 unmount cancels the interval by construction (no author cleanup);
//   E4 `running:false` pauses; flipping back resumes (no teardown).
// Run AFTER `npm run build`:  node openspec/changes/effects-and-cues/effects-desktop-check.mjs
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const artifacts = JSON.parse(await readFile(join(ROOT, 'src/runtime/generated/runtime-artifacts.json'), 'utf8'));
const { reactInject, resolver, sdkInject } = artifacts.parts;

const page = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div id="root"></div>
<script>${reactInject}</script>
<script>${resolver}</script>
<script>${sdkInject}</script>
</body></html>`;

const HARNESS = `async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const React = window.React, ReactDOM = window.ReactDOM, SDK = window.__WHIM_VC_SDK__;
  const out = { sdkHasDelay: typeof SDK.delay === 'function', sdkHasInterval: typeof SDK.interval === 'function' };

  // Spy the transport BEFORE any render: timer use must never touch it (E1 "zero syscall frames").
  let syscallCalls = 0;
  window.__whimSyscall = { call: () => { syscallCalls++; return Promise.resolve({}); } };
  let postedSyscallFrames = 0;
  try {
    const realPost = window.parent.postMessage.bind(window.parent);
    window.parent.postMessage = (s) => { try { const m = JSON.parse(s); if (m && m.whim === 'syscall') postedSyscallFrames++; } catch (e) {} return realPost(s); };
  } catch (e) {}

  let ticks = 0;
  function Counter(props) {
    const [n, setN] = SDK.useState(0);
    SDK.interval(() => { ticks++; setN((x) => x + 1); }, 25, { running: props.running });
    return React.createElement('div', null, String(n));
  }
  const host = document.getElementById('root');
  const root = ReactDOM.createRoot(host);

  // E1 — running interval ticks.
  root.render(React.createElement(Counter, { running: true }));
  await sleep(200);
  out.E1_ticksWhileRunning = ticks;

  // E4 — pause (running:false) stops ticks without unmounting…
  const atPause = ticks;
  root.render(React.createElement(Counter, { running: false }));
  await sleep(150);
  out.E4_pausedDelta = ticks - atPause;
  // …and resume picks back up (hook not torn down).
  const atResume = ticks;
  root.render(React.createElement(Counter, { running: true }));
  await sleep(150);
  out.E4_resumedDelta = ticks - atResume;

  // E3 — unmount cancels by construction.
  const atUnmount = ticks;
  root.unmount();
  await sleep(150);
  out.E3_afterUnmountDelta = ticks - atUnmount;

  // E2 — delay sequences.
  const t0 = performance.now();
  await SDK.delay(120);
  out.E2_delayMs = Math.round(performance.now() - t0);

  out.syscallCalls = syscallCalls;
  out.postedSyscallFrames = postedSyscallFrames;
  return out;
}`;

const browser = await chromium.launch();
try {
  const pg = await browser.newPage();
  const errors = [];
  pg.on('pageerror', (e) => errors.push(String(e)));
  await pg.setContent(page, { waitUntil: 'load' });
  const r = await pg.evaluate(`(${HARNESS})()`);

  const checks = [
    ['SDK exports delay + interval', r.sdkHasDelay && r.sdkHasInterval],
    ['E1 a running interval ticks (>=5 in 200ms)', r.E1_ticksWhileRunning >= 5],
    ['E1 zero syscall frames from timer use', r.syscallCalls === 0 && r.postedSyscallFrames === 0],
    ['E2 delay(120) resolves after >=110ms', r.E2_delayMs >= 110],
    ['E3 unmount cancels: no ticks after unmount', r.E3_afterUnmountDelta === 0],
    ['E4 paused interval does not tick', r.E4_pausedDelta === 0],
    ['E4 resume after pause ticks again', r.E4_resumedDelta >= 3],
    ['no page errors', errors.length === 0],
  ];
  let failed = 0;
  for (const [name, pass] of checks) { console.log((pass ? '• ' : '✗ ') + name); if (!pass) failed++; }
  console.log('\nobserved:', JSON.stringify(r), errors.length ? '\nerrors: ' + errors.join(' | ') : '');
  if (failed) { console.error(`\n✗ effects desktop check: ${failed} FAILED`); process.exit(1); }
  console.log('\n✓ effects desktop check: all E1–E4 properties hold in headless Chromium');
} finally {
  await browser.close();
}
