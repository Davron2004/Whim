/**
 * screen-exits Node suite (tasks 1.1, 1.4, 1.5, 3.3) — locks the pure system-back seam
 * (`bindSystemBack`), the root frame's safe-area edges (`frameEdgesFor`), `ScreenBoundary`'s
 * `onLeave` pass-through (design D7/D9/D10; spec launcher-screen-exits "System back and the
 * visible control perform the same action", "Controls at the bottom of a screen clear the bottom
 * system area"), and the gate scanner over `SCREEN_EXITS` (design D8; spec launcher-screen-exits
 * "A screen without a declared exit fails the fast gate"). `ScreenBoundary` is React Native-free,
 * so it is REALLY RENDERED here with `react-test-renderer`, the idiom `observability-ui.suite.ts`
 * established.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { bindSystemBack } from '../system-back';
import type { BackHandlerLike } from '../system-back';
import { FALLBACK_EXIT, SCREEN_EXITS, frameEdgesFor } from '../screen-exits';
import type { ExitControl, ScreenKind } from '../screen-exits';
import ScreenBoundary from '../ScreenBoundary';
import type { ScreenFallbackProps } from '../ScreenBoundary';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A fake `BackHandlerLike`: records how many times it was registered, captures the live
 *  listener so a test can fire it, and tracks whether `remove()` was called. */
function fakeBackHandler(): {
  api: BackHandlerLike;
  registrations: () => number;
  fire: () => boolean;
  removed: () => boolean;
} {
  let listener: (() => boolean) | null = null;
  let registrations = 0;
  let removed = false;
  const api: BackHandlerLike = {
    addEventListener(_eventType, l) {
      registrations++;
      listener = l;
      return {
        remove: () => {
          removed = true;
        },
      };
    },
  };
  return {
    api,
    registrations: () => registrations,
    fire: () => listener!(),
    removed: () => removed,
  };
}

// ── the exit-table scanner (design D8) ──────────────────────────────────────

export interface ScreenExitViolation {
  rule: 'seam' | 'declared' | 'bound' | 'labelled' | 'real-kinds';
  file: string;
}

/** Only these two files may import `BackHandler` from `react-native` or call
 *  `BackHandler.addEventListener` — every other screen goes through `useSystemBack`. */
const ALLOWED_BACK_HANDLER_FILES = new Set(['use-system-back.ts', 'useMiniAppHost.ts']);
const IMPORTS_BACK_HANDLER = /import\s*\{[^}]*\bBackHandler\b[^}]*\}\s*from\s*['"]react-native['"]/;
const CALLS_ADD_EVENT_LISTENER = /\bBackHandler\.addEventListener\s*\(/;

/** Comments mentioning `BackHandler` (design D8's own `SheetModal.tsx`/`RunDetailsSheet.tsx`
 *  examples) don't count as the seam rule's concern — only live code does. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function countOccurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

/** The bare-identifier argument of the file's (single, by the time this runs) `useSystemBack(...)`
 *  call — `null` when the argument isn't a plain identifier (an inline function, a member
 *  expression, and so on all count as "not bound" for design D8's "bound" rule). */
function systemBackArg(source: string): string | null {
  const m = /useSystemBack\(([^)]*)\)/.exec(source);
  if (m == null) return null;
  const arg = m[1].trim();
  return /^[A-Za-z_$][\w$]*$/.test(arg) ? arg : null;
}

/** One name → brace-matched body pass for `functionBodies` below, shared by the `function` and
 *  arrow forms so neither pattern grows complex enough to need the other. */
function collectBodies(source: string, pattern: string, bodies: Map<string, string>): void {
  const re = new RegExp(pattern, 'g');
  let m: RegExpExecArray | null;
  // Deliberately does NOT skip forward past a matched body: `pressHandlerFor` is declared INSIDE
  // `ConsentScreen`'s own body, so the scan must keep looking within it, not resume after it.
  while ((m = re.exec(source)) != null) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      i++;
    }
    bodies.set(m[1], source.slice(re.lastIndex, i - 1));
  }
}

const FUNCTION_DECL = 'function\\s+(\\w+)\\s*\\([^)]*\\)[^{;]*\\{';
const ARROW_DECL = 'const\\s+(\\w+)\\s*=\\s*\\([^)]*\\)[^{;]*=>\\s*\\{';

/** Same-file function bodies keyed by name — `function name(...) {...}` and `const name = (...) =>
 *  {...}` — brace-matched so a body with its own nested blocks extracts correctly. Used only by
 *  `isBoundToControl`'s one sanctioned indirection below. */
function functionBodies(source: string): Map<string, string> {
  const bodies = new Map<string, string>();
  collectBodies(source, FUNCTION_DECL, bodies);
  collectBodies(source, ARROW_DECL, bodies);
  return bodies;
}

/** Whether `ident` is bound to a pressable control in `source` (design D8 "bound"): directly, as
 *  the value inside some `on[A-Z]…={…}` JSX attribute, or — the one sanctioned indirection,
 *  mirroring "labelled"'s allowance for a decision function returning label keys — through a
 *  same-file function whose body names `ident` and which is itself an `on[A-Z]…={…}` attribute's
 *  value. `ConsentScreen.tsx`'s `pressHandlerFor` is exactly this shape: every non-granting row's
 *  `onPress={pressHandlerFor(row.action)}` resolves, for some rows, to `onClose` — the same
 *  identifier bound to `useSystemBack`. */
function isBoundToControl(source: string, ident: string): boolean {
  const word = ident.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const directRe = new RegExp(`on[A-Z]\\w*\\s*=\\{[^{}]*\\b${word}\\b[^{}]*\\}`);
  if (directRe.test(source)) return true;

  for (const [name, body] of functionBodies(source)) {
    if (!new RegExp(`\\b${word}\\b`).test(body)) continue;
    const usedAsHandler = new RegExp(`on[A-Z]\\w*\\s*=\\{[^{}]*\\b${name}\\b[^{}]*\\}`);
    if (usedAsHandler.test(source)) return true;
  }
  return false;
}

/** Whether a control's label really appears in `source` (design D8 "labelled"): a `copy` control
 *  as `COPY.<key>`, or as the quoted key `'<key>'` where a decision module hands back label keys
 *  (`consent-flow.ts#consentControls`'s shape); a `component` as `<Name`; a `literal` verbatim. */
function hasLabel(source: string, control: ExitControl): boolean {
  if ('copy' in control) {
    return new RegExp(`COPY\\.${control.copy}\\b`).test(source) || source.includes(`'${control.copy}'`);
  }
  if ('component' in control) return source.includes(`<${control.component}`);
  return source.includes(control.literal);
}

function screenRows(): [ScreenKind, (typeof SCREEN_EXITS)[ScreenKind]][] {
  return (Object.keys(SCREEN_EXITS) as ScreenKind[]).map((kind) => [kind, SCREEN_EXITS[kind]]);
}

function usesBackHandlerDirectly(source: string): boolean {
  return IMPORTS_BACK_HANDLER.test(source) || CALLS_ADD_EVENT_LISTENER.test(source);
}

/** "seam" (every `BackHandler` use goes through the two allowed files) and the membership half of
 *  "declared" (every `useSystemBack(` caller is a row's file or `FALLBACK_EXIT.file`). */
function seamAndMembershipViolations(clean: Record<string, string>): ScreenExitViolation[] {
  const declaredFiles = new Set<string>([FALLBACK_EXIT.file]);
  for (const [, row] of screenRows()) if (row.back === 'screen' && row.file != null) declaredFiles.add(row.file);

  const violations: ScreenExitViolation[] = [];
  for (const [file, source] of Object.entries(clean)) {
    const allowed = ALLOWED_BACK_HANDLER_FILES.has(file);
    if (!allowed && usesBackHandlerDirectly(source)) violations.push({ rule: 'seam', file });

    const isHookCaller = file !== 'use-system-back.ts' && source.includes('useSystemBack(');
    if (isHookCaller && !declaredFiles.has(file)) violations.push({ rule: 'declared', file });
  }
  return violations;
}

/** The call-count half of "declared" (a `back: 'screen'` row's file calls the hook exactly once)
 *  and "bound" (that one call's argument reaches a pressable control in the same file). */
function boundViolations(clean: Record<string, string>): ScreenExitViolation[] {
  const violations: ScreenExitViolation[] = [];
  for (const [, row] of screenRows()) {
    if (row.back !== 'screen' || row.file == null) continue;
    const source = clean[row.file];
    if (source == null) continue; // nothing given for this row's file — nothing to check

    if (countOccurrences(source, 'useSystemBack(') !== 1) {
      violations.push({ rule: 'declared', file: row.file });
      continue; // "bound" needs exactly one call to read an argument from
    }
    const arg = systemBackArg(source);
    if (arg == null || !isBoundToControl(source, arg)) violations.push({ rule: 'bound', file: row.file });
  }
  return violations;
}

/** Every control's label really appears in its declared file, plus `flow-chrome.tsx`'s own
 *  `COPY.backLabel` (design D8 "labelled"). */
function labelledViolations(clean: Record<string, string>): ScreenExitViolation[] {
  const allControls: ExitControl[] = [
    ...Object.values(SCREEN_EXITS).flatMap((row) => row.controls),
    ...FALLBACK_EXIT.controls,
  ];
  const violations: ScreenExitViolation[] = [];
  for (const control of allControls) {
    const source = clean[control.file];
    if (source != null && !hasLabel(source, control)) violations.push({ rule: 'labelled', file: control.file });
  }
  const flowChrome = clean['flow-chrome.tsx'];
  if (flowChrome != null && !flowChrome.includes('COPY.backLabel')) {
    violations.push({ rule: 'labelled', file: 'flow-chrome.tsx' });
  }
  return violations;
}

/** Every `ScreenKind` is a real, live-checked union member (design D8 "real kinds") — skipped
 *  entirely when neither router file is given, so a fixture testing another rule stays silent. */
function realKindsViolations(clean: Record<string, string>): ScreenExitViolation[] {
  const kindSources = [clean['LauncherRoot.tsx'], clean['prompt-flow.ts']].filter((s): s is string => s != null);
  if (kindSources.length === 0) return [];

  const violations: ScreenExitViolation[] = [];
  for (const [kind] of screenRows()) {
    if (!kindSources.some((s) => s.includes(`kind: '${kind}'`))) violations.push({ rule: 'real-kinds', file: 'screen-exits.ts' });
  }
  return violations;
}

/**
 * Pure scan over a `{ fileName: source }` map for the five design-D8 rules. Deliberately checks
 * only what the given map actually contains: a rule whose companion file (`LauncherRoot.tsx`/
 * `prompt-flow.ts` for "real-kinds", a control's own file for "labelled") is absent from `files`
 * has nothing to assert and stays silent — which is what lets one small fixture exercise exactly
 * one rule, while the real, complete tree still exercises every rule at once.
 */
export function scanScreenExits(files: Record<string, string>): ScreenExitViolation[] {
  const clean: Record<string, string> = {};
  for (const [file, source] of Object.entries(files)) clean[file] = stripComments(source);

  return [
    ...seamAndMembershipViolations(clean),
    ...boundViolations(clean),
    ...labelledViolations(clean),
    ...realKindsViolations(clean),
  ];
}

/** Reads the top-level, non-test `.ts`/`.tsx` files of `src/host/launcher/` straight off disk —
 *  never imported, so the scanner sees exactly the source a reviewer would read, not a bundler's
 *  transform of it. `readdirSync` without `recursive` already excludes the `test/` subdirectory. */
function loadLauncherSources(): Record<string, string> {
  const dir = path.join(process.cwd(), 'src/host/launcher');
  const files: Record<string, string> = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
    files[entry.name] = fs.readFileSync(path.join(dir, entry.name), 'utf8');
  }
  return files;
}

function controlledChild(control: { throws: boolean }): () => React.ReactElement {
  return function Child(): React.ReactElement {
    if (control.throws) throw new TypeError('screen exploded');
    return React.createElement('ok');
  };
}

export async function runScreenExitsTests(h: Harness): Promise<void> {
  // ── bindSystemBack (design D9) ──────────────────────────────────────────────

  await h.test('bindSystemBack: registers exactly one listener across three handler swaps', () => {
    const fake = fakeBackHandler();
    let current: (() => void) | null = () => {};
    bindSystemBack(fake.api, () => current);
    h.eq(fake.registrations(), 1, 'one registration at bind time');

    current = () => {};
    current = () => {};
    current = () => {};
    h.eq(fake.registrations(), 1, 'swapping the handler three times registers no new listener');
  });

  await h.test('bindSystemBack: always runs the LATEST handler, not the one live at bind time', () => {
    const calls: string[] = [];
    let current: (() => void) | null = () => calls.push('first');
    const fake = fakeBackHandler();
    bindSystemBack(fake.api, () => current);

    current = () => calls.push('second');
    fake.fire();
    h.eq(calls, ['second'], 'the handler current() resolves to NOW runs, not the one bound at mount');
  });

  await h.test('bindSystemBack: returns true with a handler, false with null', () => {
    let current: (() => void) | null = () => {};
    const fake = fakeBackHandler();
    bindSystemBack(fake.api, () => current);
    h.eq(fake.fire(), true, 'system back is handled when current() gives a handler');

    current = null;
    h.eq(fake.fire(), false, 'system back falls through to the platform default when current() is null');
  });

  await h.test('bindSystemBack: the returned unsubscribe removes the listener', () => {
    const fake = fakeBackHandler();
    const unsubscribe = bindSystemBack(fake.api, () => null);
    h.ok(!fake.removed(), 'not removed before unsubscribe is called');
    unsubscribe();
    h.ok(fake.removed(), 'unsubscribe removes the underlying listener');
  });

  // ── frameEdgesFor (design D10) ───────────────────────────────────────────────

  const ALL_KINDS: readonly ScreenKind[] = [
    'home',
    'app',
    'dev',
    'settings',
    'history',
    'link-missing',
    'consent',
    'compose',
    'clarify',
    'plan',
    'build',
    'done',
    'failure',
  ];

  for (const kind of ALL_KINDS) {
    const expected = kind === 'app' || kind === 'dev' ? ['top'] : ['top', 'bottom'];
    await h.test(`frameEdgesFor: ${kind} gets ${JSON.stringify(expected)}`, () => {
      h.eq(frameEdgesFor(kind), expected, `${kind}'s root frame applies exactly these safe-area edges`);
    });
  }

  // ── ScreenBoundary onLeave pass-through (design D7) ──────────────────────────

  await h.test('boundary: a throwing screen with onLeave hands the fallback that exact function', () => {
    const onLeave = () => {};
    let seen: (() => void) | undefined;
    const Fallback = (props: Readonly<ScreenFallbackProps>) => {
      seen = props.onLeave;
      return React.createElement('fallback');
    };

    let tree: TestRenderer.ReactTestRenderer | undefined;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        React.createElement(
          ScreenBoundary,
          { screen: 'onleave-given', FallbackComponent: Fallback, onLeave },
          React.createElement(controlledChild({ throws: true })),
        ),
      );
    });
    h.ok(seen === onLeave, 'the fallback receives the exact onLeave function, unchanged');
    TestRenderer.act(() => tree!.unmount());
  });

  await h.test('boundary: a throwing screen with no onLeave hands the fallback none', () => {
    let seen: (() => void) | undefined = () => {};
    const Fallback = (props: Readonly<ScreenFallbackProps>) => {
      seen = props.onLeave;
      return React.createElement('fallback');
    };

    let tree: TestRenderer.ReactTestRenderer | undefined;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        React.createElement(
          ScreenBoundary,
          { screen: 'onleave-absent', FallbackComponent: Fallback },
          React.createElement(controlledChild({ throws: true })),
        ),
      );
    });
    h.eq(seen, undefined, 'with no onLeave prop given, the fallback gets none — Home stays Try again only');
    TestRenderer.act(() => tree!.unmount());
  });

  await h.test('boundary: invoking the passed-through onLeave calls the spy exactly once', () => {
    let calls = 0;
    const onLeave = () => {
      calls++;
    };
    let received: (() => void) | undefined;
    const Fallback = (props: Readonly<ScreenFallbackProps>) => {
      received = props.onLeave;
      return React.createElement('fallback');
    };

    let tree: TestRenderer.ReactTestRenderer | undefined;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        React.createElement(
          ScreenBoundary,
          { screen: 'onleave-invoked', FallbackComponent: Fallback, onLeave },
          React.createElement(controlledChild({ throws: true })),
        ),
      );
    });
    TestRenderer.act(() => received!());
    h.eq(calls, 1, 'the fallback’s call to onLeave reaches the exact function the boundary was given, once');
    TestRenderer.act(() => tree!.unmount());
  });

  await h.test('boundary: a changed screen still resets the boundary with onLeave given', () => {
    const onLeave = () => {};
    const Fallback = () => React.createElement('fallback');

    let tree: TestRenderer.ReactTestRenderer | undefined;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        React.createElement(
          ScreenBoundary,
          { screen: 'screen-a', FallbackComponent: Fallback, onLeave },
          React.createElement(controlledChild({ throws: true })),
        ),
      );
    });
    h.eq((tree!.toJSON() as { type: string }).type, 'fallback', 'screen-a is in its error state');

    TestRenderer.act(() => {
      tree!.update(
        React.createElement(
          ScreenBoundary,
          { screen: 'screen-b', FallbackComponent: Fallback, onLeave },
          React.createElement('ok'),
        ),
      );
    });
    h.eq((tree!.toJSON() as { type: string }).type, 'ok', 'the changed reset key still clears the error state with onLeave given');
    TestRenderer.act(() => tree!.unmount());
  });

  // ── scanScreenExits (design D8) ──────────────────────────────────────────────

  await h.test('scanner: the real, fully migrated tree has no exit-table violations', () => {
    h.eq(scanScreenExits(loadLauncherSources()), [], 'every screen is on the seam, declared, bound, labelled and real');
  });

  await h.test('scanner "seam": a new screen calling BackHandler.addEventListener is caught', () => {
    const files = {
      'NewScreen.tsx': `
        import { BackHandler } from 'react-native';
        export default function NewScreen() {
          BackHandler.addEventListener('hardwareBackPress', () => true);
        }
      `,
    };
    h.eq(scanScreenExits(files), [{ rule: 'seam', file: 'NewScreen.tsx' }], 'only the seam rule fires, on the offending file');
  });

  await h.test('scanner "declared": a file calling useSystemBack that no row names is caught', () => {
    const files = {
      'OrphanScreen.tsx': `
        export default function OrphanScreen({ onBack }: { onBack: () => void }) {
          useSystemBack(onBack);
          return <TouchableOpacity onPress={onBack} />;
        }
      `,
    };
    h.eq(
      scanScreenExits(files),
      [{ rule: 'declared', file: 'OrphanScreen.tsx' }],
      'a screen calling the hook with no SCREEN_EXITS/FALLBACK_EXIT row naming it is caught',
    );
  });

  await h.test('scanner "bound": the hook and the visible control disagree on which identifier to use', () => {
    // The plausible weaker refactor design D8 calls out: `PlanStep.tsx` (a real row's file) binds
    // the hook to `handleBack` but the header still reads the stale `onBack` prop.
    const files = {
      'PlanStep.tsx': `
        export default function PlanStep({ onBack }: { onBack: () => void }) {
          const handleBack = () => onBack();
          useSystemBack(handleBack);
          return <FlowHeader step="plan" onBack={onBack} />;
        }
      `,
    };
    h.eq(
      scanScreenExits(files),
      [{ rule: 'bound', file: 'PlanStep.tsx' }],
      'handleBack never reaches a pressable control in this file — only the stale onBack does',
    );
  });

  await h.test('scanner "labelled": a control\'s COPY key goes missing from its declared file', () => {
    // A real row's file (`FailureScreen.tsx`), correctly declared and bound, but its visible
    // control has been re-labelled with a literal string instead of `COPY.failureBack`.
    const files = {
      'FailureScreen.tsx': `
        export default function FailureScreen({ onBack }: { onBack: () => void }) {
          useSystemBack(onBack);
          return (
            <TouchableOpacity onPress={onBack}>
              <Text>Back</Text>
            </TouchableOpacity>
          );
        }
      `,
    };
    h.eq(
      scanScreenExits(files),
      [{ rule: 'labelled', file: 'FailureScreen.tsx' }],
      'COPY.failureBack (or the quoted key) is gone from the file the row says renders it',
    );
  });

  await h.test('scanner "real kinds": a table key with no `kind:` literal in the router is caught', () => {
    // Every ScreenKind except one ('dev') is present, so exactly the missing one trips the rule —
    // proof this isn't a scanner that fails the moment either router file is incomplete.
    const kinds: readonly ScreenKind[] = [
      'home',
      'app',
      'settings',
      'history',
      'link-missing',
      'consent',
      'compose',
      'clarify',
      'plan',
      'build',
      'done',
      'failure',
    ];
    const files = {
      'LauncherRoot.tsx': kinds.map((kind) => `{ kind: '${kind}' }`).join('\n'),
    };
    h.eq(
      scanScreenExits(files),
      [{ rule: 'real-kinds', file: 'screen-exits.ts' }],
      'only the omitted kind (dev) is reported, once',
    );
  });
}
