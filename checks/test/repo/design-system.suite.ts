/**
 * The design system's static checks (design-system-v1 D1, docs/design/system.md §2). One token module,
 * `src/design/tokens.ts`, holds every design value, so this suite holds the rest of the repo to it:
 *
 *  - every generated output (system.md tables, the mockup's token block, palette.json, the sampled
 *    springs, the runtime page's background) matches the module — `npm run tokens -- --check`;
 *  - every contrast floor §2 specifies holds in both schemes, and every tint keeps its §2.4 floors
 *    and its distance from the reserved hues;
 *  - no colour hex literal or spring config lives in `src/host/**` or `src/sdk/**` outside the
 *    module, apart from the exemptions listed below;
 *  - every component `vc-sdk` exports appears in the style gallery (system.md §7.2);
 *  - the shell's copy uses one name per concept and its controls never speak in Whim's "I"
 *    (system.md §8), and no number in `src/host` is formatted in the phone's locale (#89).
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
import * as vcSdk from '../../../src/sdk/index';
import { checkOutputs, formatDrift, reservedColors, tileRim, tintSoft, SYSTEM_MD, MOCKUP_HTML, PALETTE_JSON } from '../../../scripts/lib/design-tokens';
import { COPY, COPY_KINDS, formatCount, reportCodeSizeLabel, timelineGrowthLine } from '../../../src/host/launcher/copy';

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

// ── Gallery coverage ─────────────────────────────────────────────────────────

const GALLERY = 'fixtures/style-gallery.app.tsx';

/** Exported components the gallery must NOT show, each with the reason. The gallery is the
 *  generator's worked example, so it never teaches a deprecated component. */
const GALLERY_EXEMPT: Readonly<Record<string, string>> = {
  Heading: 'deprecated alias of `Text size="title"`, kept for installed apps and gone from the reference',
};

/** The components a module exports: its PascalCase function values. */
function componentExports(module: Readonly<Record<string, unknown>>): string[] {
  return Object.entries(module)
    .filter(([name, value]) => /^[A-Z]/.test(name) && typeof value === 'function')
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b, 'en'));
}

/** The components `source` renders as JSX, outside comments. */
function renderedComponents(source: string): Set<string> {
  return new Set([...withoutComments(source).matchAll(/<([A-Z][A-Za-z0-9]*)[\s/>]/g)].map((m) => m[1]));
}

/** Each non-exempt component the gallery never renders. */
function galleryGaps(components: readonly string[], source: string): string[] {
  const rendered = renderedComponents(source);
  return components.filter((name) => !(name in GALLERY_EXEMPT) && !rendered.has(name));
}

// ── Copy ─────────────────────────────────────────────────────────────────────

type CopyKind = (typeof COPY_KINDS)[keyof typeof COPY_KINDS];

/** The retired words of system.md §8 and the requirement "Shell copy has one name per concept". */
const RETIRED_WORDS: readonly (readonly [string, RegExp])[] = [
  ['mini-app', /\bmini[- ]?apps?\b/i],
  ['build', /\bbuil(?:d|ds|ding|t)\b/i],
  ['generate', /\bgenerat\w*/i],
  ['fork', /\bfork\w*/i],
  ['snapshot', /\bsnapshots?\b/i],
  ['restore', /\brestor\w*/i],
  ['revert', /\brevert\w*/i],
  ['Prompt again', /\bprompt again\b/i],
];

/** Whim's first person: any "I" on a control, and on a person's control the maker's contractions. */
const FIRST_PERSON = /\bI\b/;
const MAKER_CONTRACTION = /\bI[’'](?:ll|m|ve|d)\b/;

/** Keys that keep a retired word, each with the reason. An entry whose string no longer carries one
 *  fails the lint. */
const RETIRED_WORD_EXEMPT: Readonly<Record<string, string>> = {
  consentLead: 'legal copy: its exact words are disclosed, quoted by the privacy page and versioned with consent',
  consentWhy: 'legal copy: its exact words are disclosed, quoted by the privacy page and versioned with consent',
  firstRunLead: 'legal copy: the first-run sheet states what the consent spec has it state, word for word',
};

/** One finding per key of `table` with no kind, a retired word, or Whim's "I" on a control. */
function copyFindings(table: Readonly<Record<string, string>>, kinds: Readonly<Record<string, CopyKind>>): string[] {
  const findings: string[] = [];
  for (const [key, text] of Object.entries(table)) {
    const kind = kinds[key] as CopyKind | undefined;
    if (kind === undefined) findings.push(`${key}: has no kind in COPY_KINDS`);
    const retired = RETIRED_WORDS.filter(([, word]) => word.test(text)).map(([name]) => name);
    if (key in RETIRED_WORD_EXEMPT) {
      if (retired.length === 0) findings.push(`${key}: no longer carries a retired word; remove it from RETIRED_WORD_EXEMPT`);
    } else {
      findings.push(...retired.map((name) => `${key}: retired word "${name}" in "${text}"`));
    }
    if (kind === 'control' && FIRST_PERSON.test(text)) findings.push(`${key}: Whim's "I" on a control: "${text}"`);
    if (kind === 'person' && MAKER_CONTRACTION.test(text)) findings.push(`${key}: Whim's "I" on a control: "${text}"`);
  }
  return findings;
}

/** A number written in the phone's locale: `toLocaleString()` or `Intl.NumberFormat` with no locale. */
const MACHINE_LOCALE_NUMBER = /\.toLocaleString\(\s*\)|\.toLocaleString\(\s*undefined\b|\bIntl\.NumberFormat\(\s*(?:\)|undefined\b)/;

/** Each line of `source` formatting a number in the phone's locale, as `line`. */
function machineLocaleNumbers(source: string): number[] {
  return withoutComments(source)
    .split('\n')
    .flatMap((line, i) => (MACHINE_LOCALE_NUMBER.test(line) ? [i + 1] : []));
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

  await test('gallery: every component vc-sdk exports appears in the style gallery, and no deprecated one', () => {
    const components = componentExports(vcSdk);
    assert(components.includes('Screen') && components.includes('Chart') && components.length > 20, `the export scan sees the SDK's components: ${components.join(', ')}`);
    const source = readRepo(GALLERY) ?? '';
    const gaps = galleryGaps(components, source);
    assert(gaps.length === 0, `${GALLERY} must show every vc-sdk component; missing: ${gaps.join(', ')}`);
    const rendered = renderedComponents(source);
    const exempt = Object.keys(GALLERY_EXEMPT);
    const stale = exempt.filter((name) => !components.includes(name));
    assert(stale.length === 0, `these gallery exemptions are no longer exported; remove them from GALLERY_EXEMPT: ${stale.join(', ')}`);
    const taught = exempt.filter((name) => rendered.has(name));
    assert(taught.length === 0, `the gallery shows deprecated components: ${taught.join(', ')}`);
  });

  await test('gallery: a component the gallery never renders fails, naming it', () => {
    const source = readRepo(GALLERY) ?? '';
    const components = componentExports(vcSdk);
    assert(galleryGaps([...components, 'Carousel'], source).join() === 'Carousel', 'a newly exported component with no gallery entry is named');
    const withoutStepper = source.replace(/<Stepper[\s/>]/g, '<Text ');
    assert(galleryGaps(components, withoutStepper).join() === 'Stepper', 'removing a component from the gallery names it');
    assert(galleryGaps(['Stepper'], '// <Stepper />\nconst x = 1;').join() === 'Stepper', 'a component mentioned only in a comment is not shown');
    assert(componentExports({ toast: () => {}, Card: () => null, ListProps: undefined }).join() === 'Card', 'only PascalCase function values are components');
  });

  await test('copy lint: every COPY key has a kind, and the shell copy uses the glossary with no Whim "I" on a control', () => {
    const findings = copyFindings(COPY, COPY_KINDS);
    assert(findings.length === 0, findings.join('; '));
    const stale = Object.keys(COPY_KINDS).filter((key) => !(key in COPY));
    assert(stale.length === 0, `COPY_KINDS tags keys COPY no longer has: ${stale.join(', ')}`);
    assert(FIRST_PERSON.test(COPY.composeHelper) && COPY_KINDS.composeHelper === 'prose', 'the maker says "I" in prose, and the lint lets it');
  });

  await test('copy lint: a control saying "I’ll decide" or "I", a retired word, and an untagged key each fail, naming the key', () => {
    const decide = copyFindings({ ...COPY, clarifyIllDecide: 'I’ll decide' }, { ...COPY_KINDS, clarifyIllDecide: 'control' });
    assert(decide.length === 1 && decide[0].startsWith('clarifyIllDecide: Whim\'s "I" on a control'), `"I’ll decide": ${decide.join('; ')}`);
    const bareI = copyFindings({ ...COPY, readyOpen: 'I can open it' }, COPY_KINDS);
    assert(bareI.length === 1 && bareI[0].startsWith('readyOpen: Whim\'s "I"'), `a bare "I": ${bareI.join('; ')}`);
    const person = copyFindings({ ...COPY, reportIncludePrompt: 'I’ll include what you asked for' }, COPY_KINDS);
    assert(person.length === 1 && person[0].startsWith('reportIncludePrompt:'), `the maker's "I’ll" on a person's control: ${person.join('; ')}`);
    const restore = copyFindings({ ...COPY, historyUseVersion: 'Restore this version' }, COPY_KINDS);
    assert(restore.length === 1 && restore[0].startsWith('historyUseVersion: retired word "restore"'), `a retired word: ${restore.join('; ')}`);
    const prose = copyFindings({ ...COPY, failureTitle: 'Couldn’t generate this' }, COPY_KINDS);
    assert(prose.length === 1 && prose[0].startsWith('failureTitle: retired word "generate"'), `a retired word in prose: ${prose.join('; ')}`);
    const untagged = copyFindings({ ...COPY, homeNewLine: 'Something new' }, COPY_KINDS);
    assert(untagged.length === 1 && untagged[0].startsWith('homeNewLine: has no kind'), `an untagged key: ${untagged.join('; ')}`);
    const reworded = copyFindings({ ...COPY, consentWhy: 'To make your apps and run Whim.' }, COPY_KINDS);
    assert(reworded.length === 1 && reworded[0].startsWith('consentWhy: no longer carries a retired word'), `a stale exemption: ${reworded.join('; ')}`);
  });

  await test('copy numbers: written in the copy table’s language, English and French alike (#89)', () => {
    assert(formatCount(1204, 'en') === '1,204', `English groups with a comma: ${formatCount(1204, 'en')}`);
    assert(formatCount(1204, 'fr') === '1 204', `French groups with a narrow no-break space: ${JSON.stringify(formatCount(1204, 'fr'))}`);
    assert(timelineGrowthLine(1204) === 'Wrote 1,204 characters', `the English table writes English numbers: ${timelineGrowthLine(1204)}`);
    assert(reportCodeSizeLabel(12043) === '12,043 characters', `the report's code size: ${reportCodeSizeLabel(12043)}`);
  });

  await test('copy numbers: no number in src/host is formatted in the phone’s locale', () => {
    const hits = productFiles('src/host').flatMap((file) => machineLocaleNumbers(fs.readFileSync(path.join(ROOT, file), 'utf8')).map((line) => `${file}:${line}`));
    assert(hits.length === 0, `pass the copy table's language (copy.ts#formatCount): ${hits.join(', ')}`);
    assert(machineLocaleNumbers('const s = `${n.toLocaleString()} characters`;').join() === '1', 'toLocaleString() with no locale is a hit');
    assert(machineLocaleNumbers('new Intl.NumberFormat(undefined).format(n);\nnew Intl.NumberFormat().format(n);').join() === '1,2', 'Intl.NumberFormat with no locale is a hit');
    assert(machineLocaleNumbers("n.toLocaleString('en');\n// n.toLocaleString()").length === 0, 'an explicit locale, or a comment, is not');
  });
}
