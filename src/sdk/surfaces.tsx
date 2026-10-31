// ─────────────────────────────────────────────────────────────────────────────
// vc-sdk — layout/display surfaces (design sdk-design-system D5/D6; docs/design/system.md §7.2)
// ─────────────────────────────────────────────────────────────────────────────
// Sibling module to `index.tsx` (the barrel re-exports everything below — design D5: "New
// components live in ... src/sdk/surfaces.tsx ... re-exported through index.tsx"). Same two hard
// contracts as index.tsx/controls.tsx apply here: components accept TOKENS, not values
// (tokens.ts), and the only ambient capability touched is the one-way
// `ReactNativeWebView.postMessage` transport via `emitUiEvent` (constraint #2, shared from
// `events.ts` — not duplicated).
import * as React from 'react';
import { space, radius, color, textSize, textColor, activeTheme, FONT, TABULAR_NUMS, WEIGHT, type SpaceToken, type RadiusToken } from './tokens';
import { Glyph } from './icon';
import { emitUiEvent } from './events';
import { CONTROL_RESET, TAP_RESET, usePressed } from './press';
import { chromeInsetContext } from './chrome-inset';
import { inSheetContext, raisedShadow, stacks, tintSoft, touchTarget, typeStyle, useGroupSurface } from './kit';
import { LAYOUT, RADII, STATUS, type StatusName } from '../design/tokens';
import {
  canAnimate,
  commits,
  createSpring,
  fadeTiming,
  isRunning,
  joinHandlers,
  matrixTranslateY,
  motionElement,
  play,
  presentation,
  reduceMotion,
  releaseVelocity,
  retarget,
  rubberBand,
  springTiming,
  stop,
  translateY,
  usePressMotion,
  type MotionElement,
  type SpringValue,
} from './motion';

/** Groups separate by tone, never outlines; Increase Contrast adds a 1 px `border` (system.md §6). */
function groupOutline(): string {
  return activeTheme().increaseContrast ? `1px solid ${color('border')}` : 'none';
}

// ── Card ──────────────────────────────────────────────────────────────────────
// `surface` (`sheet-group` inside a Modal), r-lg, no border. No native button semantics (a generic
// container, not nested invalid HTML) — `onPress`, when present, makes the whole element
// clickable: emits the interaction over the one-way transport, then runs the app's own handler.
export interface CardProps {
  padding?: SpaceToken;
  /** @deprecated Cards take the system's radius; this is accepted and ignored. */
  radius?: RadiusToken;
  onPress?: () => void;
  children?: React.ReactNode;
}
export function Card({ padding = 'lg', onPress, children }: CardProps) {
  const surface = useGroupSurface();
  const { ref, ...press } = usePressMotion('card');
  return React.createElement(
    'div',
    {
      ref,
      onClick: onPress
        ? () => {
            emitUiEvent('press', 'card');
            onPress();
          }
        : undefined,
      ...(onPress ? press : {}),
      style: {
        boxSizing: 'border-box',
        padding: space(padding),
        borderRadius: radius('lg'),
        background: color(surface),
        border: groupOutline(),
        cursor: onPress ? 'pointer' : undefined,
        ...(onPress ? CONTROL_RESET : {}),
      },
    },
    children,
  );
}

// ── Divider ───────────────────────────────────────────────────────────────────
// A `separator` hairline, full width. No margin — spacing belongs to the surrounding `Stack`'s gap.
export function Divider() {
  return React.createElement('div', {
    style: {
      width: '100%',
      height: '1px',
      background: color('separator'),
      flexShrink: 0,
    },
  });
}

// ── Spacer ────────────────────────────────────────────────────────────────────
// An empty, growing element — the flex-layout equivalent of a spring, pushing siblings apart
// inside a `Stack`/`Row`.
export function Spacer() {
  return React.createElement('div', { style: { flexGrow: 1 } });
}

// ── Grid ──────────────────────────────────────────────────────────────────────
export interface GridProps {
  columns?: number;
  gap?: SpaceToken;
  children?: React.ReactNode;
}
export function Grid({ columns = 2, gap = 'md', children }: GridProps) {
  return React.createElement(
    'div',
    {
      style: {
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: space(gap),
      },
    },
    children,
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────────
// A capsule, 13/18 600, padding 3 × 9: the tone's soft fill under its text form. `neutral` is
// `fill` + `text-muted`, `primary` the tint's soft form; the status tones carry their icon so they
// never rest on colour alone (system.md §6).
export type BadgeTone = 'neutral' | 'primary' | 'positive' | 'warning' | 'danger';
export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
}
function isStatus(tone: string): tone is StatusName {
  return Object.hasOwn(STATUS, tone);
}
function badgeColors(tone: string): { background: string; color: string } {
  if (isStatus(tone)) return { background: color(`${tone}-soft`), color: textColor(tone) };
  if (tone === 'primary') return { background: tintSoft(), color: textColor('primary') };
  return { background: color('fill'), color: textColor('text-muted') };
}
export function Badge({ label, tone = 'neutral' }: BadgeProps) {
  const caption = textSize('caption');
  return React.createElement(
    'span',
    {
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: space('xs'),
        boxSizing: 'border-box',
        borderRadius: radius('full'),
        padding: '3px 9px',
        fontSize: caption.size,
        lineHeight: caption.line,
        letterSpacing: caption.tracking,
        fontWeight: WEIGHT.semibold,
        whiteSpace: 'nowrap',
        ...badgeColors(tone),
      },
    },
    isStatus(tone) ? React.createElement(Glyph, { key: 'icon', name: STATUS[tone].icon, sizePx: 12 }) : null,
    label,
  );
}

// ── ProgressBar ───────────────────────────────────────────────────────────────
/** Move `property` to `value` with `smooth` when the value changes after the first render (M24),
 *  from where it is on screen if it is still moving. Under Reduce Motion it is there at once. */
function useValueMotion(property: string, value: string): (node: unknown) => void {
  const element = React.useRef<unknown>(null);
  const was = React.useRef(value);
  React.useLayoutEffect(() => {
    const previous = was.current;
    was.current = value;
    const el = motionElement(element.current);
    if (!el || previous === value || reduceMotion()) return;
    const from = isRunning(el, 'value') ? presentation(el, [property])[property] : previous;
    play(el, 'value', [{ [property]: from }, { [property]: value }], springTiming('smooth'));
  }, [property, value]);
  return React.useCallback((node: unknown) => {
    element.current = node;
  }, []);
}

// `value` is clamped to [0, 1] before it ever reaches a style — an out-of-range prop can't
// overflow or invert the mark. `bar`: a 6 px `fill-strong` track with the tone's mark. `ring`: 120
// across, a 10 px round-capped stroke, the label centred in `title` (under the ring from 135%).
const BAR_HEIGHT = 6;
const RING_SIZE = 120;
const RING_STROKE = 10;

export interface ProgressBarProps {
  value: number;
  tone?: 'primary' | 'positive' | 'warning' | 'danger';
  variant?: 'bar' | 'ring';
  /** A short reading of the value ("7 of 10", "2:30"): above the bar, inside the ring. */
  label?: string;
}
function progressA11y(value: number, label: string | undefined): Record<string, unknown> {
  return {
    role: 'progressbar',
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': Math.round(value * 100),
    ...(label ? { 'aria-valuetext': label } : {}),
  };
}
function ProgressRing({ value, mark, label }: { value: number; mark: string; label?: string }) {
  const r = (RING_SIZE - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * r;
  const centre = RING_SIZE / 2;
  const title = textSize('title');
  const under = stacks();
  const offset = circumference * (1 - value);
  const arcRef = useValueMotion('strokeDashoffset', `${offset}px`);
  const labelEl = label
    ? React.createElement(
        'span',
        {
          key: 'label',
          style: {
            ...(under ? {} : { position: 'absolute', top: 0, left: 0, width: '100%', height: `${RING_SIZE}px` }),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: title.size,
            lineHeight: title.line,
            letterSpacing: title.tracking,
            fontWeight: WEIGHT.bold,
            color: textColor('text'),
            ...TABULAR_NUMS,
          },
        },
        label,
      )
    : null;
  return React.createElement(
    'div',
    {
      ...progressA11y(value, label),
      style: { position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: space('sm'), alignSelf: 'center' },
    },
    React.createElement(
      'svg',
      { key: 'ring', width: RING_SIZE, height: RING_SIZE, viewBox: `0 0 ${RING_SIZE} ${RING_SIZE}`, 'aria-hidden': true, style: { display: 'block' } },
      React.createElement('circle', { cx: centre, cy: centre, r, fill: 'none', stroke: color('fill-strong'), strokeWidth: RING_STROKE }),
      // A round cap on an empty arc would still draw a dot, so nothing is drawn at 0.
      value > 0
        ? React.createElement('circle', {
            ref: arcRef,
            cx: centre,
            cy: centre,
            r,
            fill: 'none',
            stroke: mark,
            strokeWidth: RING_STROKE,
            strokeLinecap: 'round',
            strokeDasharray: circumference,
            strokeDashoffset: offset,
            transform: `rotate(-90 ${centre} ${centre})`,
          })
        : null,
    ),
    labelEl,
  );
}
export function ProgressBar({ value, tone = 'primary', variant = 'bar', label }: ProgressBarProps) {
  const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const mark = color(tone);
  if (variant === 'ring') return React.createElement(ProgressRing, { value: clamped, mark, label });
  return React.createElement(ProgressLine, { value: clamped, mark, label });
}

function ProgressLine({ value: clamped, mark, label }: { value: number; mark: string; label?: string }) {
  const markRef = useValueMotion('width', `${clamped * 100}%`);
  const bar = React.createElement(
    'div',
    {
      key: 'track',
      style: {
        width: '100%',
        height: `${BAR_HEIGHT}px`,
        borderRadius: radius('full'),
        background: color('fill-strong'),
        overflow: 'hidden',
      },
    },
    React.createElement('span', {
      ref: markRef,
      style: {
        display: 'block',
        width: `${clamped * 100}%`,
        height: '100%',
        borderRadius: radius('full'),
        background: mark,
      },
    }),
  );
  const caption = textSize('caption');
  return React.createElement(
    'div',
    { ...progressA11y(clamped, label), style: { display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' } },
    label
      ? React.createElement(
          'span',
          { key: 'label', style: { fontSize: caption.size, lineHeight: caption.line, color: textColor('text-muted'), ...TABULAR_NUMS } },
          label,
        )
      : null,
    bar,
  );
}

// ── List / ListItem ───────────────────────────────────────────────────────────
// An inset group (`surface`, `sheet-group` inside a Modal, r-lg, no border) with a `separator`
// hairline between rows, inset 16 (52 when the row has an icon). Two forms:
//  - children: `<List><ListItem …/>…</List>` — static, never animates;
//  - keyed: `<List items={rows} keyBy="id" renderItem={(row) => <ListItem …/>} />` — each row keeps
//    its identity by its key, so rows can enter and leave with motion. Duplicate keys, or keys that
//    are just the array index, record a diagnostic and switch that list's motion off for good.
type ListKey = string | number;

/** The property names of `T` whose values can be a row's key. */
type ListKeyName<T> = { [K in keyof T]-?: T[K] extends ListKey ? K : never }[keyof T] & string;

interface StaticListProps {
  children?: React.ReactNode;
  items?: undefined;
  keyBy?: undefined;
  renderItem?: undefined;
}
interface KeyedListProps<T> {
  items: readonly T[];
  /** A property of each item that is unique and stable (an id), or a function returning one. */
  keyBy: ListKeyName<T> | ((item: T) => ListKey);
  renderItem: (item: T, index: number) => React.ReactNode;
  children?: undefined;
}
export type ListProps<T = unknown> = StaticListProps | KeyedListProps<T>;

/** Why a keyed list's keys can't carry motion, or undefined when they can. */
function keyProblem(keys: readonly ListKey[]): string | undefined {
  const seen = new Set<string>();
  for (const key of keys) {
    const id = `${typeof key}:${key}`;
    if (seen.has(id)) return `the key ${JSON.stringify(key)} is used by two rows`;
    seen.add(id);
  }
  if (keys.length > 1 && keys.every((key, i) => String(key) === String(i))) {
    return 'the keys are the rows’ positions, so a removed row would take another row’s place';
  }
  return undefined;
}

function keyOf<T>(item: T, keyBy: KeyedListProps<T>['keyBy']): ListKey | undefined {
  const key = typeof keyBy === 'function' ? keyBy(item) : (item as Record<string, unknown> | null)?.[keyBy];
  if (typeof key === 'string') return key;
  return typeof key === 'number' && !Number.isNaN(key) ? key : undefined;
}

interface KeyedRows {
  rows: { key: string; node: React.ReactNode }[];
  /** Whether rows may animate in and out: off once the keys were ever unusable. */
  motion: boolean;
}

/** The rows of a keyed list, each under a React key unique within the list, and whether its keys
 *  can carry motion. A missing, duplicate or positional key records one diagnostic and turns the
 *  list's motion off for the rest of its life (the rows still render, with unique React keys). */
function useKeyedRows<T>(items: readonly T[], keyBy: KeyedListProps<T>['keyBy'], renderItem: KeyedListProps<T>['renderItem']): KeyedRows {
  const motionOff = React.useRef(false);
  const list = Array.isArray(items) ? items : [];
  const keys = list.map((item) => keyOf(item, keyBy));
  const missing = keys.indexOf(undefined);
  const problem = missing === -1 ? keyProblem(keys as ListKey[]) : `row ${missing} has no string or number key`;
  React.useEffect(() => {
    if (problem === undefined || motionOff.current) return;
    motionOff.current = true;
    console.warn(`vc-sdk List: ${problem}; this list will not animate. Key rows by a unique id (keyBy="id").`);
  }, [problem]);
  const used = new Map<string, number>();
  const rows = list.map((item, i) => {
    const base = keys[i] === undefined ? `index:${i}` : `${typeof keys[i]}:${keys[i]}`;
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    return { key: n === 0 ? base : `${base}#${n}`, node: renderItem(item, i) };
  });
  return { rows, motion: problem === undefined && !motionOff.current };
}

function rowInset(node: React.ReactNode): number {
  const icon = React.isValidElement<{ icon?: unknown }>(node) && node.type === ListItem && typeof node.props.icon === 'string' && node.props.icon !== '';
  return icon ? LAYOUT.separatorInsetWithIcon : LAYOUT.separatorInset;
}

function separator(node: React.ReactNode, first: boolean): React.ReactElement | null {
  return first
    ? null
    : React.createElement('div', {
        'aria-hidden': true,
        style: { position: 'absolute', top: 0, left: `${rowInset(node)}px`, right: 0, height: '1px', background: color('separator') },
      });
}

function listRow(key: React.Key, node: React.ReactNode, first: boolean): React.ReactElement {
  return React.createElement('div', { key, style: { position: 'relative' } }, separator(node, first), node);
}

// ── Keyed list motion (system.md §4.4 M24) ────────────────────────────────────
// A row that mounts after the list's first render rises 8 px and fades in; a row whose item went
// stays drawn in its place while it fades out (`fade-out`), and then the rows below close the gap
// (FLIP: each is drawn where it was and springs to its new place with `smooth`). Under Reduce
// Motion rows only fade, and the gap closes at once. A list whose keys can't carry identity never
// animates.
interface DrawnRow {
  key: string;
  node: React.ReactNode;
  leaving: boolean;
}

/** The rows to draw: the current rows in order, plus every row that just left, kept in its old
 *  place (after the nearest earlier row still drawn) until its leave motion has ended (`gone`). */
function withLeavingRows(previous: readonly DrawnRow[], current: readonly { key: string; node: React.ReactNode }[], gone: ReadonlySet<string>): DrawnRow[] {
  const present = new Set(current.map((row) => row.key));
  const drawn: DrawnRow[] = current.map((row) => ({ ...row, leaving: false }));
  previous.forEach((row, i) => {
    if (present.has(row.key) || gone.has(row.key)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const before = drawn.findIndex((r) => r.key === previous[j].key);
      if (before !== -1) {
        at = before + 1;
        break;
      }
    }
    drawn.splice(at, 0, { key: row.key, node: row.node, leaving: true });
  });
  return drawn;
}

interface KeyedRowProps {
  rowKey: string;
  node: React.ReactNode;
  first: boolean;
  leaving: boolean;
  /** Whether this row arrived after the list first rendered (only those enter with motion). */
  enters: boolean;
  register: (key: string, el: MotionElement | null) => void;
  onLeft: (key: string) => void;
}

function KeyedRow({ rowKey, node, first, leaving, enters, register, onLeft }: KeyedRowProps) {
  const element = React.useRef<MotionElement | null>(null);
  const ref = React.useCallback(
    (n: unknown) => {
      element.current = motionElement(n);
      register(rowKey, element.current);
    },
    [rowKey, register],
  );
  const shownLeaving = React.useRef<boolean | null>(null);
  React.useLayoutEffect(() => {
    const el = element.current;
    const previous = shownLeaving.current;
    shownLeaving.current = leaving;
    if (!el) return;
    if (previous === null) {
      if (!enters) return;
      play(el, 'fade', [{ opacity: 0 }, { opacity: 1 }], fadeTiming('in'));
      if (!reduceMotion()) play(el, 'rise', [{ transform: 'translateY(8px)' }, { transform: 'none' }], springTiming('smooth'));
      return;
    }
    if (previous === leaving) return;
    if (leaving) {
      retarget(el, 'fade', { opacity: 0 }, fadeTiming('out'), { fill: 'forwards', onDone: () => onLeft(rowKey) });
    } else {
      // Back before it finished leaving: it fades back from where it is.
      retarget(el, 'fade', { opacity: 1 }, fadeTiming('in'));
    }
  }, [leaving, enters, onLeft, rowKey]);
  return React.createElement(
    'div',
    { ref, ...(leaving ? { 'aria-hidden': true } : {}), style: { position: 'relative', ...(leaving ? { pointerEvents: 'none' } : {}) } },
    separator(node, first),
    node,
  );
}

/** The group's own height moves on the same spring as its rows, so its edge and everything under
 *  the list travel with them instead of jumping. Returns the group's resting height. */
function resizeGroup(box: MotionElement, restingBefore: number | null, moving: boolean): number {
  const running = isRunning(box, 'height');
  if (!moving && !running) return box.getBoundingClientRect().height;
  const shown = running ? Number.parseFloat(String(presentation(box, ['height']).height)) : restingBefore;
  stop(box, 'height');
  const natural = box.getBoundingClientRect().height;
  if (moving && shown !== null && Math.abs(shown - natural) >= 0.5) {
    play(box, 'height', [{ height: `${shown}px` }, { height: `${natural}px` }], springTiming('smooth'));
  }
  return natural;
}

/** FLIP: each row that moved is drawn where it was (running motion included) and springs home. */
function closeGaps(elements: ReadonlyMap<string, MotionElement>, before: ReadonlyMap<string, number>, after: ReadonlyMap<string, number>): void {
  for (const [key, top] of after) {
    const was = before.get(key);
    const el = elements.get(key);
    if (was === undefined || !el) continue;
    const shown = was + translateY(presentation(el, ['translate']).translate as string);
    if (Math.abs(shown - top) < 0.5) continue;
    play(el, 'flip', [{ translate: `0px ${shown - top}px` }, { translate: '0px 0px' }], springTiming('smooth'));
  }
}

function KeyedList<T>({ items, keyBy, renderItem }: KeyedListProps<T>) {
  const { rows, motion } = useKeyedRows(items, keyBy, renderItem);
  const animate = motion && canAnimate();
  const drawnRef = React.useRef<DrawnRow[]>([]);
  const gone = React.useRef(new Set<string>());
  const [, redraw] = React.useReducer((n: number) => n + 1, 0);
  const mounted = React.useRef(false);
  const elements = React.useRef(new Map<string, MotionElement>());
  const tops = React.useRef(new Map<string, number>());
  const lastOrder = React.useRef<string | null>(null);
  const group = React.useRef<MotionElement | null>(null);
  const groupHeight = React.useRef<number | null>(null);
  const groupRef = React.useCallback((node: unknown) => {
    group.current = motionElement(node);
  }, []);

  const drawn = animate ? withLeavingRows(drawnRef.current, rows, gone.current) : rows.map((row) => ({ ...row, leaving: false }));
  const order = drawn.map((row) => row.key).join('\n');

  const register = React.useCallback((key: string, el: MotionElement | null) => {
    if (el) elements.current.set(key, el);
    else elements.current.delete(key);
  }, []);
  const onLeft = React.useCallback((key: string) => {
    gone.current.add(key);
    redraw();
  }, []);

  React.useLayoutEffect(() => {
    drawnRef.current = drawn;
    gone.current.clear();
    const changed = lastOrder.current !== null && lastOrder.current !== order;
    lastOrder.current = order;
    const nextTops = new Map<string, number>();
    for (const [key, el] of elements.current) nextTops.set(key, el.offsetTop);
    const moving = changed && animate && !reduceMotion();
    if (group.current) groupHeight.current = resizeGroup(group.current, groupHeight.current, moving);
    if (moving) closeGaps(elements.current, tops.current, nextTops);
    tops.current = nextTops;
    mounted.current = true;
  });

  // Rows that arrive after the first render enter with motion; with motion off, none do.
  const enters = animate && mounted.current;
  return React.createElement(
    ListGroup,
    { motion, groupRef },
    drawn.map((row, i) =>
      React.createElement(KeyedRow, { key: row.key, rowKey: row.key, node: row.node, first: i === 0, leaving: row.leaving, enters, register, onLeft }),
    ),
  );
}

function ListGroup({ motion, groupRef, children }: { motion?: boolean; groupRef?: (node: unknown) => void; children?: React.ReactNode }) {
  const surface = useGroupSurface();
  return React.createElement(
    'div',
    {
      ...(groupRef ? { ref: groupRef } : {}),
      ...(motion === undefined ? {} : { 'data-list-motion': motion ? 'on' : 'off' }),
      style: {
        boxSizing: 'border-box',
        borderRadius: radius('lg'),
        background: color(surface),
        border: groupOutline(),
        overflow: 'hidden',
        // Rows measure their place within the group (offsetTop) for the gap-closing motion.
        position: 'relative',
      },
    },
    children,
  );
}

export function List<T>(props: ListProps<T>) {
  if (props.items !== undefined) return React.createElement(KeyedList<T>, props as KeyedListProps<T>);
  const items = React.Children.toArray(props.children);
  return React.createElement(
    ListGroup,
    null,
    // `React.Children.toArray` already gives every element a stable, position-scoped key — reuse
    // it (falling back to the index only for a non-element child, which carries no key of its own).
    items.map((child, i) => listRow(React.isValidElement(child) && child.key !== null ? child.key : i, child, i === 0)),
  );
}

export interface ListItemProps {
  title: string;
  subtitle?: string;
  trailing?: string;
  /** An icon name, drawn at 20 in `text-muted` before the title. */
  icon?: string;
  /** Makes the row pressable; it then shows a `chevron-right`. */
  onPress?: () => void;
}
/** ListItem's leading icon, when it has one (system.md §7.1 grouped list: 20 pt `text-2`). */
function listItemIcon(name: string | undefined): React.ReactElement[] {
  return name ? [React.createElement(Glyph, { key: 'icon', name, sizePx: 20, colorValue: textColor('text-muted') })] : [];
}
function listItemText(title: string, subtitle: string | undefined): React.ReactElement {
  const body = textSize('body');
  const caption = textSize('caption');
  return React.createElement(
    'div',
    { key: 'text', style: { display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 } },
    React.createElement('span', { style: { fontSize: body.size, lineHeight: body.line, color: textColor('text') } }, title),
    subtitle
      ? React.createElement('span', { key: 'subtitle', style: { fontSize: caption.size, lineHeight: caption.line, color: textColor('text-muted') } }, subtitle)
      : null,
  );
}
function listItemTrailing(trailing: string | undefined): React.ReactElement | null {
  if (!trailing) return null;
  return React.createElement(
    'span',
    { key: 'trailing', style: { ...typeStyle('callout'), color: textColor('text-muted'), flexShrink: 0, ...TABULAR_NUMS } },
    trailing,
  );
}
export function ListItem({ title, subtitle, trailing, icon, onPress }: ListItemProps) {
  const { pressed, pressHandlers } = usePressed();
  const { ref, ...press } = usePressMotion('row');
  const pressable = onPress
    ? {
        onClick: () => {
          emitUiEvent('press', title);
          onPress();
        },
        ...joinHandlers(pressHandlers, press),
      }
    : {};
  return React.createElement(
    'div',
    {
      ref,
      ...pressable,
      style: {
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: space('md'),
        minHeight: `${LAYOUT.listRowMinHeight}px`,
        padding: `${LAYOUT.listRowPaddingVertical}px ${LAYOUT.listRowPaddingHorizontal}px`,
        ...(onPress ? { cursor: 'pointer', background: pressed ? color('fill') : undefined, ...CONTROL_RESET } : {}),
      },
    },
    ...listItemIcon(icon),
    listItemText(title, subtitle),
    listItemTrailing(trailing),
    onPress ? React.createElement(Glyph, { key: 'chevron', name: 'chevron-right', sizePx: 20, colorValue: textColor('text-muted') }) : null,
  );
}

// ── EmptyState ────────────────────────────────────────────────────────────────
// The "nothing here yet" placeholder every record-backed screen needs: an optional 32 icon in a 64
// `fill` disc, the title in `subtitle`, the hint in `callout` `text-muted`, centred, padding 32.
export interface EmptyStateProps {
  /** An icon name, drawn at 32 in a 64 circle above the title. */
  icon?: string;
  title: string;
  hint?: string;
}
function EmptyStateIcon({ name }: { name: string }) {
  return React.createElement(
    'div',
    {
      style: {
        width: '64px',
        height: '64px',
        borderRadius: radius('full'),
        background: color('fill'),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: space('xs'),
      },
    },
    React.createElement(Glyph, { name, sizePx: 32, colorValue: textColor('text-muted') }),
  );
}
export function EmptyState({ icon, title, hint }: EmptyStateProps) {
  const subtitle = textSize('subtitle');
  return React.createElement(
    'div',
    {
      style: {
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: space('sm'),
        padding: space('xl'),
      },
    },
    icon ? React.createElement(EmptyStateIcon, { key: 'icon', name: icon }) : null,
    React.createElement(
      'span',
      {
        key: 'title',
        style: { fontSize: subtitle.size, lineHeight: subtitle.line, letterSpacing: subtitle.tracking, fontWeight: WEIGHT.semibold, color: textColor('text') },
      },
      title,
    ),
    hint ? React.createElement('span', { key: 'hint', style: { ...typeStyle('callout'), color: textColor('text-muted') } }, hint) : null,
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────
// Renders `null` when hidden — a mini-app conditionally renders a `Modal` the same way it would
// any other component, no imperative show/hide API. The sheet anatomy of system.md §7.1: `sheet`
// with r-xl top corners over the `scrim`, a grabber, an optional `title2` title, a close button that
// always calls `onClose`, and the content on `sheet-group` groups, padded at the bottom by the
// host's chrome inset so its last action is never under the orb. A scrim tap or Escape closes it.
//
// Motion (M11 via M24): the sheet rises from below with `smooth` and the scrim fades with it; it
// leaves the same way, drawn until it is gone. The grabber row drags it 1:1 after 10 px (rubber-band
// above its place); a release dismisses when its projected end passes half the sheet and its velocity
// doesn't point back, handing that velocity to the `fling` spring, and otherwise springs back. Every
// motion starts from where the sheet is. Reduce Motion: a 160 ms cross-fade; a drag still tracks.
const GRABBER = { width: 36, height: 5, top: 6 };
const CLOSE_DISC = 30;
/** How far a press on the grabber row moves before it is a drag (rule 6). */
const DRAG_SLOP = 10;

interface DragPointerEvent {
  clientY: number;
  timeStamp: number;
  pointerId: number;
  currentTarget: { setPointerCapture(pointerId: number): void };
}

interface SheetDrag {
  startY: number;
  /** Set once the press passed the slop: where the finger and the sheet were then. */
  origin: { pointerY: number; sheetY: number } | null;
  samples: { t: number; y: number }[];
}

interface SheetMotion {
  rendered: boolean;
  exiting: boolean;
  sheetRef: (node: unknown) => void;
  scrimRef: (node: unknown) => void;
  dragHandlers: {
    onPointerDown: (e: DragPointerEvent) => void;
    onPointerMove: (e: DragPointerEvent) => void;
    onPointerUp: (e: DragPointerEvent) => void;
    onPointerCancel: (e: DragPointerEvent) => void;
  };
}

function useSheetMotion(visible: boolean, close: () => void): SheetMotion {
  const [exiting, setExiting] = React.useState(false);
  const [shownVisible, setShownVisible] = React.useState(visible);
  if (shownVisible !== visible) {
    setShownVisible(visible);
    // Kept on screen for its exit only where the exit can play.
    setExiting(!visible && canAnimate());
  }
  const rendered = visible || exiting;

  const sheet = React.useRef<MotionElement | null>(null);
  const scrim = React.useRef<MotionElement | null>(null);
  const spring = React.useRef<SpringValue | null>(null);
  const drag = React.useRef<SheetDrag | null>(null);
  const visibleRef = React.useRef(visible);
  visibleRef.current = visible;
  const wasRendered = React.useRef(false);

  const height = (): number => sheet.current?.getBoundingClientRect().height || 1;
  /** Where the sheet is drawn now, below its place (px). */
  const shownY = (el: MotionElement): number => matrixTranslateY(presentation(el, ['transform']).transform as string);
  const place = (y: number): void => {
    if (sheet.current) sheet.current.style.transform = y === 0 ? '' : `translateY(${y}px)`;
    if (scrim.current) scrim.current.style.opacity = y === 0 ? '' : String(Math.max(0, Math.min(1, 1 - y / height())));
  };
  /** Take the sheet and scrim from WAAPI at the frame they show, for a drag or a spring. */
  const hold = (): number => {
    const el = sheet.current;
    if (!el) return 0;
    const y = shownY(el);
    stop(el, 'slide');
    if (scrim.current) stop(scrim.current, 'fade');
    place(y);
    return y;
  };
  const springTo = (target: number, velocity: number, from: number, onRest: () => void): void => {
    spring.current?.stop();
    const s = createSpring('fling', place, from);
    s.onRest = () => {
      spring.current = null;
      onRest();
    };
    spring.current = s;
    s.to(target, velocity);
  };
  const finishExit = (): void => {
    if (!visibleRef.current) setExiting(false);
  };

  React.useLayoutEffect(() => {
    const fresh = !wasRendered.current;
    wasRendered.current = rendered;
    const el = sheet.current;
    const veil = scrim.current;
    if (!rendered || !el || !veil) return;
    const reduced = reduceMotion();
    if (visible) {
      spring.current?.stop();
      spring.current = null;
      if (reduced) {
        place(0);
        if (fresh) {
          play(el, 'fade', [{ opacity: 0 }, { opacity: 1 }], fadeTiming('in'));
          play(veil, 'fade', [{ opacity: 0 }, { opacity: 1 }], fadeTiming('in'));
        } else {
          retarget(el, 'fade', { opacity: 1 }, fadeTiming('in'));
          retarget(veil, 'fade', { opacity: 1 }, fadeTiming('in'));
        }
        return;
      }
      const smooth = springTiming('smooth');
      if (fresh) {
        play(el, 'slide', [{ transform: 'translateY(100%)' }, { transform: 'none' }], smooth);
        play(veil, 'fade', [{ opacity: 0 }, { opacity: 1 }], smooth);
        return;
      }
      const y = hold();
      place(0);
      play(el, 'slide', [{ transform: `translateY(${y}px)` }, { transform: 'none' }], smooth);
      retarget(veil, 'fade', { opacity: 1 }, smooth);
      return;
    }
    // Leaving. A drag that already committed is carrying it out on the spring.
    if (spring.current && spring.current.target > 0) return;
    if (reduced) {
      retarget(el, 'fade', { opacity: 0 }, fadeTiming('in'), { fill: 'forwards', onDone: finishExit });
      retarget(veil, 'fade', { opacity: 0 }, fadeTiming('in'), { fill: 'forwards' });
      return;
    }
    const smooth = springTiming('smooth');
    const y = hold();
    place(0);
    play(el, 'slide', [{ transform: `translateY(${y}px)` }, { transform: 'translateY(100%)' }], smooth, { fill: 'forwards', onDone: finishExit });
    retarget(veil, 'fade', { opacity: 0 }, smooth, { fill: 'forwards' });
    // `place`, `hold` and `finishExit` read refs only; the motion is decided by these two values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, rendered]);

  React.useEffect(() => () => spring.current?.stop(), []);

  const release = (e: DragPointerEvent): void => {
    const d = drag.current;
    drag.current = null;
    if (!d?.origin || !sheet.current) return;
    // The release itself is the last sample: a finger that stopped before lifting has no velocity.
    d.samples.push({ t: e.timeStamp, y: e.clientY });
    const y = shownY(sheet.current);
    const velocity = releaseVelocity(d.samples);
    const h = height();
    if (commits(y, velocity, h / 2)) {
      close();
      if (reduceMotion()) {
        const el = sheet.current;
        retarget(el, 'fade', { opacity: 0 }, fadeTiming('in'), { fill: 'forwards', onDone: finishExit });
        if (scrim.current) retarget(scrim.current, 'fade', { opacity: 0 }, fadeTiming('in'), { fill: 'forwards' });
        return;
      }
      springTo(h, velocity, y, () => {
        // An app that kept it open after onClose gets it back.
        if (visibleRef.current) springTo(0, 0, h, () => undefined);
        else finishExit();
      });
      return;
    }
    if (reduceMotion()) {
      place(0);
      return;
    }
    springTo(0, velocity, y, () => undefined);
  };

  return {
    rendered,
    exiting,
    sheetRef: React.useCallback((node: unknown) => {
      sheet.current = motionElement(node);
    }, []),
    scrimRef: React.useCallback((node: unknown) => {
      scrim.current = motionElement(node);
    }, []),
    dragHandlers: {
      onPointerDown: (e) => {
        if (!visibleRef.current) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { startY: e.clientY, origin: null, samples: [{ t: e.timeStamp, y: e.clientY }] };
      },
      onPointerMove: (e) => {
        const d = drag.current;
        if (!d) return;
        d.samples.push({ t: e.timeStamp, y: e.clientY });
        if (d.samples.length > 8) d.samples.shift();
        if (!d.origin) {
          if (Math.abs(e.clientY - d.startY) < DRAG_SLOP) return;
          spring.current?.stop();
          spring.current = null;
          d.origin = { pointerY: e.clientY, sheetY: hold() };
        }
        const y = d.origin.sheetY + e.clientY - d.origin.pointerY;
        place(y < 0 ? rubberBand(y, height()) : y);
      },
      onPointerUp: release,
      onPointerCancel: release,
    },
  };
}

export interface ModalProps {
  visible: boolean;
  title?: string;
  onClose: () => void;
  children?: React.ReactNode;
}
export function Modal({ visible, title, onClose, children }: ModalProps) {
  const chromeInset = React.useContext(chromeInsetContext());
  const latestClose = React.useRef(onClose);
  latestClose.current = onClose;
  const close = React.useCallback(() => latestClose.current(), []);
  const motion = useSheetMotion(visible, close);
  const { ref: closePressRef, ...closePress } = usePressMotion('icon');
  React.useEffect(() => {
    if (!visible) return undefined;
    type KeyListener = (e: { key?: unknown }) => void;
    const target = globalThis as {
      addEventListener?: (type: 'keydown', listener: KeyListener) => void;
      removeEventListener?: (type: 'keydown', listener: KeyListener) => void;
    };
    if (typeof target.addEventListener !== 'function' || typeof target.removeEventListener !== 'function') return undefined;
    const onKey: KeyListener = (e) => {
      if (e.key === 'Escape') latestClose.current();
    };
    target.addEventListener('keydown', onKey);
    return () => target.removeEventListener?.('keydown', onKey);
  }, [visible]);
  if (!motion.rendered) return null;

  const target = touchTarget();
  const closeButton = React.createElement(
    'button',
    {
      key: 'close',
      type: 'button',
      'aria-label': 'Close',
      ref: closePressRef,
      ...closePress,
      onClick: () => {
        emitUiEvent('press', 'Close');
        onClose();
      },
      style: {
        width: `${target}px`,
        height: `${target}px`,
        flexShrink: 0,
        margin: 0,
        padding: 0,
        border: 'none',
        background: 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        color: textColor('text'),
        ...CONTROL_RESET,
      },
    },
    React.createElement(
      'span',
      {
        style: {
          width: `${CLOSE_DISC}px`,
          height: `${CLOSE_DISC}px`,
          borderRadius: radius('full'),
          background: color('fill'),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        },
      },
      React.createElement(Glyph, { name: 'x', sizePx: 20 }),
    ),
  );
  const head = React.createElement(
    'div',
    {
      key: 'head',
      ...motion.dragHandlers,
      style: {
        touchAction: 'none',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space('sm'),
        minHeight: `${LAYOUT.headerRowHeight}px`,
        padding: `${GRABBER.top}px ${space('sm')} 0 ${LAYOUT.gutter}px`,
        flexShrink: 0,
      },
    },
    title
      ? React.createElement('h2', { key: 'title', style: { margin: 0, ...typeStyle('title2'), color: textColor('text') } }, title)
      : React.createElement('span', { key: 'title' }),
    closeButton,
  );
  const bottom = chromeInset > 0 ? `calc(${space('lg')} + ${chromeInset}px)` : space('lg');
  return React.createElement(
    'div',
    {
      onClick: onClose,
      style: {
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        // A sheet on its way out no longer holds the screen under it.
        ...(motion.exiting ? { pointerEvents: 'none' } : {}),
        ...TAP_RESET,
      },
    },
    React.createElement('div', {
      key: 'scrim',
      ref: motion.scrimRef,
      'aria-hidden': true,
      style: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: color('scrim') },
    }),
    React.createElement(
      'div',
      {
        key: 'sheet',
        ref: motion.sheetRef,
        role: 'dialog',
        'aria-modal': true,
        ...(title ? { 'aria-label': title } : {}),
        onClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
        style: {
          position: 'relative',
          boxSizing: 'border-box',
          width: '100%',
          maxHeight: '92%',
          display: 'flex',
          flexDirection: 'column',
          background: color('sheet'),
          borderTopLeftRadius: `${RADII.xl.radius}px`,
          borderTopRightRadius: `${RADII.xl.radius}px`,
          boxShadow: raisedShadow(),
          fontFamily: FONT,
          color: textColor('text'),
          ...TAP_RESET,
        },
      },
      React.createElement('div', {
        key: 'grabber',
        'aria-hidden': true,
        style: {
          position: 'absolute',
          top: `${GRABBER.top}px`,
          left: '50%',
          width: `${GRABBER.width}px`,
          height: `${GRABBER.height}px`,
          marginLeft: `-${GRABBER.width / 2}px`,
          borderRadius: radius('full'),
          background: color('fill-strong'),
        },
      }),
      head,
      React.createElement(
        'div',
        {
          key: 'body',
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: space('md'),
            padding: `${space('md')} ${LAYOUT.gutter}px ${bottom}`,
            overflowY: 'auto',
            // A scroll inside the sheet never chains to the screen under it.
            overscrollBehavior: 'contain',
          },
        },
        React.createElement(inSheetContext().Provider, { value: true }, children),
      ),
    ),
  );
}
