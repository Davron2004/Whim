#!/usr/bin/env node
// MEASUREMENT-ONLY (design-system-v1 task 24.6): reads a haptics capture and prints per-moment
// counts, JS-call -> engine-call latency, rate-cap behaviour and anything outside system.md §5.
//
//   node scripts/scratch/hx-analyze.mjs <capture.log>
//
// Input lines (anywhere in a line; other console noise is ignored):
//   HXJ t=<epoch ms> ev=play|prepare moment=<moment>     JS: src/host/haptics.ts
//   HXJ t=<epoch ms> ev=cue|cap-drop kind=tap|double|heavy  JS: src/host/cue-backend.ts (host side of cues.haptic)
//   HXN t=<epoch ms, 3 decimals> ev=enter|engine|prepare api=... native: ios/Whim/WhimHapticsModule.mm
//   HXM t=<epoch ms> step=<id>                            written by hx-mark.sh when a tap-through step starts
// The JS line is emitted just before the native call it announces, and both ride one FIFO, so
// each JS play/cue pairs with the next native `engine` event of the matching shape.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// system.md §5 / SHELL_HAPTICS in src/host/haptics.ts: what a moment must reach the engine as.
const MOMENT_ENGINE = {
  selection: { api: 'selection' },
  'toggle-on': { api: 'impact', style: 'light' },
  'toggle-off': { api: 'impact', style: 'light' },
  'long-press': { api: 'impact', style: 'medium' },
  commit: { api: 'impact', style: 'rigid' },
  handoff: { api: 'impact', style: 'medium' },
  success: { api: 'notification', type: 'success' },
  failure: { api: 'notification', type: 'error' },
  warning: { api: 'notification', type: 'warning' },
};
const CUE_KINDS = new Set(['tap', 'double', 'heavy']);
// Host rate cap (src/host/cue-backend.ts): burst 3, 10 per second sustained.
const CAP_BURST = 3;
const CAP_PER_SECOND = 10;

// Expected moments per tap-through step (numbering of 24-6-guided-session.md). [] = no haptic.
// "tap*20" = twenty tap cues were sent (played + dropped); STEP_DROPS bounds how many the cap dropped.
const STEP_EXPECT = {
  1: [], 2: [], 3: [], 4: [],
  5: ['selection'], 6: ['selection'], 7: ['handoff'], 8: ['success'],
  9: ['tap'], 10: ['double'], 11: ['heavy'], 12: ['tap*20'], 13: ['tap*20'],
  14: [], 15: ['commit'], 16: ['commit'], 17: ['long-press'], 18: ['success'],
  19: ['toggle-off'], 20: ['toggle-on'], 21: ['warning'],
  22: ['selection'], 23: ['handoff'], 24: ['failure'],
};
const STEP_DROPS = { 12: { min: 14 }, 13: { max: 0 } };

function fields(line) {
  const out = {};
  for (const m of line.matchAll(/(\w+)=("[^"]*"|\S+)/g)) out[m[1]] = m[2].replace(/^"|"$/g, '');
  return out;
}

export function parse(text) {
  const events = [];
  let seq = 0;
  for (const raw of text.split('\n')) {
    const m = raw.match(/\b(HX[JNM])\s+(t=.*)$/);
    if (!m) continue;
    const f = fields(m[2]);
    const t = Number(f.t);
    if (!Number.isFinite(t)) continue;
    events.push({ ...f, src: m[1], t, seq: seq++ });
  }
  return events;
}

function matches(expect, ev) {
  if (ev.api !== expect.api) return false;
  if (expect.style && ev.style !== expect.style) return false;
  if (expect.type && ev.type !== expect.type) return false;
  return true;
}

function quantile(sorted, q) {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
  return sorted[Math.max(0, i)];
}

function stats(xs) {
  if (xs.length === 0) return 'n=0';
  const s = [...xs].sort((a, b) => a - b);
  const f = (v) => v.toFixed(1);
  return `n=${s.length} median=${f(quantile(s, 0.5))} ms  p95=${f(quantile(s, 0.95))} ms  max=${f(s[s.length - 1])} ms`;
}

export function analyze(events) {
  const js = events.filter((e) => e.src === 'HXJ');
  const nat = events.filter((e) => e.src === 'HXN');
  const marks = events.filter((e) => e.src === 'HXM');
  const engine = nat.filter((e) => e.ev === 'engine');
  const enter = nat.filter((e) => e.ev === 'enter');

  const issues = [];
  const used = new Set();
  const plays = []; // { kind: 'moment'|'cue', name, t (js), engineT, enterT, step }
  const unknownMoments = [];

  const nextEngine = (after, pred) => {
    for (const e of engine) {
      if (used.has(e.seq) || e.seq < after) continue;
      if (pred(e)) { used.add(e.seq); return e; }
    }
    return undefined;
  };
  const enterFor = (eng) => {
    let found;
    for (const e of enter) {
      if (e.seq < eng.seq && eng.t - e.t < 1000) found = e; else if (e.seq > eng.seq) break;
    }
    return found;
  };

  const cueDrops = [];
  for (const e of js) {
    if (e.ev === 'play') {
      const want = MOMENT_ENGINE[e.moment];
      if (!want) { unknownMoments.push(e); continue; }
      const eng = nextEngine(0, (x) => x.seq > e.seq && x.api !== 'cue');
      if (!eng) { issues.push(`moment ${e.moment} at t=${e.t} never reached the engine`); continue; }
      if (!matches(want, eng)) issues.push(`moment ${e.moment} reached the engine as ${eng.api} ${eng.style ?? eng.type ?? ''} (expected ${want.api} ${want.style ?? want.type ?? ''})`);
      plays.push({ kind: 'moment', name: e.moment, t: e.t, engineT: eng.t, enterT: enterFor(eng)?.t });
    } else if (e.ev === 'cue') {
      if (!CUE_KINDS.has(e.kind)) { issues.push(`cue with unknown kind ${e.kind} at t=${e.t}`); continue; }
      const eng = nextEngine(0, (x) => x.seq > e.seq && x.api === 'cue' && x.kind === e.kind && x.part === '1');
      if (!eng) { issues.push(`cue ${e.kind} at t=${e.t} was accepted by the host but never reached the engine`); continue; }
      plays.push({ kind: 'cue', name: e.kind, t: e.t, engineT: eng.t, enterT: enterFor(eng)?.t });
    } else if (e.ev === 'cap-drop') {
      cueDrops.push(e);
    }
  }
  // double's second tap and anything else the engine played that no JS line announced.
  const secondParts = engine.filter((e) => e.api === 'cue' && e.part === '2');
  const unpaired = engine.filter((e) => !used.has(e.seq) && !(e.api === 'cue' && e.part === '2'));

  // Per-moment counts.
  const counts = {};
  for (const p of plays) counts[`${p.kind}:${p.name}`] = (counts[`${p.kind}:${p.name}`] ?? 0) + 1;

  // Latency.
  const jsToEngine = plays.map((p) => p.engineT - p.t);
  const jsToEnter = plays.filter((p) => p.enterT !== undefined).map((p) => p.enterT - p.t);
  const enterToEngine = plays.filter((p) => p.enterT !== undefined).map((p) => p.engineT - p.enterT);
  const byName = {};
  for (const p of plays) (byName[`${p.kind}:${p.name}`] ??= []).push(p.engineT - p.t);

  // Rate cap: plays per sliding second must stay within burst + rate.
  const cuePlays = plays.filter((p) => p.kind === 'cue').map((p) => p.t).sort((a, b) => a - b);
  let maxPerSecond = 0;
  for (let i = 0; i < cuePlays.length; i++) {
    let n = 0;
    for (let j = i; j < cuePlays.length && cuePlays[j] - cuePlays[i] < 1000; j++) n++;
    maxPerSecond = Math.max(maxPerSecond, n);
  }
  const capLimit = CAP_BURST + CAP_PER_SECOND;
  if (maxPerSecond > capLimit) issues.push(`rate cap exceeded: ${maxPerSecond} cues in one second (limit ${capLimit} = burst ${CAP_BURST} + ${CAP_PER_SECOND}/s)`);
  // Clusters: accepted + dropped cues with gaps under 250 ms.
  const cueEvents = js.filter((e) => e.ev === 'cue' || e.ev === 'cap-drop').sort((a, b) => a.t - b.t);
  const clusters = [];
  for (const e of cueEvents) {
    const last = clusters[clusters.length - 1];
    if (last && e.t - last.end < 250) { last.end = e.t; last[e.ev === 'cue' ? 'played' : 'dropped']++; }
    else clusters.push({ start: e.t, end: e.t, played: e.ev === 'cue' ? 1 : 0, dropped: e.ev === 'cap-drop' ? 1 : 0 });
  }

  // Per-step attribution.
  const steps = [];
  const sortedMarks = [...marks].sort((a, b) => a.t - b.t);
  sortedMarks.forEach((mk, i) => {
    const end = sortedMarks[i + 1]?.t ?? Infinity;
    const inStep = js.filter((e) => e.t >= mk.t && e.t < end);
    const played = inStep.filter((e) => e.ev === 'play' || e.ev === 'cue').map((e) => e.moment ?? e.kind);
    for (const u of unpaired) if (u.t >= mk.t && u.t < end) played.push(`native-only:${u.api}${u.style ? '-' + u.style : u.type ? '-' + u.type : ''}`);
    const dropped = inStep.filter((e) => e.ev === 'cap-drop').length;
    const expect = STEP_EXPECT[mk.step];
    steps.push({ step: mk.step, played, dropped, expect });
  });

  return { counts, plays, jsToEngine, jsToEnter, enterToEngine, byName, cueDrops, maxPerSecond, clusters, unknownMoments, unpaired, secondParts, issues, steps, capLimit, prepares: js.filter((e) => e.ev === 'prepare').length };
}

function stepVerdict(s) {
  if (s.expect === undefined) return 'no expectation recorded';
  const got = s.played;
  const exp = s.expect;
  if (exp.length === 0) return got.length === 0 ? 'OK (silent)' : `UNEXPECTED haptic: ${got.join(', ')}`;
  const star = exp[0].match(/^(\w+)\*(\d+)$/);
  if (star) {
    const [, name, n] = star;
    const played = got.filter((g) => g === name).length;
    const bound = STEP_DROPS[s.step] ?? {};
    const dropsOk = (bound.min === undefined || s.dropped >= bound.min) && (bound.max === undefined || s.dropped <= bound.max);
    const countOk = played + s.dropped === Number(n);
    return `${played} played, ${s.dropped} dropped (sent ${played + s.dropped}, expected ${n}); ${countOk && dropsOk ? 'OK' : 'OFF' + (countOk ? '' : ' (count)') + (dropsOk ? '' : ` (drops should be ${bound.min !== undefined ? '>= ' + bound.min : '<= ' + bound.max})`)}`;
  }
  const ok = got.length === exp.length && exp.every((x, i) => got[i] === x);
  return ok ? `OK (${got.join(', ')})` : `MISMATCH: expected ${exp.join(', ')} got ${got.length ? got.join(', ') : 'nothing'}`;
}

function report(r) {
  const out = [];
  out.push('== Played haptics by moment / cue kind');
  const keys = Object.keys(r.counts).sort();
  if (keys.length === 0) out.push('  (none)');
  for (const k of keys) out.push(`  ${k.padEnd(22)} ${r.counts[k]}`);
  out.push(`  (prepare calls on touch-down: ${r.prepares}; second taps of "double": ${r.secondParts.length})`);
  out.push('');
  out.push('== Latency, JS call -> native engine call (wall clock, same device)');
  out.push(`  all           ${stats(r.jsToEngine)}`);
  out.push(`    JS -> module entry   ${stats(r.jsToEnter)}`);
  out.push(`    entry -> engine call ${stats(r.enterToEngine)}`);
  for (const k of Object.keys(r.byName).sort()) out.push(`  ${k.padEnd(22)} ${stats(r.byName[k])}`);
  out.push('  Note: the engine call is the last point software can see; the Taptic Engine fires after it. The');
  out.push('  touch itself has no timestamp in this log, so input -> JS handler is not included.');
  out.push('');
  out.push('== App cue rate cap (burst 3, 10 per second)');
  out.push(`  cap drops: ${r.cueDrops.length}; max cues played in any 1 s window: ${r.maxPerSecond} (limit ${r.capLimit})`);
  r.clusters.forEach((c, i) => out.push(`  cluster ${i + 1}: ${c.played} played, ${c.dropped} dropped over ${(c.end - c.start).toFixed(0)} ms`));
  out.push('');
  out.push('== Outside system.md section 5');
  if (r.unknownMoments.length === 0 && r.unpaired.length === 0) out.push('  none');
  for (const e of r.unknownMoments) out.push(`  JS played unknown moment "${e.moment}" at t=${e.t}`);
  for (const e of r.unpaired) out.push(`  native engine call with no matching JS moment/cue: ${e.api} ${e.style ?? e.type ?? e.kind ?? ''} at t=${e.t}`);
  out.push('');
  if (r.steps.length > 0) {
    out.push('== Per tap-through step (from hx-mark.sh markers)');
    for (const s of r.steps) out.push(`  step ${String(s.step).padEnd(3)} ${stepVerdict(s)}`);
    out.push('');
  }
  out.push('== Issues');
  if (r.issues.length === 0) out.push('  none');
  for (const i of r.issues) out.push(`  ${i}`);
  return out.join('\n');
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node scripts/scratch/hx-analyze.mjs <capture.log>');
    process.exit(2);
  }
  const events = parse(readFileSync(file, 'utf8'));
  if (events.length === 0) {
    console.log('No HXJ/HXN lines found in', file, '- the capture is empty or the build is not the instrumented one.');
    process.exit(1);
  }
  console.log(report(analyze(events)));
}
