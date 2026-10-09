/**
 * Every Playwright host binding is main-frame guarded (capability-bridge: "The fast gate
 * statically rejects unguarded Playwright host bindings"). The fixtures are inline source the
 * audit parses; the guard-after-parse case is the weaker variant a refactor would plausibly
 * produce, so it must be flagged while the correctly-guarded controls pass.
 */

import { test, assert } from '../harness';
import { auditRepo, auditSource, BindingRule } from './binding-provenance';

const rules = (file: string, text: string): string => auditSource(file, text).violations.map((v) => `${v.rule}@${v.line}`).join(',');

const UNGUARDED_EXPOSE_FUNCTION = [
  "import { chromium } from 'playwright';",
  'const page = await (await chromium.launch()).newPage();',
  "await page.exposeFunction('whimHostDispatch', host.dispatch);",
].join('\n');

const GUARD_AFTER_PARSE = [
  "import type { Frame } from 'playwright';",
  "await page.exposeBinding('whimHostDispatch', (source: { frame: Frame }, raw: string) => {",
  '  const frame = JSON.parse(raw);',
  '  if (source.frame !== page.mainFrame()) return null;',
  '  return host.dispatch(frame);',
  '});',
].join('\n');

const REFUSAL_READS_PAYLOAD = [
  "await context.exposeBinding('whimHostDispatch', async (source, raw) => {",
  '  if (source.frame !== source.page.mainFrame()) { await host.dispatch(raw); return null; }',
  '  return host.dispatch(raw);',
  '});',
].join('\n');

const NOT_INLINE = ["import { chromium } from 'playwright';", "await page.exposeBinding('whimHostDispatch', handler);"].join('\n');

const GUARDED_PAGE_LEVEL = [
  "import type { Frame } from 'playwright';",
  "await page.exposeBinding('whimHostDispatch', (source: { frame: Frame }, raw: string) => {",
  '  // refused before any parse or dispatch',
  '  if (source.frame !== page.mainFrame()) {',
  '    refusals += 1;',
  '    return null;',
  '  }',
  '  return host.dispatch(raw);',
  '});',
].join('\n');

const GUARDED_CONTEXT_LEVEL = [
  "import { chromium } from 'playwright';",
  "await context.exposeBinding('whimHostDispatch', ({ frame, page }, raw) => {",
  '  if (page.mainFrame() !== frame) return;',
  '  return host.dispatch(raw);',
  '});',
].join('\n');

export async function run(): Promise<void> {
  await test('binding provenance: unguarded, late-guarded, payload-reading and non-inline bindings are flagged', () => {
    const cases: [string, string, BindingRule, number][] = [
      ['fixture/unguarded.mjs', UNGUARDED_EXPOSE_FUNCTION, 'expose-function', 3],
      ['fixture/late-guard.ts', GUARD_AFTER_PARSE, 'guard-not-first', 2],
      ['fixture/refusal-reads-payload.mjs', REFUSAL_READS_PAYLOAD, 'guard-not-first', 1],
      ['fixture/not-inline.mjs', NOT_INLINE, 'binding-not-inline', 2],
    ];
    for (const [file, text, rule, line] of cases) {
      const got = rules(file, text);
      assert(got === `${rule}@${line}`, `${file}: expected ${rule}@${line}, got [${got}]`);
    }
  });

  await test('binding provenance: correctly guarded page- and context-level bindings pass', () => {
    for (const [file, text] of [
      ['fixture/guarded-page.ts', GUARDED_PAGE_LEVEL],
      ['fixture/guarded-context.mjs', GUARDED_CONTEXT_LEVEL],
    ]) {
      const result = auditSource(file, text);
      assert(result.violations.length === 0, `${file} is guarded, got [${rules(file, text)}]`);
      assert(result.guarded.length === 1, `${file}: the guarded binding is recognised as a site, got ${result.guarded.length}`);
    }
  });

  await test('binding provenance: every host binding in the repo refuses non-main-frame callers first', () => {
    const { guarded, violations } = auditRepo(process.cwd());
    const found = violations.map((v) => v.file + ':' + v.line + ' ' + v.rule).join(', ');
    assert(violations.length === 0, `exposeFunction is banned and every exposeBinding callback must open with a main-frame refusal: ${found}`);
    // The scan reaches the directories ESLint ignores and both module kinds, so a clean result covers them.
    assert(guarded.some((s) => s.file.startsWith('invariants/') && s.file.endsWith('.mjs')), 'the scan reaches a guarded binding in invariants/*.mjs');
    assert(guarded.some((s) => s.file.endsWith('.ts')), 'the scan reaches a guarded binding in a .ts file');
  });
}
