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
  // The press dip until the press motion replaces it.
  const { pressed, pressHandlers } = usePressed();
  return React.createElement(
    'div',
    {
      onClick: onPress
        ? () => {
            emitUiEvent('press', 'card');
            onPress();
          }
        : undefined,
      ...(onPress ? pressHandlers : {}),
      style: {
        boxSizing: 'border-box',
        padding: space(padding),
        borderRadius: radius('lg'),
        background: color(surface),
        border: groupOutline(),
        cursor: onPress ? 'pointer' : undefined,
        opacity: onPress && pressed ? 0.8 : 1,
        transition: 'opacity 80ms',
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
            cx: centre,
            cy: centre,
            r,
            fill: 'none',
            stroke: mark,
            strokeWidth: RING_STROKE,
            strokeLinecap: 'round',
            strokeDasharray: circumference,
            strokeDashoffset: circumference * (1 - value),
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

function listRow(key: React.Key, node: React.ReactNode, first: boolean): React.ReactElement {
  return React.createElement(
    'div',
    { key, style: { position: 'relative' } },
    first
      ? null
      : React.createElement('div', {
          'aria-hidden': true,
          style: { position: 'absolute', top: 0, left: `${rowInset(node)}px`, right: 0, height: '1px', background: color('separator') },
        }),
    node,
  );
}

function KeyedList<T>({ items, keyBy, renderItem }: KeyedListProps<T>) {
  const { rows, motion } = useKeyedRows(items, keyBy, renderItem);
  return React.createElement(ListGroup, { motion }, rows.map((row, i) => listRow(row.key, row.node, i === 0)));
}

function ListGroup({ motion, children }: { motion?: boolean; children?: React.ReactNode }) {
  const surface = useGroupSurface();
  return React.createElement(
    'div',
    {
      ...(motion === undefined ? {} : { 'data-list-motion': motion ? 'on' : 'off' }),
      style: {
        boxSizing: 'border-box',
        borderRadius: radius('lg'),
        background: color(surface),
        border: groupOutline(),
        overflow: 'hidden',
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
  const pressable = onPress
    ? {
        onClick: () => {
          emitUiEvent('press', title);
          onPress();
        },
        ...pressHandlers,
      }
    : {};
  return React.createElement(
    'div',
    {
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
const GRABBER = { width: 36, height: 5, top: 6 };
const CLOSE_DISC = 30;

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
  if (!visible) return null;

  const target = touchTarget();
  const close = React.createElement(
    'button',
    {
      key: 'close',
      type: 'button',
      'aria-label': 'Close',
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
      style: {
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
    close,
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
        background: color('scrim'),
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        ...TAP_RESET,
      },
    },
    React.createElement(
      'div',
      {
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
