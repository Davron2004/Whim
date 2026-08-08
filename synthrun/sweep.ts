/**
 * Interaction sweep + screen coverage (design D1, `openspec/changes/synthetic-run-harness/
 * chains.md` chain 4). Enumerates interactive `vc-sdk` elements from OUTSIDE the realm — a
 * Playwright `Frame` pierces the opaque-origin sandboxed iframe the same way chain 3's own test
 * already does (`f.evaluate(() => document.getElementById('whim-root')...)`); this is
 * browser-level trusted vantage, never bundle cooperation (design D1 Risks). No DOM lib types
 * are available in this project's tsconfig (RN base lib) — every in-page `evaluate` callback
 * below declares its own minimal ad-hoc shape and reaches the browser globals through a
 * `globalThis` cast, mirroring `observe.ts`'s established idiom.
 *
 * Screen identity during live navigation is resolved via React's own fiber tree (the DOM node's
 * `__reactFiber$…` property), matched by REFERENCE against `window.__WHIM_APP_MODULE__.default.
 * screens` (the same live app-module object `loader.js` mounts) — never by trusting anything the
 * bundle posts. `__whimNavDepth` frames (already collected by chain 2's observer, `handoff/
 * observe-api.md`) are read only as a wake-up hint that a navigation MAY have happened; the fiber
 * walk is what confirms it and names the destination (F4 discipline: depth hints are bookkeeping,
 * never authority).
 *
 * Cold-mount (task 4.4) rebuilds the SAME candidate source with `initial` retargeted at the
 * unreached screen name (`ScreenComponent`s take no props, so this is legitimate render
 * coverage — design D1) and delivers it via `__whimControl.reinject({reset:true, bundleSource})`
 * — a fresh realm, never in-place re-delivery (T7).
 */
import type { Frame, Page } from 'playwright';
import type { RunBudgets } from './contract';
import type { RunContext } from './session';
import { buildCandidateSource } from './builder';
import { type AttachedObservers, awaitQuiet } from './observe';

// ─────────────────────────────────────────────────────────────────────────────
// Fingerprints (spec: "(component kind, label/accessible text, DOM path)")
// ─────────────────────────────────────────────────────────────────────────────

export type SweepElementKind =
  | 'button'
  | 'text-input'
  | 'number-input'
  | 'switch'
  | 'checkbox'
  | 'slider'
  | 'pressable'
  | 'modal-backdrop';

export interface SweptElement {
  kind: SweepElementKind;
  label: string;
  /** A `#whim-root`-rooted `nth-child` CSS path — both the fingerprint's DOM-path component
   *  AND a directly-usable `Frame.locator()` selector. */
  domPath: string;
}

export interface SweepDiagnostic {
  kind: 'unreachable_screen';
  severity: 'warning';
  message: string;
  hint: string;
}

export interface SweepOptions {
  /** Per-screen action cap (design D1's "per-screen cap") — bounds a single screen's sweep
   *  independent of the run's global `totalBudgetMs`. Default `DEFAULT_MAX_ACTIONS_PER_SCREEN`. */
  maxActionsPerScreen?: number;
  /** Fixed canonical text typed into every `TextInput` (spec: "type canonical values"). */
  canonicalText?: string;
  /** Fixed canonical number typed into every `NumberInput`. */
  canonicalNumber?: number;
}

export interface SweepResult {
  declaredScreens: string[];
  visitedScreens: string[];
  /** `true` iff any screen's sweep hit `maxActionsPerScreen` while unvisited fingerprints
   *  remained (spec: "A truncated sweep SHALL be marked in the report, never silently reported
   *  as complete"). */
  truncated: boolean;
  diagnostics: SweepDiagnostic[];
  perScreenMs: Record<string, number>;
  /** Every fingerprint acted on, in execution order — the determinism/audit trail. */
  actionsLog: SweptElement[];
}

export const DEFAULT_MAX_ACTIONS_PER_SCREEN = 40;

interface ResolvedSweepOptions {
  maxActionsPerScreen: number;
  canonicalText: string;
  canonicalNumber: number;
}

function resolveOptions(opts?: SweepOptions): ResolvedSweepOptions {
  return {
    maxActionsPerScreen: opts?.maxActionsPerScreen ?? DEFAULT_MAX_ACTIONS_PER_SCREEN,
    canonicalText: opts?.canonicalText ?? 'synthrun-probe',
    canonicalNumber: opts?.canonicalNumber ?? 7,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// Frame + screen-identity resolution (browser-level vantage, never bundle-reported)
// ─────────────────────────────────────────────────────────────────────────────

interface MinimalDocument {
  getElementById(id: string): unknown;
}

/** Polls `page.frames()` for the one whose document contains `#whim-root` — the candidate's
 *  mount point (`build/assemble.mjs`'s `buildSrcdoc`). Survives a cold-mount reinject only if
 *  re-called AFTER it (a realm reset recreates the iframe — a new `Frame` object). */
export async function findAppFrame(page: Page, timeoutMs = 5000): Promise<Frame> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const f of page.frames()) {
      const hasRoot = await f
        .evaluate(() => !!(globalThis as unknown as { document: MinimalDocument }).document.getElementById('whim-root'))
        .catch(() => false);
      if (hasRoot) return f;
    }
    if (Date.now() >= deadline) throw new Error('synthrun sweep: no frame with #whim-root found within timeout');
    await sleep(30);
  }
}

export interface ScreenInfo {
  /** `Object.keys(window.__WHIM_APP_MODULE__.default.screens)` — the live app module's own
   *  declared-screens map, read directly (never the bundle's self-report). */
  declared: string[];
  /** The declared-screen name whose component reference (`===`) matches the fiber currently
   *  mounted under `#whim-root`, resolved by walking the DOM node's `__reactFiber$…` return
   *  chain — `null` when nothing mounted yet or no match was found. */
  current: string | null;
}

/** Runs entirely inside the candidate's frame. No DOM lib types exist in this project's
 *  tsconfig (RN base lib) — minimal ad-hoc shapes only, mirroring `observe.ts`. */
export async function getScreenInfo(frame: Frame): Promise<ScreenInfo> {
  return frame.evaluate((): ScreenInfo => {
    interface Fiber {
      type: unknown;
      return: Fiber | null;
    }
    interface DomNode {
      firstChild?: DomNode | null;
    }
    interface DomDocument {
      getElementById(id: string): DomNode | null;
    }
    const w = globalThis as unknown as {
      __WHIM_APP_MODULE__?: { default?: { screens?: Record<string, unknown> } };
      document: DomDocument;
    };
    const spec = w.__WHIM_APP_MODULE__ && w.__WHIM_APP_MODULE__.default;
    const screens: Record<string, unknown> = (spec && spec.screens) || {};
    const declared = Object.keys(screens);
    function screenNameForType(type: unknown): string | null {
      for (const name of declared) {
        if (screens[name] === type) return name;
      }
      return null;
    }
    const root = w.document.getElementById('whim-root');
    let current: string | null = null;
    const child = root && root.firstChild;
    if (child) {
      const record = child as unknown as Record<string, unknown>;
      const fiberKey = Object.keys(record).find((k) => k.indexOf('__reactFiber$') === 0);
      let f: Fiber | null = fiberKey ? (record[fiberKey] as Fiber) : null;
      while (f) {
        const match = screenNameForType(f.type);
        if (match) {
          current = match;
          break;
        }
        f = f.return;
      }
    }
    return { declared, current };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Element enumeration (task 4.1)
// ─────────────────────────────────────────────────────────────────────────────

/** Runs entirely inside the candidate's frame. Classifies by structural/CSS signals that are
 *  each unique to exactly one `vc-sdk` control family (design Risks — no `data-*` marker exists
 *  today; this is the "enumerate via CDP accessibility roles + rendered text" fallback, adapted
 *  to this SDK's actual DOM shapes since none of Card/ListItem/Switch/Checkbox/Slider expose a
 *  native ARIA role a div gets for free):
 *   - `input[type=text|number]`         → text-input / number-input (native `type` attribute)
 *   - `[role=switch|checkbox]`          → switch / checkbox (Switch/Checkbox set these explicitly)
 *   - `button:not([disabled])`          → button (covers plain `Button` AND every
 *                                          `SegmentedControl` option — each is its own fingerprint,
 *                                          so sweeping every button already "selects every option")
 *   - inline `style.touchAction:'none'` → slider (unique to `Slider`'s touch-area div)
 *   - inline `style.position:'fixed'`   → modal-backdrop (unique to `Modal`'s backdrop div)
 *   - inline `style.cursor:'pointer'`, excluding the above → pressable (`Card`/`ListItem` with
 *     `onPress`; inline (not computed/inherited) `style.cursor` is only ever set by the element
 *     ITSELF, never inherited from an ancestor, so this cannot false-positive on a pressable's
 *     children).
 */
export async function enumerateInteractiveElements(frame: Frame): Promise<SweptElement[]> {
  return frame.evaluate((): SweptElement[] => {
    interface DomNode {
      tagName: string;
      parentElement: DomNode | null;
      previousElementSibling: DomNode | null;
      style: { [key: string]: string };
      innerText?: string;
      textContent: string | null;
      placeholder?: string;
      getAttribute(name: string): string | null;
      closest(selector: string): DomNode | null;
      querySelector(selector: string): DomNode | null;
      querySelectorAll(selector: string): { forEach(cb: (el: DomNode) => void): void };
    }
    interface DomDocument {
      getElementById(id: string): DomNode | null;
    }
    const doc = (globalThis as unknown as { document: DomDocument }).document;
    const root = doc.getElementById('whim-root');
    const results: SweptElement[] = [];
    if (!root) return results;

    function cssPath(el: DomNode): string {
      const parts: string[] = [];
      let node: DomNode | null = el;
      while (node && node !== root) {
        const parent: DomNode | null = node.parentElement;
        if (!parent) break;
        let idx = 1;
        let sib = node.previousElementSibling;
        while (sib) {
          idx += 1;
          sib = sib.previousElementSibling;
        }
        parts.unshift(node.tagName.toLowerCase() + ':nth-child(' + idx + ')');
        node = parent;
      }
      return '#whim-root > ' + parts.join(' > ');
    }
    function textOf(el: DomNode): string {
      const raw = el.innerText != null ? el.innerText : el.textContent || '';
      return raw.trim().replace(/\s+/g, ' ').slice(0, 80);
    }
    function fieldLabel(el: DomNode): string {
      const label = el.closest('label');
      if (!label) return '';
      const span = label.querySelector('span');
      return span ? textOf(span) : '';
    }
    const seen = new Set<string>();
    function push(kind: SweepElementKind, label: string, el: DomNode): void {
      const path = cssPath(el);
      if (seen.has(path)) return;
      seen.add(path);
      results.push({ kind, label: label || '(unlabeled)', domPath: path });
    }

    root.querySelectorAll('*').forEach((el) => {
      if (el.style && el.style.position === 'fixed') push('modal-backdrop', 'modal', el);
    });
    root.querySelectorAll('input[type="text"]').forEach((el) => {
      push('text-input', fieldLabel(el) || el.placeholder || '(text)', el);
    });
    root.querySelectorAll('input[type="number"]').forEach((el) => {
      push('number-input', fieldLabel(el) || '(number)', el);
    });
    root.querySelectorAll('[role="switch"]').forEach((el) => push('switch', textOf(el) || 'switch', el));
    root.querySelectorAll('[role="checkbox"]').forEach((el) => push('checkbox', textOf(el) || 'checkbox', el));
    root.querySelectorAll('button:not([disabled])').forEach((el) => push('button', textOf(el) || '(button)', el));
    root.querySelectorAll('div').forEach((el) => {
      if (el.style && el.style.touchAction === 'none') push('slider', fieldLabel(el) || 'slider', el);
    });
    root.querySelectorAll('div').forEach((el) => {
      const roleHandled = el.getAttribute('role') === 'switch' || el.getAttribute('role') === 'checkbox';
      if (el.style && el.style.cursor === 'pointer' && !roleHandled && el.style.position !== 'fixed') {
        push('pressable', textOf(el) || '(pressable)', el);
      }
    });

    return results;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-fingerprint action recipes (spec: tap / type / toggle-both / select-each / drag-both /
// modal-inside-first-backdrop-last)
// ─────────────────────────────────────────────────────────────────────────────

const ACTION_TIMEOUT_MS = 3000;

async function performAction(frame: Frame, el: SweptElement, opts: ResolvedSweepOptions): Promise<void> {
  const locator = frame.locator(el.domPath);
  switch (el.kind) {
    case 'text-input':
      await locator.fill(opts.canonicalText, { timeout: ACTION_TIMEOUT_MS }).catch(() => {});
      return;
    case 'number-input':
      await locator.fill(String(opts.canonicalNumber), { timeout: ACTION_TIMEOUT_MS }).catch(() => {});
      return;
    case 'switch':
    case 'checkbox':
      // toggle on, then off (spec: "toggle Switch/Checkbox on and off") — same DOM node, its
      // `aria-checked` flips; this stays ONE fingerprint-visit, not two.
      await locator.click({ timeout: ACTION_TIMEOUT_MS }).catch(() => {});
      await locator.click({ timeout: ACTION_TIMEOUT_MS }).catch(() => {});
      return;
    case 'slider': {
      const box = await locator.boundingBox().catch(() => null);
      if (box) {
        const y = Math.max(1, box.height / 2);
        await locator.click({ position: { x: 2, y }, timeout: ACTION_TIMEOUT_MS }).catch(() => {});
        await locator.click({ position: { x: Math.max(2, box.width - 2), y }, timeout: ACTION_TIMEOUT_MS }).catch(() => {});
      }
      return;
    }
    case 'modal-backdrop':
      // Clicked only when it is the LAST unvisited fingerprint on screen (see `pickNext` below)
      // — "interact inside a Modal first, backdrop-dismiss last". Offset away from the sheet
      // (anchored `justifyContent:'flex-end'`, so the top-left corner is backdrop-only).
      await locator.click({ position: { x: 5, y: 5 }, timeout: ACTION_TIMEOUT_MS }).catch(() => {});
      return;
    case 'button':
    case 'pressable':
    default:
      await locator.click({ timeout: ACTION_TIMEOUT_MS }).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-screen sweep (task 4.2)
// ─────────────────────────────────────────────────────────────────────────────

function fingerprintKey(el: SweptElement): string {
  return `${el.kind}::${el.label}::${el.domPath}`;
}

function sortedUnvisited(elements: SweptElement[], visited: Set<string>): SweptElement[] {
  return elements.filter((el) => !visited.has(fingerprintKey(el))).sort((a, b) => fingerprintKey(a).localeCompare(fingerprintKey(b)));
}

/** Modal-aware pick (design D1): prefer any non-backdrop fingerprint; only pick a backdrop when
 *  it is the sole unvisited fingerprint left — realizes "interact inside first, dismiss last"
 *  without needing to know DOM nesting. */
function pickNext(unvisited: SweptElement[]): SweptElement {
  const nonBackdrop = unvisited.filter((el) => el.kind !== 'modal-backdrop');
  return nonBackdrop.length > 0 ? nonBackdrop[0] : unvisited[0];
}

interface ScreenSweepOutcome {
  actionsLog: SweptElement[];
  truncated: boolean;
  /** The resolved screen name once an in-sweep action changed it (nav-aware traversal), else
   *  `null` (the screen's own sweep ran to no-unvisited-fingerprints or its action cap). */
  navigatedTo: string | null;
}

/** Sweeps ONE currently-rendered screen: sorted-fingerprint order, one action per fingerprint,
 *  re-enumerate after every action, stop on no-unvisited / the per-screen cap / a detected
 *  navigation (spec requirement + design D1). */
async function sweepOneScreen(
  frame: Frame,
  screenName: string,
  obs: AttachedObservers,
  budgets: RunBudgets,
  opts: ResolvedSweepOptions,
): Promise<ScreenSweepOutcome> {
  const visited = new Set<string>();
  const actionsLog: SweptElement[] = [];

  while (actionsLog.length < opts.maxActionsPerScreen) {
    const elements = await enumerateInteractiveElements(frame);
    const unvisited = sortedUnvisited(elements, visited);
    if (unvisited.length === 0) return { actionsLog, truncated: false, navigatedTo: null };

    const next = pickNext(unvisited);
    await performAction(frame, next, opts);
    visited.add(fingerprintKey(next));
    actionsLog.push(next);

    await awaitQuiet(obs, budgets);
    const info = await getScreenInfo(frame).catch((): ScreenInfo => ({ declared: [], current: screenName }));
    if (info.current && info.current !== screenName) {
      return { actionsLog, truncated: false, navigatedTo: info.current };
    }
  }

  const remaining = await enumerateInteractiveElements(frame).catch(() => [] as SweptElement[]);
  const truncated = sortedUnvisited(remaining, visited).length > 0;
  return { actionsLog, truncated, navigatedTo: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cold-mount pass (task 4.4)
// ─────────────────────────────────────────────────────────────────────────────

/** Retargets the candidate's own `defineApp({...})` call at `screenName` — SAME component
 *  definitions (`ScreenComponent`s take no props, design D1), just a different `initial`, so
 *  `NavRoot` mounts that screen directly. `export default` is guaranteed exactly once at the top
 *  level (H1b bundle contract); this is a text-level retarget, not an AST rewrite (Class A — no
 *  `typescript` package dependency, which `synthrun/test/run.mjs`'s esbuild externals don't
 *  cover; see the acceptance suite's `external:['esbuild','playwright']`). */
function buildColdMountSource(source: string, screenName: string): string {
  const marker = 'export default';
  const idx = source.lastIndexOf(marker);
  if (idx === -1) {
    throw new Error('synthrun sweep: candidate source has no "export default" to retarget for cold-mount');
  }
  const rewritten = source.slice(0, idx) + 'const __whimHarnessColdMountSpec =' + source.slice(idx + marker.length);
  return `${rewritten}\nexport default { ...__whimHarnessColdMountSpec, initial: ${JSON.stringify(screenName)} };\n`;
}

async function waitForNewMount(obs: AttachedObservers, sinceEventCount: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const newEvents = obs.state.events.slice(sinceEventCount);
    if (newEvents.some((e) => e.kind === 'paint' || e.kind === 'error')) return;
    await sleep(30);
  }
}

/** Builds a cold-mount variant of `source` targeting `screenName`, delivers it into a FRESH
 *  realm via `__whimControl.reinject({reset:true, bundleSource})` (never in-place re-delivery,
 *  per T7), and resolves the newly-recreated app frame once it mounts (best-effort — a render
 *  failure there still surfaces as a `runtime_throw`/`mount_timeout` diagnostic through chain 2's
 *  already-attached observer, which this pass reuses unchanged). */
async function coldMountScreen(ctx: RunContext, obs: AttachedObservers, source: string, screenName: string, budgets: RunBudgets): Promise<Frame> {
  const coldSource = buildColdMountSource(source, screenName);
  const { js } = await buildCandidateSource(coldSource, { filenameHint: `${ctx.runId}-cold-${screenName}` });
  const sinceEventCount = obs.state.events.length;
  await ctx.page.evaluate((bundleJs: string) => {
    (
      globalThis as unknown as {
        __whimControl: { reinject(o: { reset: boolean; bundleSource: string }): void };
      }
    ).__whimControl.reinject({ reset: true, bundleSource: bundleJs });
  }, js);
  await waitForNewMount(obs, sinceEventCount, budgets.mountBudgetMs);
  return findAppFrame(ctx.page);
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level orchestration (tasks 4.2/4.3/4.4 composed)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sweeps the candidate already mounted on `ctx.page`: the nav-reachable live sweep first (a
 * single depth-first chain — an action's observed `__whimNavDepth` change is followed to the
 * newly-rendered screen, bounded by a visited-screen-NAME set so no screen is ever re-swept),
 * then a cold-mount pass (task 4.4) for every declared `spec.screens` entry the live sweep never
 * reached, each producing an `unreachable_screen` warning. `obs` must already be attached
 * (`attachObserversEarly`/`EarlyObservers.finish`, `handoff/observe-api.md`) — this function only
 * READS `obs.state`/calls `awaitQuiet`, it never attaches anything itself (chain 5 composes the
 * attachment via `RunOptions.beforeNavigate`, per the integration note this chain received).
 */
export async function sweepApp(ctx: RunContext, obs: AttachedObservers, source: string, budgets: RunBudgets, opts?: SweepOptions): Promise<SweepResult> {
  const resolved = resolveOptions(opts);
  const visited = new Set<string>();
  const perScreenMs: Record<string, number> = {};
  const actionsLog: SweptElement[] = [];
  let truncated = false;

  const frame = await findAppFrame(ctx.page);
  const seedInfo = await getScreenInfo(frame);
  const declared = seedInfo.declared;
  let liveFrame = frame;
  let currentName = seedInfo.current;

  while (currentName !== null && !visited.has(currentName)) {
    const name = currentName;
    visited.add(name);
    const start = Date.now();
    const outcome = await sweepOneScreen(liveFrame, name, obs, budgets, resolved);
    perScreenMs[name] = Date.now() - start;
    actionsLog.push(...outcome.actionsLog);
    if (outcome.truncated) truncated = true;
    currentName = outcome.navigatedTo && !visited.has(outcome.navigatedTo) ? outcome.navigatedTo : null;
  }

  const diagnostics: SweepDiagnostic[] = [];
  for (const name of declared) {
    if (visited.has(name)) continue;
    diagnostics.push({
      kind: 'unreachable_screen',
      severity: 'warning',
      message: `screen "${name}" was never reached via navigation — cold-mounted directly to cover it`,
      hint: 'add a reachable nav.navigate(...) path to this screen, or remove it if it is unused',
    });
    const start = Date.now();
    try {
      const coldFrame = await coldMountScreen(ctx, obs, source, name, budgets);
      const outcome = await sweepOneScreen(coldFrame, name, obs, budgets, resolved);
      actionsLog.push(...outcome.actionsLog);
      if (outcome.truncated) truncated = true;
    // eslint-disable-next-line no-restricted-syntax -- intentional: best-effort — the unreachable_screen diagnostic already recorded the failure, so move on rather than abort the sweep.
    } catch {
      // best-effort (a cold-mount build/deliver failure still leaves the unreachable_screen
      // diagnostic above) — move on to the next declared screen rather than aborting the sweep.
    }
    perScreenMs[name] = Date.now() - start;
    visited.add(name);
  }

  return { declaredScreens: declared, visitedScreens: [...visited], truncated, diagnostics, perScreenMs, actionsLog };
}
