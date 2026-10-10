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
import type { Frame, Locator, Page } from 'playwright';
import { NAV_CALL_SHAPES } from '../checks/contract';
import type { RunBudgets, SweepCounts } from './contract';
import type { RunContext } from './session';
import { buildCandidateSource } from './builder';
import { type AttachedObservers, awaitQuiet, noteActivity } from './observe';

// ─────────────────────────────────────────────────────────────────────────────
// Fingerprints (spec: "(component kind, label/accessible text, DOM path)")
// ─────────────────────────────────────────────────────────────────────────────

export type SweepElementKind =
  | 'button'
  | 'text-input'
  | 'number-input'
  | 'select'
  | 'date-input'
  | 'time-input'
  | 'datetime-input'
  | 'switch'
  | 'checkbox'
  | 'slider'
  | 'pressable'
  | 'modal-backdrop'
  | 'nav-back';

export interface SweptElement {
  kind: SweepElementKind;
  label: string;
  /** A `#whim-root`-rooted `nth-child` CSS path — both the fingerprint's DOM-path component
   *  AND a directly-usable `Frame.locator()` selector. */
  domPath: string;
}

/** The accessible name of the SDK header's Back button: the `label: 'Back'` `ScreenHeader` gives
 *  its `HeaderButton` (`src/sdk/index.tsx`). The SDK exports no constant for it, so this is a copy;
 *  the sweep suite detects it from a real SDK-rendered pushed screen, so a rename turns it red. */
const NAV_BACK_LABEL = 'Back';

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
  /** Toasts the sweep waited out in the whole run: an audit field, not part of the report. */
  toastWaits: number;
  /** Every fingerprint acted on, in execution order — the determinism/audit trail. A Modal
   *  backdrop dismissed a second time appears twice. */
  actionsLog: SweptElement[];
  /** The declared screens only the cold-mount pass covered: a subset of `visitedScreens`. */
  coldMountedScreens: string[];
  /** Whole-run counts: actions taken, fingerprints never acted on, actions that failed. */
  sweep: SweepCounts;
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
  /** The declared-screen names of every screen page currently mounted under `#whim-root`, in
   *  DOM order — one entry per distinct mounted screen INSTANCE (resolved by walking each child
   *  node's `__reactFiber$…` return chain and matching component references `===`). Two entries
   *  mean a push/pop transition is in flight: the SDK keeps the leaving screen mounted beside the
   *  arriving one until the motion ends (`NavRoot`, system.md §4.4 M24). */
  mounted: string[];
  /** The screen on top of the navigation stack — the sole mounted screen, or `null` while
   *  nothing is mounted OR a transition is in flight (DOM order cannot tell the top: a push lays
   *  the covered screen out first, a pop lays the leaving one out last). Read through
   *  `awaitSettledScreen` to wait a transition out. */
  current: string | null;
}

/** Runs entirely inside the candidate's frame. No DOM lib types exist in this project's
 *  tsconfig (RN base lib) — minimal ad-hoc shapes only, mirroring `observe.ts`. */
export async function getScreenInfo(frame: Frame): Promise<ScreenInfo> {
  return frame.evaluate((): ScreenInfo => {
    interface Fiber {
      type: unknown;
      return: Fiber | null;
      alternate: Fiber | null;
    }
    interface DomNode {
      childNodes: ArrayLike<DomNode>;
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
    /** The nearest declared-screen fiber above `node`, or `null` (e.g. the toast host). */
    function screenOf(node: DomNode): { fiber: Fiber; name: string } | null {
      const record = node as unknown as Record<string, unknown>;
      const fiberKey = Object.keys(record).find((k) => k.indexOf('__reactFiber$') === 0);
      for (let f: Fiber | null = fiberKey ? (record[fiberKey] as Fiber) : null; f; f = f.return) {
        const name = screenNameForType(f.type);
        if (name) return { fiber: f, name };
      }
      return null;
    }
    const root = w.document.getElementById('whim-root');
    // One entry per mounted screen instance. A screen rendering a fragment owns several root
    // children; React's double-buffered fibers mean two of them may reach the same instance
    // through its `alternate`, so identity is checked both ways.
    const instances: { fiber: Fiber; name: string }[] = [];
    const children = root ? root.childNodes : [];
    for (let i = 0; i < children.length; i += 1) {
      const screen = screenOf(children[i]);
      if (screen && !instances.some((s) => s.fiber === screen.fiber || s.fiber === screen.fiber.alternate)) instances.push(screen);
    }
    const mounted = instances.map((s) => s.name);
    return { declared, mounted, current: mounted.length === 1 ? mounted[0] : null };
  });
}

/** Upper bound on one push/pop transition — the SDK's longest is its `smooth` spring (~0.6 s);
 *  the margin covers a loaded CI host. Past it the screen is reported unsettled (`current:
 *  null`), which the sweep reads as "no navigation", never as a different screen. */
const SETTLE_TIMEOUT_MS = 3000;

/** `getScreenInfo` once no navigation transition is in flight (at most one screen mounted), so
 *  the caller sees the stack's top and enumerates only its elements — never the leaving screen's
 *  inert, `position:fixed` layer, whose `nth-child` paths go stale the moment it unmounts. */
export async function awaitSettledScreen(frame: Frame, timeoutMs = SETTLE_TIMEOUT_MS): Promise<ScreenInfo> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const info = await getScreenInfo(frame);
    if (info.mounted.length <= 1 || Date.now() >= deadline) return info;
    await sleep(30);
  }
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
 *   - `select` / `input[type=date|time|datetime-local]` → select / date-input / time-input / datetime-input
 *                                          (a Picker's and a DateInput's transparent native control)
 *   - `[role=switch|checkbox]`          → switch / checkbox (Switch/Checkbox set these explicitly)
 *   - `button:not([disabled])`          → button (covers plain `Button` AND every
 *                                          `SegmentedControl` option — each is its own fingerprint,
 *                                          so sweeping every button already "selects every option"),
 *                                          or nav-back for the SDK header's text-less Back button
 *   - the label is the element's text, or its `aria-label` when it has none
 *   - inline `style.touchAction:'none'` → slider (unique to `Slider`'s touch-area div)
 *   - inline `style.position:'fixed'`   → modal-backdrop (unique to `Modal`'s backdrop div; the
 *                                          toast host is fixed too but `role="status"`, and no fingerprint)
 *   - inline `style.cursor:'pointer'`, excluding the above → pressable (`Card`/`ListItem` with
 *     `onPress`; inline (not computed/inherited) `style.cursor` is only ever set by the element
 *     ITSELF, never inherited from an ancestor, so this cannot false-positive on a pressable's
 *     children).
 */
export async function enumerateInteractiveElements(frame: Frame): Promise<SweptElement[]> {
  return frame.evaluate((backLabel: string): SweptElement[] => {
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
    /** The element's text, or its accessible name when it shows none, or `fallback`. */
    function nameOf(el: DomNode, fallback: string): string {
      return textOf(el) || el.getAttribute('aria-label') || fallback;
    }
    const seen = new Set<string>();
    function push(kind: SweepElementKind, label: string, el: DomNode): void {
      const path = cssPath(el);
      if (seen.has(path)) return;
      seen.add(path);
      results.push({ kind, label: label || '(unlabeled)', domPath: path });
    }

    root.querySelectorAll('*').forEach((el) => {
      if (el.style && el.style.position === 'fixed' && el.getAttribute('role') !== 'status') push('modal-backdrop', 'modal', el);
    });
    root.querySelectorAll('input[type="text"]').forEach((el) => {
      push('text-input', fieldLabel(el) || el.placeholder || '(text)', el);
    });
    root.querySelectorAll('input[type="number"]').forEach((el) => {
      push('number-input', fieldLabel(el) || '(number)', el);
    });
    // A Picker's transparent native <select> and a DateInput's native input lie over a field box
    // that is itself a plain div (no cursor, not fixed), so the box is never a fingerprint of its
    // own: only the native control is.
    root.querySelectorAll('select:not([disabled])').forEach((el) => {
      push('select', el.getAttribute('aria-label') || fieldLabel(el) || '(select)', el);
    });
    root.querySelectorAll('input[type="date"]').forEach((el) => {
      push('date-input', el.getAttribute('aria-label') || fieldLabel(el) || '(date)', el);
    });
    root.querySelectorAll('input[type="time"]').forEach((el) => {
      push('time-input', el.getAttribute('aria-label') || fieldLabel(el) || '(time)', el);
    });
    root.querySelectorAll('input[type="datetime-local"]').forEach((el) => {
      push('datetime-input', el.getAttribute('aria-label') || fieldLabel(el) || '(datetime)', el);
    });
    root.querySelectorAll('[role="switch"]').forEach((el) => push('switch', nameOf(el, 'switch'), el));
    root.querySelectorAll('[role="checkbox"]').forEach((el) => push('checkbox', nameOf(el, 'checkbox'), el));
    root.querySelectorAll('button:not([disabled])').forEach((el) => {
      const isBack = textOf(el) === '' && el.getAttribute('aria-label') === backLabel;
      push(isBack ? 'nav-back' : 'button', nameOf(el, '(button)'), el);
    });
    root.querySelectorAll('div').forEach((el) => {
      if (el.style && el.style.touchAction === 'none') push('slider', fieldLabel(el) || 'slider', el);
    });
    root.querySelectorAll('div').forEach((el) => {
      const roleHandled = el.getAttribute('role') === 'switch' || el.getAttribute('role') === 'checkbox';
      if (el.style && el.style.cursor === 'pointer' && !roleHandled && el.style.position !== 'fixed') {
        push('pressable', nameOf(el, '(pressable)'), el);
      }
    });

    return results;
  }, NAV_BACK_LABEL);
}

// ─────────────────────────────────────────────────────────────────────────────
// Hit test (spec: "The sweep acts only on an element that can receive the action")
// ─────────────────────────────────────────────────────────────────────────────

/** Where on a `Modal` backdrop the dismissing click lands, from its top-left corner — away from
 *  the sheet (anchored `justifyContent:'flex-end'`, so the top-left corner is backdrop-only). The
 *  hit test probes the same point the click will use. */
const BACKDROP_CLICK_OFFSET_PX = 5;
/** How far in from each end of a `Slider`'s track the low and high clicks land. */
const SLIDER_EDGE_PX = 2;

interface HitProbe {
  items: { domPath: string; kind: SweepElementKind }[];
  backdropOffset: number;
  sliderEdge: number;
}

/** Waits, up to `capMs`, until no finite animation is running in the candidate's frame. The quiet
 *  window cannot see motion: a Modal's sheet is still sliding in when the window closes, and
 *  testing its controls then reads them as covered or off screen, so the backdrop (which a fixed
 *  layer lets pass at once) would be dismissed before they are used. An animation that never ends
 *  (a spinner) is not waited for, and the cap bounds the rest. */
async function awaitMotionStill(frame: Frame, capMs: number): Promise<void> {
  const deadline = Date.now() + capMs;
  while (Date.now() < deadline) {
    const moving = await frame
      .evaluate((): number => {
        interface Animation {
          playState: string;
          effect: { getComputedTiming(): { iterations: number } } | null;
        }
        const doc = (globalThis as unknown as { document: { getAnimations(): Animation[] } }).document;
        return doc.getAnimations().filter((a) => a.playState !== 'finished' && a.effect !== null && Number.isFinite(a.effect.getComputedTiming().iterations)).length;
      })
      .catch(() => 0);
    if (moving === 0) return;
    await sleep(30);
  }
}

/** Index of the first of `candidates` (in the given order) that can receive its action right now,
 *  or -1. Runs entirely inside the candidate's frame: the element is scrolled into view, then it
 *  passes only if it has a non-empty box, is not `disabled`, has no ancestor-or-self with
 *  `aria-hidden="true"`, and the topmost element at every point the action will use is the
 *  element itself or one of its descendants. No DOM lib types exist here — minimal shapes only. */
async function firstActionableIndex(frame: Frame, candidates: SweptElement[]): Promise<number> {
  const probe: HitProbe = {
    items: candidates.map((el) => ({ domPath: el.domPath, kind: el.kind })),
    backdropOffset: BACKDROP_CLICK_OFFSET_PX,
    sliderEdge: SLIDER_EDGE_PX,
  };
  return frame.evaluate((arg: HitProbe): number => {
    interface Rect {
      left: number;
      top: number;
      width: number;
      height: number;
    }
    interface DomNode {
      disabled?: boolean;
      getBoundingClientRect(): Rect;
      scrollIntoView(options: { block: string; inline: string; behavior: string }): void;
      closest(selector: string): DomNode | null;
      contains(other: unknown): boolean;
    }
    interface DomDocument {
      querySelector(selector: string): DomNode | null;
      elementFromPoint(x: number, y: number): unknown;
    }
    const doc = (globalThis as unknown as { document: DomDocument }).document;
    function pointsOf(kind: SweepElementKind, r: Rect): [number, number][] {
      if (kind === 'modal-backdrop') return [[r.left + arg.backdropOffset, r.top + arg.backdropOffset]];
      if (kind === 'slider') {
        const y = r.top + Math.max(1, r.height / 2);
        return [
          [r.left + arg.sliderEdge, y],
          [r.left + Math.max(arg.sliderEdge, r.width - arg.sliderEdge), y],
        ];
      }
      return [[r.left + r.width / 2, r.top + r.height / 2]];
    }
    function receives(item: HitProbe['items'][number]): boolean {
      const el = doc.querySelector(item.domPath);
      if (!el) return false;
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || el.disabled === true) return false;
      if (el.closest('[aria-hidden="true"]')) return false;
      return pointsOf(item.kind, rect).every(([x, y]) => {
        const hit = doc.elementFromPoint(x, y);
        return hit === el || el.contains(hit);
      });
    }
    return arg.items.findIndex(receives);
  }, probe);
}

async function firstActionable(frame: Frame, candidates: SweptElement[]): Promise<SweptElement | null> {
  if (candidates.length === 0) return null;
  const index = await firstActionableIndex(frame, candidates);
  return index >= 0 ? candidates[index] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-fingerprint action recipes (spec: tap / type / toggle-both / select-each / drag-both /
// modal-inside-first-backdrop-last)
// ─────────────────────────────────────────────────────────────────────────────

const ACTION_TIMEOUT_MS = 3000;

/** The fixed values typed into a DateInput's native input, in that input's own value format. */
const CANONICAL_DATE = '2026-01-15';
const CANONICAL_TIME = '09:30';
const CANONICAL_DATETIME = '2026-01-15T09:30';

/** Chooses a `Picker`'s first enabled option with a non-empty value that is not already selected,
 *  through the driver's select-option call: a click on the transparent native `<select>` only
 *  opens a popup the page cannot see. A select with no such option is left alone. */
async function chooseFirstOption(locator: Locator): Promise<void> {
  interface SelectNode {
    options: ArrayLike<{ disabled: boolean; selected: boolean; value: string }>;
  }
  const value = await locator.evaluate(
    (select: unknown): string | null => {
      const { options } = select as SelectNode;
      for (let i = 0; i < options.length; i += 1) {
        if (!options[i].disabled && !options[i].selected && options[i].value !== '') return options[i].value;
      }
      return null;
    },
    undefined,
    { timeout: ACTION_TIMEOUT_MS },
  );
  if (value !== null) await locator.selectOption({ value }, { timeout: ACTION_TIMEOUT_MS });
}

async function clickSliderEnds(locator: Locator): Promise<void> {
  const box = await locator.boundingBox({ timeout: ACTION_TIMEOUT_MS });
  if (!box) throw new Error('synthrun sweep: slider has no box');
  const y = Math.max(1, box.height / 2);
  await locator.click({ position: { x: SLIDER_EDGE_PX, y }, timeout: ACTION_TIMEOUT_MS });
  await locator.click({ position: { x: Math.max(SLIDER_EDGE_PX, box.width - SLIDER_EDGE_PX), y }, timeout: ACTION_TIMEOUT_MS });
}

/** Performs the recipe for one fingerprint; throws when the driver cannot complete it. */
async function performAction(frame: Frame, el: SweptElement, opts: ResolvedSweepOptions): Promise<void> {
  const locator = frame.locator(el.domPath);
  switch (el.kind) {
    case 'text-input':
      await locator.fill(opts.canonicalText, { timeout: ACTION_TIMEOUT_MS });
      return;
    case 'number-input':
      await locator.fill(String(opts.canonicalNumber), { timeout: ACTION_TIMEOUT_MS });
      return;
    case 'date-input':
      await locator.fill(CANONICAL_DATE, { timeout: ACTION_TIMEOUT_MS });
      return;
    case 'time-input':
      await locator.fill(CANONICAL_TIME, { timeout: ACTION_TIMEOUT_MS });
      return;
    case 'datetime-input':
      await locator.fill(CANONICAL_DATETIME, { timeout: ACTION_TIMEOUT_MS });
      return;
    case 'select':
      await chooseFirstOption(locator);
      return;
    case 'switch':
    case 'checkbox':
      // toggle on, then off (spec: "toggle Switch/Checkbox on and off") — same DOM node, its
      // `aria-checked` flips; this stays ONE fingerprint-visit, not two.
      await locator.click({ timeout: ACTION_TIMEOUT_MS });
      await locator.click({ timeout: ACTION_TIMEOUT_MS });
      return;
    case 'slider':
      await clickSliderEnds(locator);
      return;
    case 'modal-backdrop':
      await locator.click({ position: { x: BACKDROP_CLICK_OFFSET_PX, y: BACKDROP_CLICK_OFFSET_PX }, timeout: ACTION_TIMEOUT_MS });
      return;
    case 'button':
    case 'pressable':
    case 'nav-back':
    default:
      await locator.click({ timeout: ACTION_TIMEOUT_MS });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-screen sweep (task 4.2)
// ─────────────────────────────────────────────────────────────────────────────

function fingerprintKey(el: SweptElement): string {
  return `${el.kind}::${el.label}::${el.domPath}`;
}

function byFingerprint(a: SweptElement, b: SweptElement): number {
  return fingerprintKey(a).localeCompare(fingerprintKey(b));
}

/** Most times one DOM path of a screen is acted on, however its label changes (design D9): a label
 *  that carries a running value mints a new fingerprint at the same path on every press. */
const MAX_ACTIONS_PER_PATH = 3;

/** The groups fingerprints are tried in (design D5), earlier first: rows and cards, then value
 *  controls, then buttons, then the controls that leave what is on screen — a `Modal` backdrop
 *  before the header's Back button. */
const KIND_GROUP: Record<SweepElementKind, number> = {
  pressable: 0,
  'text-input': 1,
  'number-input': 1,
  select: 1,
  'date-input': 1,
  'time-input': 1,
  'datetime-input': 1,
  slider: 1,
  switch: 1,
  checkbox: 1,
  button: 2,
  'modal-backdrop': 3,
  'nav-back': 4,
};

/** A fingerprint at a DOM path already acted on `MAX_ACTIONS_PER_PATH` times is retired: never
 *  acted on, never keeping the screen's sweep open, never blocked. A backdrop is exempt, its
 *  re-dismissal has its own bound (see `pickNext`). */
function isRetired(el: SweptElement, progress: ScreenProgress): boolean {
  return el.kind !== 'modal-backdrop' && (progress.pathActs.get(el.domPath) ?? 0) >= MAX_ACTIONS_PER_PATH;
}

function sortedUnvisited(elements: SweptElement[], progress: ScreenProgress): SweptElement[] {
  return elements.filter((el) => !progress.visited.has(fingerprintKey(el)) && !isRetired(el, progress)).sort(byFingerprint);
}

/** The order unvisited fingerprints are TRIED in (design D2/D5): by group, then sorted fingerprint
 *  inside a group, so a Modal's own controls are used before it is dismissed and nothing that
 *  leaves the screen precedes a control on it. A fingerprint tried and found unable to receive its
 *  action is skipped for this pick only (see `pickNext`), never visited. */
function orderUnvisited(elements: SweptElement[], progress: ScreenProgress): SweptElement[] {
  return sortedUnvisited(elements, progress).sort((a, b) => KIND_GROUP[a.kind] - KIND_GROUP[b.kind] || byFingerprint(a, b));
}

/** What the whole run has seen and done, for the report's counts. Fingerprints are scoped by the
 *  screen they were enumerated on: two screens can render the same kind, label and path. */
interface SweepLedger {
  seen: Set<string>;
  acted: Set<string>;
  /** Fingerprints retired by the per-path limit: they are not blocked, they are spent. */
  retired: Set<string>;
  failedActions: number;
  /** Toasts the sweep has waited out so far, in the whole run (`MAX_TOAST_WAITS_PER_RUN`). */
  toastWaits: number;
}

function newLedger(): SweepLedger {
  return { seen: new Set<string>(), acted: new Set<string>(), retired: new Set<string>(), failedActions: 0, toastWaits: 0 };
}

function ledgerKey(screenName: string, el: SweptElement): string {
  return `${screenName}::${fingerprintKey(el)}`;
}

function noteSeen(ledger: SweepLedger, screenName: string, elements: SweptElement[], progress: ScreenProgress): void {
  for (const el of elements) {
    ledger.seen.add(ledgerKey(screenName, el));
    if (isRetired(el, progress)) ledger.retired.add(ledgerKey(screenName, el));
  }
}

/** What a sweep has learned so far: the one record of a run's sweep. `sweepApp` keeps it current as
 *  it goes and the caller owns it, so a sweep abandoned mid-way (the total budget killed the page)
 *  still leaves the screens it reached and the counts it had. `SweepResult` is derived from it
 *  (`sweepResultOf`), so the two cannot disagree. */
export interface SweepAccumulator {
  /** Every screen the app declares, once the first read of the live app module has resolved. */
  declared: string[];
  /** Screens entered, live or by cold mount, as they are entered. */
  visited: Set<string>;
  /** The cold-mounted subset of `visited`, in the order they were mounted. */
  coldMounted: string[];
  /** Time spent on each screen, kept current after every action. */
  perScreenMs: Record<string, number>;
  /** Every fingerprint acted on, in execution order. */
  actionsLog: SweptElement[];
  truncated: boolean;
  diagnostics: SweepDiagnostic[];
  ledger: SweepLedger;
}

export function newSweepAccumulator(): SweepAccumulator {
  return { declared: [], visited: new Set<string>(), coldMounted: [], perScreenMs: {}, actionsLog: [], truncated: false, diagnostics: [], ledger: newLedger() };
}

/** The sweep's counts so far: `blocked` is what has been seen and not acted on yet, which for a
 *  finished sweep is what was never acted on. */
export function sweepCountsOf(acc: SweepAccumulator): SweepCounts {
  const { ledger } = acc;
  return {
    actions: acc.actionsLog.length,
    blocked: [...ledger.seen].filter((key) => !ledger.acted.has(key) && !ledger.retired.has(key)).length,
    failedActions: ledger.failedActions,
  };
}

/** A copy of the accumulator in `SweepResult` shape: later writes to `acc` (an abandoned sweep that
 *  has not noticed its page is gone) do not reach it. */
export function sweepResultOf(acc: SweepAccumulator): SweepResult {
  return {
    declaredScreens: [...acc.declared],
    visitedScreens: [...acc.visited],
    coldMountedScreens: [...acc.coldMounted],
    truncated: acc.truncated,
    diagnostics: [...acc.diagnostics],
    perScreenMs: { ...acc.perScreenMs },
    toastWaits: acc.ledger.toastWaits,
    actionsLog: [...acc.actionsLog],
    sweep: sweepCountsOf(acc),
  };
}

interface ScreenSweepOutcome {
  truncated: boolean;
  /** The resolved screen name once an in-sweep action changed it (nav-aware traversal), else
   *  `null` (the screen's own sweep ran to no-unvisited-fingerprints or its action cap). */
  navigatedTo: string | null;
}

/** One declared screen's sweep progress, kept across visits: a screen left by navigation and
 *  entered again (a hub after its first spoke's Back) resumes where it stopped instead of being
 *  re-swept or abandoned. Its fingerprint set and action count are what bound the live sweep. */
interface ScreenProgress {
  visited: Set<string>;
  actions: number;
  /** Fingerprints acted on since the last `Modal` backdrop dismissal on this screen (all of them,
   *  before the first one). A backdrop already visited may be dismissed again only when this is
   *  above zero. */
  actedSinceDismissal: number;
  /** Times each DOM path was acted on, whatever its label was then (`MAX_ACTIONS_PER_PATH`). */
  pathActs: Map<string, number>;
}

function newScreenProgress(): ScreenProgress {
  return { visited: new Set<string>(), actions: 0, actedSinceDismissal: 0, pathActs: new Map<string, number>() };
}

/** The next fingerprint to act on, or `null` when none can receive its action right now (design D2).
 *
 *  The first unvisited fingerprint, in `orderUnvisited` order, that can receive its action. One
 *  that cannot is deferred: it is neither visited nor counted, so a later pick takes it once it
 *  can (a control under an open Modal, after the Modal is dismissed).
 *
 *  When unvisited fingerprints remain and none can, a `Modal` backdrop that was already visited
 *  may be dismissed once more — a second trigger can reopen a Modal at the same path — but only if
 *  something was acted on since the previous dismissal. Otherwise the answer is `null`; what a
 *  `null` ends is decided by `sweepOneScreen`, whose comment holds the termination argument. */
async function pickNext(frame: Frame, elements: SweptElement[], progress: ScreenProgress): Promise<SweptElement | null> {
  const ordered = orderUnvisited(elements, progress);
  if (ordered.length === 0) return null;
  const pick = await firstActionable(frame, ordered);
  if (pick !== null || progress.actedSinceDismissal === 0) return pick;
  const dismissed = elements.filter((el) => el.kind === 'modal-backdrop' && progress.visited.has(fingerprintKey(el))).sort(byFingerprint);
  return firstActionable(frame, dismissed);
}

/** How long the sweep waits for a toast to leave: the SDK shows one for four seconds (`TOAST_MS` in
 *  `src/sdk/toast.tsx`, which the SDK's index does not re-export and the sweep does not import),
 *  plus the time it takes to sink out. */
const TOAST_WAIT_CAP_MS = 5000;

/** How many toasts the sweep waits out in one run, across all its screens. The number of waits is
 *  bounded by this count and never by the clock, so toasts cannot spend the run's total budget:
 *  each wait costs up to `TOAST_WAIT_CAP_MS` of it. Which control a toast still covers when the
 *  sweep looks does depend on when the toast leaves, and once both waits are spent a covered
 *  control is reached only if its toast is gone at the next look: the one place the action
 *  sequence is not fully determined. */
const MAX_TOAST_WAITS_PER_RUN = 2;

/** Before a stuck screen is looked at once more: waits, up to `TOAST_WAIT_CAP_MS`, for the SDK's
 *  toast host to leave, if one is showing and the run has a wait left (`ledger.toastWaits`, spent
 *  only when a toast was showing). A toast lies over the bottom of the screen and takes every click
 *  aimed there, but it is no fingerprint of its own: the controls under it are only late. Whether
 *  the toast is gone by the next look is up to the clock, which the wait bounds but cannot decide. */
async function awaitToastGone(frame: Frame, ledger: SweepLedger): Promise<void> {
  if (ledger.toastWaits >= MAX_TOAST_WAITS_PER_RUN) return;
  const showing = (): Promise<boolean> =>
    frame
      .evaluate(() => (globalThis as unknown as { document: { querySelector(selector: string): unknown } }).document.querySelector('[role="status"]') !== null)
      .catch(() => false);
  if (!(await showing())) return;
  ledger.toastWaits += 1;
  const deadline = Date.now() + TOAST_WAIT_CAP_MS;
  while (Date.now() < deadline && (await showing())) await sleep(30);
}

/** Acts on `el` and books it: a recipe the driver could not complete is a failed action (counted,
 *  never discarded) and the fingerprint is still visited, so the sweep always progresses. */
async function act(frame: Frame, screenName: string, el: SweptElement, progress: ScreenProgress, ledger: SweepLedger, opts: ResolvedSweepOptions): Promise<void> {
  const failed = await performAction(frame, el, opts).then(
    () => false,
    () => true,
  );
  if (failed) ledger.failedActions += 1;
  progress.visited.add(fingerprintKey(el));
  ledger.acted.add(ledgerKey(screenName, el));
  progress.actions += 1;
  if (el.kind !== 'modal-backdrop') progress.pathActs.set(el.domPath, (progress.pathActs.get(el.domPath) ?? 0) + 1);
  progress.actedSinceDismissal = el.kind === 'modal-backdrop' ? 0 : progress.actedSinceDismissal + 1;
}

/** Sweeps ONE currently-rendered screen: group-then-sorted-fingerprint order, one action per
 *  fingerprint, re-enumerate after every action, stop on no-actionable-fingerprint / the per-screen
 *  cap / a detected navigation (spec requirement + design D1/D2). `progress` carries the screen's
 *  earlier visits. Everything it does is booked into `acc` as it goes, so a run killed mid-screen
 *  still reports the actions and time spent here.
 *
 *  A pass that finds nothing to act on while unvisited fingerprints remain goes round the loop once
 *  more, with no action spent: the page may have moved on since that first look (a toast left, a
 *  sheet finished sliding), and a toast showing is waited for first (`awaitToastGone`). A second
 *  empty pass in a row ends the screen, not truncated.
 *
 *  Why this ends: every pass either acts, which spends one of the screen's `maxActionsPerScreen`
 *  and grows the visited set or the re-dismissals (`pickNext`), or finds nothing. Each stuck state
 *  gets one retry and only an action re-arms it, never time, so retries are bounded by actions, and
 *  actions are capped. The sweep's callers add no unbounded loop of their own: a screen is entered
 *  again only after an action navigated to it or a back step (never more than actions) returned. */
async function sweepOneScreen(
  frame: Frame,
  screenName: string,
  progress: ScreenProgress,
  obs: AttachedObservers,
  budgets: RunBudgets,
  opts: ResolvedSweepOptions,
  acc: SweepAccumulator,
): Promise<ScreenSweepOutcome> {
  const startedAt = Date.now();
  const spentBefore = acc.perScreenMs[screenName] ?? 0;
  const stamp = (): void => {
    acc.perScreenMs[screenName] = spentBefore + Date.now() - startedAt;
  };
  stamp();
  let retried = false;

  while (progress.actions < opts.maxActionsPerScreen) {
    await awaitMotionStill(frame, budgets.actionHardCapMs);
    const elements = await enumerateInteractiveElements(frame);
    noteSeen(acc.ledger, screenName, elements, progress);
    const next = await pickNext(frame, elements, progress);
    if (next === null) {
      if (retried || orderUnvisited(elements, progress).length === 0) {
        stamp();
        return { truncated: false, navigatedTo: null };
      }
      retried = true;
      await awaitToastGone(frame, acc.ledger);
      continue;
    }
    retried = false;

    await act(frame, screenName, next, progress, acc.ledger, opts);
    acc.actionsLog.push(next);
    stamp();

    // The action is itself activity: what it sets going (a frame, a storage call) reaches the host
    // after the driver call returns, and a window measured only from earlier activity can close
    // before any of it has arrived.
    noteActivity(obs.state);
    await awaitQuiet(obs, budgets);
    const info = await awaitSettledScreen(frame).catch((): ScreenInfo => ({ declared: [], mounted: [screenName], current: screenName }));
    if (info.current && info.current !== screenName) {
      stamp();
      return { truncated: false, navigatedTo: info.current };
    }
  }

  const remaining = await enumerateInteractiveElements(frame).catch(() => [] as SweptElement[]);
  noteSeen(acc.ledger, screenName, remaining, progress);
  const truncated = sortedUnvisited(remaining, progress).length > 0;
  stamp();
  return { truncated, navigatedTo: null };
}

/** The navigation-stack depth the SDK last announced (`__whimNavDepth`, relayed by the outer
 *  page as `nav-depth`), or 0 when none arrived. A hint for whether a back step can go anywhere,
 *  never authority over which screen is shown — that is always re-read from the fiber tree. */
function latestNavDepth(obs: AttachedObservers): number {
  for (let i = obs.state.events.length - 1; i >= 0; i -= 1) {
    const e = obs.state.events[i];
    if (e.kind !== 'nav-depth') continue;
    const depth = (e.payload as { depth?: unknown } | null)?.depth;
    return typeof depth === 'number' ? depth : 0;
  }
  return 0;
}

/** Pops one screen through the host's own system-back channel (`__whimControl.navBack`, the frame
 *  the device back button sends) and resolves the screen it settles on. */
async function navigateBack(ctx: RunContext, frame: Frame, obs: AttachedObservers, budgets: RunBudgets): Promise<string | null> {
  await ctx.page.evaluate(() => {
    (globalThis as unknown as { __whimControl: { navBack(): void } }).__whimControl.navBack();
  });
  await awaitQuiet(obs, budgets);
  const info = await awaitSettledScreen(frame).catch(() => null);
  return info ? info.current : null;
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

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when some navigate call in `source` names `screenName` as its string-literal target, in any
 *  quote style. It keys on the method (`NAV_CALL_SHAPES`), not the receiver, so an aliased or
 *  namespaced receiver counts. A text scan, not a parse: a call inside a comment counts too, which
 *  errs toward no warning. */
function navigateNamesScreen(source: string, screenName: string): boolean {
  const methods = NAV_CALL_SHAPES.filter((shape) => shape.argIndex === 0).map((shape) => escapeRegExp(shape.method));
  if (methods.length === 0) return false;
  const call = new RegExp(String.raw`\b(?:${methods.join('|')})\s*\(\s*(['"\x60])${escapeRegExp(screenName)}\1`);
  return call.test(source);
}

/** The warning for a declared screen no navigate call names: the candidate has no path to it, so the
 *  hint is true and one repair turn can act on it. */
function unreachableScreenDiagnostic(name: string): SweepDiagnostic {
  return {
    kind: 'unreachable_screen',
    severity: 'warning',
    message: `screen "${name}" was never reached via navigation — cold-mounted directly to cover it`,
    hint: 'add a reachable nav.navigate(...) path to this screen, or remove it if it is unused',
  };
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
  const frame = await findAppFrame(ctx.page);
  await awaitQuiet(obs, budgets);
  return frame;
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level orchestration (tasks 4.2/4.3/4.4 composed)
// ─────────────────────────────────────────────────────────────────────────────

/** The nav-reachable live sweep, from the screen the app mounted on (see `sweepApp`). */
async function sweepLive(
  ctx: RunContext,
  frame: Frame,
  firstScreen: string | null,
  obs: AttachedObservers,
  budgets: RunBudgets,
  opts: ResolvedSweepOptions,
  acc: SweepAccumulator,
): Promise<void> {
  const progress = new Map<string, ScreenProgress>();
  let currentName = firstScreen;
  let backSteps = 0;
  while (currentName !== null) {
    const name = currentName;
    acc.visited.add(name);
    const screenProgress = progress.get(name) ?? newScreenProgress();
    progress.set(name, screenProgress);
    const outcome = await sweepOneScreen(frame, name, screenProgress, obs, budgets, opts, acc);
    if (outcome.truncated) acc.truncated = true;
    if (outcome.navigatedTo) {
      currentName = outcome.navigatedTo;
      continue;
    }
    // This screen is done: return to the one below it, as the system back button would, so a
    // sibling reachable only from a screen further down is still reached live. Every pop undoes a
    // push some action caused, so back steps never outnumber actions — the nav-depth hint is
    // unauthenticated (F4) and a candidate claiming a deeper stack cannot loop the sweep.
    if (backSteps >= acc.actionsLog.length || latestNavDepth(obs) <= 0) return;
    backSteps += 1;
    currentName = await navigateBack(ctx, frame, obs, budgets);
  }
}

/**
 * Sweeps the candidate already mounted on `ctx.page`: the nav-reachable live sweep first (depth
 * first — an action that changes the settled screen is followed to it; a screen entered again
 * resumes its own remaining fingerprints rather than being re-swept; a finished screen steps
 * back to the one below it while the SDK reports one, so every sibling of a hub is reached),
 * then a cold-mount pass (task 4.4) for every declared `spec.screens` entry the live sweep never
 * reached; the ones no `navigate` call in `source` names also produce an `unreachable_screen`
 * warning. `obs` must already be attached
 * (`attachObserversEarly`/`EarlyObservers.finish`, `handoff/observe-api.md`) — this function only
 * READS `obs.state`/calls `awaitQuiet`, it never attaches anything itself (chain 5 composes the
 * attachment via `RunOptions.beforeNavigate`, per the integration note this chain received).
 *
 * `acc` is the caller's: the sweep books everything it learns into it as it goes (declared screens
 * once known, a screen as it is entered, every action, the time spent), so a caller that abandons
 * this promise — the total budget killed the page — still reads how far the sweep got. The
 * returned `SweepResult` is `sweepResultOf(acc)` at the end, never a second record.
 */
export async function sweepApp(
  ctx: RunContext,
  obs: AttachedObservers,
  source: string,
  budgets: RunBudgets,
  opts?: SweepOptions,
  acc: SweepAccumulator = newSweepAccumulator(),
): Promise<SweepResult> {
  const resolved = resolveOptions(opts);

  const frame = await findAppFrame(ctx.page);
  // A mount-time read must have resolved before the first enumeration, or what the sweep finds
  // depends on a race (and a control gated on that read is never seen).
  await awaitQuiet(obs, budgets);
  const seedInfo = await awaitSettledScreen(frame);
  acc.declared = seedInfo.declared;
  await sweepLive(ctx, frame, seedInfo.current, obs, budgets, resolved, acc);

  for (const name of acc.declared) {
    if (acc.visited.has(name)) continue;
    if (!navigateNamesScreen(source, name)) acc.diagnostics.push(unreachableScreenDiagnostic(name));
    acc.visited.add(name);
    acc.coldMounted.push(name);
    const start = Date.now();
    acc.perScreenMs[name] = 0;
    try {
      const coldFrame = await coldMountScreen(ctx, obs, source, name, budgets);
      const outcome = await sweepOneScreen(coldFrame, name, newScreenProgress(), obs, budgets, resolved, acc);
      if (outcome.truncated) acc.truncated = true;
    // eslint-disable-next-line no-restricted-syntax -- intentional: best-effort — the unreachable_screen diagnostic already recorded the failure, so move on rather than abort the sweep.
    } catch {
      // best-effort (a cold-mount build/deliver failure still leaves the unreachable_screen
      // diagnostic above) — move on to the next declared screen rather than aborting the sweep.
    }
    acc.perScreenMs[name] = Date.now() - start;
  }

  return sweepResultOf(acc);
}
