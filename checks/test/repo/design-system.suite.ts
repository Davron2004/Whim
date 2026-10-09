/**
 * The design system's static checks (design-system-v1 D1, docs/design/system.md §2). One token module,
 * `src/design/tokens.ts`, holds every design value, so this suite holds the rest of the repo to it:
 *
 *  - every generated output (system.md tables, the mockup's token block, palette.json, the sampled
 *    springs, the runtime page's background) matches the module — `npm run tokens -- --check`;
 *  - every contrast floor §2 specifies holds in both schemes, and every tint keeps its §2.4 floors
 *    and its distance from the reserved hues;
 *  - no colour hex literal or spring config lives in `src/host/**` or `src/sdk/**` outside the
 *    module, apart from the exemptions listed below.
 *
 * Later design checks are added here, never as new registrations in `checks/test/acceptance.ts`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, assert } from '../harness';
import * as tokens from '../../../src/design/tokens';
import { SAMPLED_SPRINGS } from '../../../src/design/generated/springs';
import { contrastRatio, deltaE } from '../../../src/design/tints';
import { checkOutputs, formatDrift, reservedColors, tileRim, tintSoft, SYSTEM_MD, MOCKUP_HTML, PALETTE_JSON } from '../../../scripts/lib/design-tokens';

const ROOT = process.cwd();

type Colors = Readonly<Record<tokens.Scheme, Readonly<Record<tokens.ColorRole, string>>>>;
type Tints = Readonly<Record<tokens.TintName, tokens.Pair>>;

const readRepo = (file: string): string | undefined => {
  const p = path.join(ROOT, file);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : undefined;
};

/** The repo as it is, except `file`, whose text goes through `edit`. */
const readEdited = (file: string, edit: (text: string) => string) => (f: string) => {
  const text = readRepo(f);
  return f === file && text !== undefined ? edit(text) : text;
};

// ── Contrast ─────────────────────────────────────────────────────────────────

/** One finding per specified pair below its floor, in either scheme. */
function contrastFindings(colors: Colors, rules: readonly tokens.ContrastRule[]): string[] {
  const findings: string[] = [];
  for (const scheme of tokens.SCHEMES) {
    for (const rule of rules) {
      for (const on of rule.on) {
        const ratio = contrastRatio(colors[scheme][rule.fg], colors[scheme][on]);
        if (ratio < rule.floor) findings.push(`${scheme}: ${rule.fg} on ${on} is ${ratio.toFixed(2)}:1, under ${rule.floor}:1`);
      }
    }
  }
  return findings;
}

/** One finding per tint below a §2.4 contrast floor. */
function tintContrastFindings(tints: Tints, colors: Colors): string[] {
  const floors = tokens.TINT_CONTRAST_FLOORS;
  const findings: string[] = [];
  const need = (name: string, what: string, ratio: number, floor: number) => {
    if (ratio < floor) findings.push(`${name}: ${what} is ${ratio.toFixed(2)}:1, under ${floor}:1`);
  };
  for (const [name, t] of Object.entries(tints)) {
    need(name, 'the on-tint label on the light value', contrastRatio(tokens.ON_TINT.light, t.light), floors.onTint);
    need(name, 'the on-tint label on the dark value', contrastRatio(tokens.ON_TINT.dark, t.dark), floors.onTint);
    need(name, 'the light value on light fill', contrastRatio(t.light, colors.light.fill), floors.text);
    need(name, 'the dark value on dark fill', contrastRatio(t.dark, colors.dark.fill), floors.text);
    need(name, 'the light value on its soft tint', contrastRatio(t.light, tintSoft('light', t.light)), floors.text);
    need(name, 'the dark value on its soft tint', contrastRatio(t.dark, tintSoft('dark', t.dark)), floors.text);
    need(name, 'the dark rim on dark bg', contrastRatio(tileRim(t), colors.dark.bg), floors.rim);
  }
  return findings;
}

/** One finding per tint nearer a reserved colour, or another tint, than the §2.4 floors allow
 *  (CIEDE2000, normal vision; the palette proof covers colour-vision deficiency). */
function separationFindings(tints: Tints): string[] {
  const floors = tokens.TINT_SEPARATION_FLOORS;
  const entries = Object.entries(tints);
  const fromReserved = entries.flatMap(([name, t]) =>
    tokens.SCHEMES.flatMap((scheme) =>
      Object.entries(reservedColors(scheme))
        .map(([reserved, value]): [string, number] => [reserved, deltaE(t[scheme], value)])
        .filter(([, d]) => d < floors.reserved)
        .map(([reserved, d]) => `${name} (${scheme}) is ${d.toFixed(1)} from ${reserved}, under ${floors.reserved}`),
    ),
  );
  const fromTints = entries.flatMap(([a, ta], i) =>
    entries
      .slice(i + 1)
      .map(([b, tb]): [string, number] => [b, Math.min(deltaE(ta.light, tb.light), deltaE(ta.dark, tb.dark))])
      .filter(([, d]) => d < floors.tint)
      .map(([b, d]) => `${a} and ${b} are ${d.toFixed(1)} apart, under ${floors.tint}`),
  );
  return [...fromReserved, ...fromTints];
}

/** `colors` with one role of one scheme replaced. */
function withColor(scheme: tokens.Scheme, role: tokens.ColorRole, value: string): Colors {
  return { ...tokens.COLORS, [scheme]: { ...tokens.COLORS[scheme], [role]: value } };
}

// ── No second source ─────────────────────────────────────────────────────────

/** Files that still carry colour values of their own, each with the reason. Remove an entry when
 *  its file stops needing it; an entry whose file no longer has a hit fails the suite. */
const EXEMPT: Readonly<Record<string, string>> = {
  'src/sdk/design-tokens.ts': 'the v2 shell tokens, read by the screens that have not moved to src/design/tokens.ts yet',
  'src/host/launcher/theme.ts': "the v2 shell palette's white `onAccent`, pinned until the shell moves to the token module",
  'src/host/launcher/app-tile.tsx': 'the v2 tile glyph white, until tiles draw from the tints',
  'src/host/launcher/tile-pill-view.tsx': 'the v2 alert pill label white, until tiles draw from the tints',
  'src/host/launcher/Orb.tsx': "the v2 orb's shadow colour, until the orb moves to the token shadows",
  'src/host/launcher/orb-actions.ts': "the v2 orb menu's swatch fills, until the orb moves to the tokens",
  'src/host/BridgeProbeScreen.tsx': 'a flag-gated on-device acceptance probe (RUN_BRIDGE_PROBE), off in the product',
  'src/host/StorageProbeScreen.tsx': 'a flag-gated on-device acceptance probe (RUN_STORAGE_PROBE), off in the product',
  'src/host/VersionStoreProbeScreen.tsx': 'a flag-gated on-device acceptance probe (RUN_VSTORE_PROBE), off in the product',
  'src/host/NetworkDenyProbeScreen.tsx': 'a flag-gated on-device acceptance probe (RUN_NETDENY_PROBE), off in the product',
  'src/host/launcher/DevProbeScreen.tsx': 'the __DEV__ diagnostics screen, not part of the product UI',
};

const HEX_LITERAL = /(['"`])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-z])/i;
const SPRING_CONFIG = /\b(?:stiffness|damping|dampingRatio|mass|tension|friction|bounciness)\s*:\s*-?\.?\d/;

/** `text` with its comments blanked, line structure kept. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, '')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

/** Each line of `source` holding a colour hex literal or a spring config, as `line: kind`. */
function secondSourceHits(source: string): string[] {
  const hits: string[] = [];
  withoutComments(source)
    .split('\n')
    .forEach((line, i) => {
      if (HEX_LITERAL.test(line)) hits.push(`${i + 1}: hex colour`);
      if (SPRING_CONFIG.test(line)) hits.push(`${i + 1}: spring config`);
    });
  return hits;
}

/** Every product `.ts`/`.tsx` file under `dir` (test folders hold forged colours on purpose). */
function productFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'test') out.push(...productFiles(rel));
    } else if (/\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

/** The specifiers `source` imports or re-exports from. */
function importSpecifiers(source: string): string[] {
  return [...withoutComments(source).matchAll(/\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

/** Every `.ts` file under `dir`, repo-relative. */
function tsFiles(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) return tsFiles(rel);
    return e.name.endsWith('.ts') ? [rel] : [];
  });
}

const parseNumbers = (css: string, fn: string) => (new RegExp(`^${fn}\\((.*)\\)$`).exec(css)?.[1] ?? '').split(',').map(Number);

export async function run(): Promise<void> {
  await test('design tokens: the token module is pure data, and src/design imports nothing from outside it', () => {
    const functions = Object.entries(tokens).filter(([, value]) => typeof value === 'function').map(([name]) => name);
    assert(functions.length === 0, `src/design/tokens.ts exports functions, not data: ${functions.join(', ')}`);
    const outside = tsFiles('src/design').flatMap((file) =>
      importSpecifiers(fs.readFileSync(path.join(ROOT, file), 'utf8'))
        .filter((spec) => !spec.startsWith('.') || !path.posix.join(path.posix.dirname(file), spec).startsWith('src/design/'))
        .map((spec) => `${file} imports ${spec}`),
    );
    assert(outside.length === 0, `src/design must stay free of React Native, DOM and app imports: ${outside.join(', ')}`);
    assert(importSpecifiers("import { View } from 'react-native';\nexport { x } from './tokens';").join() === 'react-native,./tokens', 'the import scan sees imports and re-exports');
  });

  await test('design tokens: each sampled spring is an easing from 0 to 1 at 60 Hz that overshoots only if the spring does', () => {
    for (const [name, spring] of Object.entries(tokens.SPRINGS) as [tokens.SpringName, tokens.Spring][]) {
      const sampled = SAMPLED_SPRINGS[name];
      const points = parseNumbers(sampled.linear, 'linear');
      assert(points[0] === 0 && points[points.length - 1] === 1, `${name}: linear() runs from 0 to 1 (${sampled.linear.slice(0, 40)}…)`);
      assert(points.length === Math.round((sampled.durationMs * 60) / 1000) + 1, `${name}: one point per 60 Hz frame over ${sampled.durationMs} ms (got ${points.length})`);
      const peak = Math.max(...points) - 1;
      if (spring.dampingRatio >= 1) {
        assert(points.every((p, i) => i === 0 || p >= points[i - 1]), `${name}: a critically damped spring's curve never turns back`);
        assert(peak <= 0, `${name}: a critically damped spring never passes its target`);
      } else {
        assert(Math.abs(peak - sampled.overshoot) <= 0.002, `${name}: the curve's peak ${peak.toFixed(3)} is the spring's overshoot ${sampled.overshoot}`);
      }
      const [x1, , x2] = parseNumbers(sampled.cubicBezier, 'cubic-bezier');
      assert(x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1, `${name}: ${sampled.cubicBezier} is a valid CSS cubic-bezier`);
      assert(sampled.t95Ms > 0 && sampled.t95Ms < sampled.durationMs, `${name}: it reaches 95% (${sampled.t95Ms} ms) before it settles (${sampled.durationMs} ms)`);
    }
  });

  await test('design tokens: every generated output matches src/design/tokens.ts', () => {
    const drifts = checkOutputs(readRepo);
    assert(drifts.length === 0, drifts.map(formatDrift).join('; '));
  });

  await test('design tokens: `npm run tokens -- --check` passes on the repo', () => {
    const r = spawnSync(process.execPath, ['scripts/design-tokens.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
    assert(r.status === 0, `exit ${r.status}: ${r.stderr}`);
  });

  await test('design tokens: a hand-edited table value fails, naming the table, the row and both values', () => {
    const drifts = checkOutputs(readEdited(SYSTEM_MD, (t) => t.replace('| `text-2` | `#6D6660` |', '| `text-2` | `#6D6661` |')));
    const message = drifts.map(formatDrift).join('; ');
    assert(drifts.length === 1, `one drift expected, got: ${message}`);
    assert(/\[roles\].*`text-2`.*"Light".*#6D6661.*#6D6660/.test(message), `the drift names table, row, column and both values: ${message}`);
  });

  await test('design tokens: an edited mockup token, palette input or missing marker fails', () => {
    const mockup = checkOutputs(readEdited(MOCKUP_HTML, (t) => t.replace("['slate', '#535E6F', '#B0B8C5']", "['slate', '#535E6F', '#B0B8C6']")));
    assert(mockup.some((d) => d.file === MOCKUP_HTML && d.region === 'mockup' && d.message.includes('#B0B8C6')), `mockup drift: ${mockup.map(formatDrift).join('; ')}`);
    const palette = checkOutputs(readEdited(PALETTE_JSON, (t) => t.replace('"#0852CB"', '"#0852CC"')));
    assert(palette.some((d) => d.file === PALETTE_JSON && d.message.includes('#0852CC')), `palette drift: ${palette.map(formatDrift).join('; ')}`);
    const unmarked = checkOutputs(readEdited(SYSTEM_MD, (t) => t.replace('<!-- tokens:end springs -->', '')));
    assert(unmarked.some((d) => d.region === 'springs' && /markers/.test(d.message)), `missing marker: ${unmarked.map(formatDrift).join('; ')}`);
  });

  await test('design tokens: every contrast floor of §2 holds in both schemes', () => {
    const findings = contrastFindings(tokens.COLORS, tokens.CONTRAST_RULES);
    assert(findings.length === 0, findings.join('; '));
  });

  await test('design tokens: text-2 lowered below 4.5:1 on fill fails the contrast check', () => {
    const findings = contrastFindings(withColor('light', 'text-2', '#8A847E'), tokens.CONTRAST_RULES);
    assert(findings.some((f) => f.startsWith('light: text-2 on fill')), `expected a text-2 on fill finding: ${findings.join('; ')}`);
    const dark = contrastFindings(withColor('dark', 'border', '#3C3936'), tokens.CONTRAST_RULES);
    assert(dark.some((f) => f.startsWith('dark: border on surface')), `expected a dark border finding: ${dark.join('; ')}`);
  });

  await test('design tokens: every tint keeps its §2.4 contrast floors and its distance from status and ember', () => {
    const findings = [...tintContrastFindings(tokens.TINTS, tokens.COLORS), ...separationFindings(tokens.TINTS)];
    assert(findings.length === 0, findings.join('; '));
  });

  await test('design tokens: a pale tint, or one beside danger, fails the tint checks', () => {
    const pale = { ...tokens.TINTS, slate: { light: '#9DA8B8', dark: tokens.TINTS.slate.dark } };
    const contrast = tintContrastFindings(pale, tokens.COLORS);
    assert(contrast.some((f) => f.startsWith('slate: the on-tint label on the light value')), `pale tint: ${contrast.join('; ')}`);
    const red = { ...tokens.TINTS, rose: { light: '#B8303A', dark: tokens.TINTS.rose.dark } };
    const separation = separationFindings(red);
    assert(separation.some((f) => /^rose \(light\) is .* from danger/.test(f)), `tint beside danger: ${separation.join('; ')}`);
  });

  await test('no second source: the scan sees live hex colours and spring configs, not comments', () => {
    assert(secondSourceHits("const accent = '#0852CB';").length === 1, 'a hex colour literal is a hit');
    assert(secondSourceHits('const c = `#fff`;').length === 1, 'a short hex in a template is a hit');
    assert(secondSourceHits("withSpring(x, { stiffness: 300, damping: 20 });").length === 1, 'an inline spring config is a hit');
    assert(secondSourceHits("// '#0852CB' was the old blue\n/* damping: 20 */").length === 0, 'comments are not hits');
    assert(secondSourceHits("const issue = 'see #123 in the tracker';").length === 0, 'an issue number is not a colour');
    assert(secondSourceHits("const url = 'https://x.dev/#abcdef';").length === 0, 'a URL fragment is not a colour');
  });

  await test('no second source: no hex colour or spring config in src/host or src/sdk outside the token module', () => {
    const hits: string[] = [];
    const stale: string[] = [];
    for (const file of [...productFiles('src/host'), ...productFiles('src/sdk')]) {
      const found = secondSourceHits(fs.readFileSync(path.join(ROOT, file), 'utf8'));
      if (file in EXEMPT) {
        if (found.length === 0) stale.push(file);
      } else {
        hits.push(...found.map((h) => `${file}:${h}`));
      }
    }
    assert(hits.length === 0, `move these values into src/design/tokens.ts: ${hits.join(', ')}`);
    assert(stale.length === 0, `these exemptions no longer hold a value; remove them from EXEMPT: ${stale.join(', ')}`);
  });
}
