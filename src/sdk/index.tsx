// ─────────────────────────────────────────────────────────────────────────────
// vc-sdk — the ONLY capability surface a Whim mini-app bundle may import (decision #7).
// ─────────────────────────────────────────────────────────────────────────────
// A mini-app is one TS file that imports only from `vc-sdk` and `export default
// defineApp({...})`. At build time `vc-sdk` is marked EXTERNAL (it resolves to a host-
// injected global at runtime — H1b); at type time it resolves here via the tsconfig path.
//
// Two hard contracts this file keeps:
//   1. Components accept TOKENS, not values (tokens.ts) — keeps the render contract
//      backend-agnostic (#11 / §4.6).
//   2. The SDK holds NO capability stronger than the one-way `parent.postMessage` transport
//      (carry-forward constraint #2). The only ambient thing it ever touches is
//      `window.ReactNativeWebView.postMessage` (a string, one-way) — the loader's stub, the
//      single permitted crossing. No network, no storage, no native handle.
//
// This is a MINIMAL, FUNCTIONAL fixture slice — just enough to render the tip splitter and
// prove the render path. The finished visual language (color ramps, dark mode, component
// polish) is a deferred SDK design-system change (design D6); only the component + token
// CONTRACT is durable here.
import * as React from 'react';
import {
  space,
  radius,
  color,
  weight,
  textSize,
  textColor,
  FONT,
  TABULAR_NUMS,
  activeTheme,
  type SpaceToken,
  type RadiusToken,
  type TextColorToken,
  type TextSizeToken,
  type WeightToken,
} from './tokens';
import { emitUiEvent } from './events';
import { CONTROL_RESET } from './press';
import { stacks, typeStyle } from './kit';
import { TextField } from './controls';
import { chromeInsetContext } from './chrome-inset';
import { navDepthContext, nav, screenLayerContext, layerStyle, playLayer, IDLE_LAYER, type LayerRole } from './navigation';
import { motionElement, usePressMotion } from './motion';
import { Glyph } from './icon';
import { LAYOUT } from '../design/tokens';

// The theme model (design sdk-design-system D1/D4) — type-only, so nothing executable
// crosses this seam beyond the resolvers above, which already read the active theme. `shape`
// is gone in v2 (the shell is fixed, not themeable — see theme.ts).
export type { WhimTheme } from './theme';

// The storage verb/param types are the `mini-app-storage-engine` D8 inter-change seam,
// re-exported here so a mini-app author types its `schema` and storage calls against the
// SAME contract the host gates with. Type-only: nothing from the engine is bundled into the
// SDK (the facade below holds only the one-way transport — carry-forward constraint #2).
import type {
  JsonValue,
  StorageRecord,
  ListQuery,
  SchemaArtifact,
} from '../host/storage-engine/contract';
export type { JsonValue, StorageRecord, ListQuery, SchemaArtifact, FieldType } from '../host/storage-engine/contract';

// The closed cue token sets (effects-and-cues D4) — type-only, so NOTHING from the bridge is
// bundled into the SDK (the facade still holds only the one-way transport — constraint #2). A
// mini-app types its `cues.haptic`/`cues.sound` calls against the SAME tokens the host gate
// validates, so an off-set token is a compile error in the app, not just a runtime denial.
import type { HapticKind, SoundName } from '../host/bridge/contract';
export type { HapticKind, SoundName };

// ── State (design D6 / task 3.3) ─────────────────────────────────────────────
// In-memory, web-side, no bridge: this is literally React's useState/useEffect/useRef, surfaced
// through the SDK so the bundle never has to import `react` itself (the SDK stays the only
// import surface for app authors, even though `react` is also a resolvable runtime external).
// `useRef` is a pure fiber-memory cell — it carries NO ambient authority (no network/storage/
// native, nothing the containment legs govern), it is just a stable mutable `{current}` box that
// (a) does not re-render on write and (b) is readable LIVE from inside an async closure, unlike a
// `useState` value which freezes at the value it had when the closure was created. That async-live
// read is what lets a coroutine (e.g. pour-over-timer's `start()`) observe a cancellation set
// after it has already begun awaiting — the same staleness class the `interval` note below calls out.
export const useState = React.useState;
export const useEffect = React.useEffect;
export const useRef = React.useRef;

// ── Timed effects (effects-and-cues D1) ──────────────────────────────────────
// Web-resident wrapped timers — the mini-app's ONLY taught path to time. They emit NO syscall
// frame, need no capability, and cross no gate: this is pure in-iframe setTimeout/setInterval,
// which the sandbox deliberately does NOT strip (#35 — strip capabilities, not time; React's
// scheduler and the syscall marshaller need it). Cleanup the author cannot forget: `interval`
// is a hook so unmount cancels it; a host-forced realm reset (iframe recreation, carry-forward
// #5) cancels everything structurally — no SDK-level registry, none needed (design D2).

/** Resolve after at least `ms` — one-shot sequencing inside handlers/effects (`await delay(800)`).
 *  `ms` must be finite and non-negative; `0` resolves on the next tick. A non-finite
 *  (`Infinity`/`NaN`) or negative `ms` returns a promise that NEVER resolves — cancelled only by
 *  realm teardown, mirroring `interval`'s `!Number.isFinite(ms) || ms < 0` bail.
 *  Deliberately NOT component-scoped: an in-flight `delay` across an unmount resolves harmlessly
 *  (callers update state via React, which no-ops on unmounted trees in 18+); a realm teardown
 *  cancels it structurally (D2). */
export function delay(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms < 0) return new Promise(() => {});
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export interface IntervalOptions {
  /** Pause/resume WITHOUT tearing the hook down: while `false`, the callback does not fire; it
   *  resumes when `true` again. (The pour-over fixture's start/pause/reset rides this.) */
  running?: boolean;
}

/**
 * A repeating timer as a HOOK (design D1). There is no handle to forget and no cleanup for the
 * author to omit: unmounting the mounting component cancels the timer by construction, which
 * deletes the §5.5 "interval without cleanup" leak class instead of detecting it. `running:false`
 * pauses without unmounting.
 *
 * `interval` genuinely follows the Rules of Hooks; the `use*` naming the linter keys on can't
 * see that through the spec-fixed name (design D1 / Risks). Aliasing to `useInterval` stays
 * additive if hook-rule TOOLING ever becomes load-bearing — hence the scoped disable below,
 * a rename would break the agent-facing vocabulary #1 already fixed.
 */
/* eslint-disable react-hooks/rules-of-hooks */
export function interval(callback: () => void, ms: number, opts?: IntervalOptions): void {
  // Keep the latest callback in a ref so changing it does not restart the timer (the canonical
  // useInterval shape) — only `running`/`ms` changes re-arm it.
  const saved = React.useRef(callback);
  React.useEffect(() => {
    saved.current = callback;
  }, [callback]);

  const running = opts?.running ?? true;
  React.useEffect(() => {
    if (!running || !Number.isFinite(ms) || ms < 0) return undefined;
    const id = setInterval(() => {
      saved.current();
    }, ms);
    return () => clearInterval(id); // unmount / pause / ms-change → cancel (the un-forgettable cleanup)
  }, [running, ms]);
}
/* eslint-enable react-hooks/rules-of-hooks */

// ── App descriptor (design D6 / tasks 2.4 / 3.1) ─────────────────────────────
export type ScreenComponent = React.ComponentType<Record<string, unknown>>;

export interface AppSpec {
  name: string;
  initial: string;
  screens: Record<string, ScreenComponent>;
  /** The capabilities this app declares (the manifest the host gate enforces). Tier-0 apps
   *  (tip splitter) declare `[]` and never pass the gate's threshold — they never syscall. */
  capabilities: string[];
  /** The storage schema artifact, REQUIRED when `capabilities` includes `'storage'`. The build
   *  step extracts this (and `capabilities`) into the host-side app record — single source of
   *  truth, so a fixture cannot drift from its own declaration. The runtime gate reads only the
   *  host-held copy (design D6); this in-bundle declaration is what the build extracts. */
  schema?: SchemaArtifact;
  /** The app's tint: one of the ten names (`slate`, `stone`, `ocean`, `blue`, `indigo`, `violet`,
   *  `purple`, `orchid`, `berry`, `rose`), or up to three ranked so the home screen can pick one no
   *  other app uses. Extracted statically, like `capabilities`. A near name resolves through the
   *  alias map and an unknown one falls back to a fixed tint for the app; neither fails a build. */
  tint?: string | readonly [string] | readonly [string, string] | readonly [string, string, string];
  /** The tile's glyph: one icon name from the glyph set. Extracted statically; an unknown name
   *  resolves by keyword, else draws a circle. */
  icon?: string;
  /** @deprecated Declare `tint` instead; a `tileColor` maps to the nearest tint.
   *  The one thing the shell asks back from a generated app: its tile colour, as a `#rrggbb`
   *  LITERAL. Extracted statically from this `defineApp` argument exactly as `capabilities` is —
   *  never obtained by executing or introspecting the bundle, so a non-literal value is simply not
   *  extracted. Absent, malformed, or equal to a reserved shell hue all mean "no declaration", and
   *  the shell falls back to its deterministic `appColor(name)`. Nothing else about a generated
   *  app's look is constrained by the shell. */
  tileColor?: string;
}

/**
 * Returns a plain AppSpec descriptor. It does NOT mount anything — the trusted host decides
 * when and where to render (the agent's code describes; the host renders). Keeping this a
 * pure descriptor is what lets the host own mounting, re-injection, and the realm lifecycle.
 */
export function defineApp(spec: AppSpec): AppSpec {
  return spec;
}

export { nav } from './navigation';
export { toast } from './toast';
export { Icon } from './icon';
export type { IconProps, IconSize } from './icon';

// ── The one-way UI-event transport (constraint #2) ───────────────────────────
// Shared with `controls.tsx`/`surfaces.tsx` (design D5) via `events.ts` (imported at top) —
// see that file for the full rationale; kept as a single, non-duplicated definition.

// ── Storage facade (capability-bridge D6 / task 2.3) ──────────────────────────
// Typed client stubs over the engine's contract verbs. Each call builds a syscall envelope and
// awaits a correlated `sysret` through `window.__whimSyscall` — the iframe-side marshaller the
// runtime installs (src/runtime/web/syscall.js), whose ONLY capability is the same one-way
// `parent.postMessage` transport the loader already holds (constraint #2). The facade caches
// nothing, validates nothing beyond types, holds no engine handle and no host reference — the
// host is the sole interpreter of effects (§5.6). Enumerating anything reachable from `storage`
// yields at most the ability to post a string (the stub-authority invariant).
interface SyscallTransport {
  call(method: string, params: Record<string, JsonValue>): Promise<JsonValue>;
}

function syscall<T>(method: string, params: Record<string, JsonValue>): Promise<T> {
  const t = (globalThis as { __whimSyscall?: SyscallTransport }).__whimSyscall;
  if (!t || typeof t.call !== 'function') {
    return Promise.reject(
      new Error('vc-sdk: no syscall transport available (capabilities are unreachable in this context)'),
    );
  }
  return t.call(method, params) as Promise<T>;
}

export const storage = {
  kv: {
    /** Read a KV scalar; resolves to `undefined` when the key is absent. */
    get(key: string): Promise<JsonValue | undefined> {
      return syscall<{ found: boolean; value: JsonValue }>('storage.kv.get', { key }).then((r) =>
        r.found ? r.value : undefined,
      );
    },
    set(key: string, value: JsonValue): Promise<void> {
      return syscall<unknown>('storage.kv.set', { key, value }).then(() => undefined);
    },
    remove(key: string): Promise<void> {
      return syscall<unknown>('storage.kv.remove', { key }).then(() => undefined);
    },
  },
  records: {
    append(collection: string, record: { [field: string]: JsonValue }): Promise<{ id: number }> {
      return syscall<{ id: number }>('storage.records.append', { collection, record });
    },
    list(collection: string, query?: ListQuery): Promise<StorageRecord[]> {
      return syscall<{ records: StorageRecord[] }>('storage.records.list', {
        collection,
        ...(query ? { query: query as unknown as JsonValue } : {}),
      }).then((r) => r.records);
    },
    update(collection: string, id: number, patch: { [field: string]: JsonValue }): Promise<void> {
      return syscall<unknown>('storage.records.update', { collection, id, patch }).then(() => undefined);
    },
    remove(collection: string, id: number): Promise<void> {
      return syscall<unknown>('storage.records.remove', { collection, id }).then(() => undefined);
    },
  },
};

// ── Cues facade (effects-and-cues D7) ────────────────────────────────────────
// Gated physical cues (haptic, short sound) as syscalls #2/#3, riding the SAME one-way
// `__whimSyscall` transport as `storage` — nothing stronger (constraint #2). Fire-and-forget:
// each resolves as soon as the host triggers the cue (the sysret is `{}`); completion, duration,
// and device state are deliberately UNOBSERVABLE — cues add zero sensing surface (D7). Tokens,
// not values (D4): the closed `HapticKind`/`SoundName` sets are the only expressible vocabulary,
// and the host owns the token→pattern/tone mapping. Requires `capabilities: ['cues']`; an
// undeclared call rejects with a structured `undeclared_capability` (the gate, not the stub).
export const cues = {
  /** Buzz the device with a named haptic. Resolves once triggered; observes nothing back. */
  haptic(kind: HapticKind): Promise<void> {
    return syscall<unknown>('cues.haptic', { kind }).then(() => undefined);
  },
  /** Play a named short sound. Resolves once triggered; observes nothing back. */
  sound(name: SoundName): Promise<void> {
    return syscall<unknown>('cues.sound', { name }).then(() => undefined);
  },
};

// ── Components (design D6 / task 3.2) ─────────────────────────────────────────
// Each takes tokens and resolves them to CSS internally. The bundle never sees a raw value.

export interface ScreenAction {
  /** An icon name, drawn at 24 in the header's trailing corner. */
  icon: string;
  /** What the button does, for screen readers (the icon carries no text). */
  label: string;
  onPress: () => void;
}
export interface ScreenProps {
  padding?: SpaceToken;
  /** The screen's title. With it, the screen gets a header: a back control on any screen above the
   *  first (it calls `nav.back()`), the `action` button, and the title under them. */
  title?: string;
  /** A trailing icon button in the header; shown only with `title`. */
  action?: ScreenAction;
  children?: React.ReactNode;
}
/** `Screen`'s padding: the token on every side, plus the host chrome inset (beta-1 D5) at the
 *  bottom so the last element can scroll clear of the orb. No inset: exactly the token. */
function screenPadding(pad: string, chromeInset: number): string {
  if (chromeInset > 0) {
    // Every calc() term needs a unit, and the `none` token is a bare `0`.
    const withUnit = pad === '0' ? '0px' : pad;
    return `${pad} ${pad} calc(${withUnit} + ${chromeInset}px)`;
  }
  return pad;
}
/** Header glyph size (system.md §3.1: 24 in headers). */
const HEADER_ICON_PX = 24;

interface HeaderButtonProps {
  icon: string;
  label: string;
  edge: 'start' | 'end';
  onPress: () => void;
}
/** A plain icon button at the platform's touch target, pulled out to the screen's edge so its
 *  glyph lines up with the content beside it. */
function HeaderButton({ icon, label, edge, onPress }: HeaderButtonProps) {
  const target = LAYOUT.touchTarget[activeTheme().platform];
  const pull = `-${(target - HEADER_ICON_PX) / 2}px`;
  const { ref, ...press } = usePressMotion('icon');
  return React.createElement(
    'button',
    {
      type: 'button',
      'aria-label': label,
      ref,
      ...press,
      onClick: () => {
        emitUiEvent('press', label);
        onPress();
      },
      style: {
        boxSizing: 'border-box',
        width: `${target}px`,
        height: `${target}px`,
        padding: 0,
        border: 'none',
        background: 'transparent',
        color: textColor('text'),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        ...(edge === 'start' ? { marginLeft: pull } : { marginRight: pull }),
        ...CONTROL_RESET,
      },
    },
    React.createElement(Glyph, { name: icon, sizePx: HEADER_ICON_PX }),
  );
}

/** The header `Screen` draws above its content when it has a title. */
function ScreenHeader({ title, action, depth }: { title: string; action?: ScreenAction; depth: number }) {
  const t = textSize('title');
  const back = activeTheme().platform === 'ios' ? 'chevron-left' : 'arrow-left';
  return React.createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column', marginBottom: space('lg') } },
    React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: `${LAYOUT.headerRowHeight}px`,
        },
      },
      depth > 0
        ? React.createElement(HeaderButton, { icon: back, label: 'Back', edge: 'start', onPress: () => nav.back() })
        : React.createElement('span'),
      action
        ? React.createElement(HeaderButton, { icon: action.icon, label: action.label, edge: 'end', onPress: action.onPress })
        : null,
    ),
    React.createElement(
      'h1',
      {
        style: {
          margin: 0,
          fontSize: t.size,
          lineHeight: t.line,
          letterSpacing: t.tracking,
          fontWeight: weight(t.weight),
          color: textColor('text'),
        },
      },
      title,
    ),
  );
}

// Whether a Screen sits inside another Screen. Only the outermost one adds the chrome inset; the
// inset context itself stays the root's, so a `Modal` anywhere under a Screen still reads it.
// Created on first use, like the other SDK contexts.
let nestedScreenContext: React.Context<boolean> | undefined;
function screenNesting(): React.Context<boolean> {
  nestedScreenContext ??= React.createContext(false);
  return nestedScreenContext;
}

export function Screen({ padding = 'lg', title, action, children }: ScreenProps) {
  const nestedContext = screenNesting();
  const nested = React.useContext(nestedContext);
  const rootInset = React.useContext(chromeInsetContext());
  const chromeInset = nested ? 0 : rootInset;
  const depthContext = navDepthContext();
  const depth = React.useContext(depthContext);
  const layerContext = screenLayerContext();
  // Only the outermost Screen is the navigation stack's page, so only it moves on a push or pop: it
  // gives the screens inside it the idle part.
  const layer = React.useContext(layerContext);
  const element = React.useRef<unknown>(null);
  const shownRole = React.useRef<LayerRole | null>(null);
  React.useLayoutEffect(() => {
    const previous = shownRole.current;
    shownRole.current = layer.role;
    const el = motionElement(element.current);
    if (!el || layer.role === 'idle' || layer.role === previous) return;
    playLayer(el, layer.role, previous === null);
  }, [layer.role]);
  const leaving = layer.role === 'cover' || layer.role === 'exit';
  const body = textSize('body');
  return React.createElement(
    'div',
    {
      ref: element,
      ...(leaving ? { 'aria-hidden': true } : {}),
      style: {
        boxSizing: 'border-box',
        minHeight: '100%',
        padding: screenPadding(space(padding), chromeInset),
        background: color('bg'),
        color: color('text'),
        font: `${body.size}/${body.line} ${FONT}`,
        // An app, not a document: no rubber-band or pull-to-refresh past the content. Text stays
        // selectable; controls opt out of selection themselves (CONTROL_RESET).
        overscrollBehavior: 'none',
        ...layerStyle(layer),
      },
    },
    title ? React.createElement(ScreenHeader, { title, action, depth }) : null,
    // Only the outermost Screen is the scrollable content and the navigation stack's page: one
    // nested inside it pads as before and never shows a back control.
    React.createElement(
      nestedContext.Provider,
      { value: true },
      React.createElement(
        depthContext.Provider,
        { value: 0 },
        React.createElement(layerContext.Provider, { value: IDLE_LAYER }, children),
      ),
    ),
  );
}

export interface StackProps {
  gap?: SpaceToken;
  children?: React.ReactNode;
}
export function Stack({ gap = 'md', children }: StackProps) {
  return React.createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: space(gap) } },
    children,
  );
}

export interface RowProps extends StackProps {
  /** Cross-axis alignment (`alignItems`), `'center'` by default. */
  align?: 'start' | 'center' | 'end';
  /** Main-axis distribution (`justifyContent`), `'start'` by default; `'between'` maps to
   *  `'space-between'`. */
  justify?: 'start' | 'center' | 'end' | 'between';
}
const ALIGN_ITEMS: Record<NonNullable<RowProps['align']>, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
};
const JUSTIFY_CONTENT: Record<NonNullable<RowProps['justify']>, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
};
export function Row({ gap = 'md', align = 'center', justify = 'start', children }: RowProps) {
  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'wrap',
        // Own-property reads: an old bundle can pass any string, and `'constructor' in {}` is true.
        alignItems: Object.hasOwn(ALIGN_ITEMS, align) ? ALIGN_ITEMS[align] : ALIGN_ITEMS.center,
        justifyContent: Object.hasOwn(JUSTIFY_CONTENT, justify) ? JUSTIFY_CONTENT[justify] : JUSTIFY_CONTENT.start,
        gap: space(gap),
      },
    },
    children,
  );
}

export interface TextProps {
  size?: TextSizeToken;
  color?: TextColorToken;
  weight?: WeightToken;
  /** Text alignment (`textAlign`). Absent = today's behavior (no `textAlign` set). */
  align?: 'start' | 'center' | 'end';
  children?: React.ReactNode;
}
/** The style of `Text` (and of `Heading`, its deprecated alias). */
function textStyle({ size = 'body', color: colorToken = 'text', weight: weightToken, align }: Omit<TextProps, 'children'>) {
  const t = textSize(size);
  return {
    fontSize: t.size,
    lineHeight: t.line,
    letterSpacing: t.tracking,
    fontWeight: weight(weightToken ?? t.weight),
    color: textColor(colorToken),
    ...(size === 'display' ? TABULAR_NUMS : {}),
    ...(align ? { textAlign: align } : {}),
  };
}

export function Text({ children, ...props }: TextProps) {
  return React.createElement('span', { style: textStyle(props) }, children);
}

/** @deprecated Use `<Text size="title">`. */
export interface HeadingProps {
  size?: Extract<TextSizeToken, 'subtitle' | 'title' | 'display'>;
  color?: TextColorToken;
  children?: React.ReactNode;
}
/** @deprecated Use `<Text size="title">`. Kept so apps built before it went keep rendering: it is
 *  `Text` at its size (default `title`), on a line of its own as it always was. */
export function Heading({ size = 'title', color: colorToken, children }: HeadingProps) {
  return React.createElement('div', { style: { ...textStyle({ size, color: colorToken }), margin: 0 } }, children);
}

export interface NumberInputProps {
  label?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange?: (n: number) => void;
}
export function NumberInput({ label, value, min, max, step, onChange }: NumberInputProps) {
  return React.createElement(TextField, {
    label,
    tabular: true,
    input: {
      type: 'number',
      value: Number.isFinite(value) ? value : 0,
      min,
      max,
      step,
      inputMode: 'decimal',
      onChange: (e: { target: { value: string } }) => {
        const n = Number.parseFloat(e.target.value);
        if (onChange) onChange(Number.isNaN(n) ? 0 : n);
      },
    },
  });
}

export interface ButtonProps {
  label: string;
  /** An icon name, drawn at 20 before the label in the label's colour. */
  icon?: string;
  /** @deprecated Buttons are capsules; this is accepted and ignored. */
  radius?: RadiusToken;
  /** `'primary'` (default): the app's tint, the one filled button on a screen. `'secondary'`: a
   *  neutral fill. `'ghost'`: no fill, tint text. `'danger'`: a soft red capsule, never a fill. */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  onPress?: () => void;
}
/** Fill and label of each variant (system.md §7.2); disabled is `fill` + `text-3` whatever the
 *  variant, never a lowered opacity. */
function buttonColors(variant: ButtonProps['variant'], disabled: boolean): { background: string; color: string } {
  if (disabled) return { background: color('fill'), color: color('text-3') };
  switch (variant) {
    case 'secondary':
      return { background: color('fill'), color: textColor('text') };
    case 'ghost':
      return { background: 'transparent', color: textColor('primary') };
    case 'danger':
      return { background: color('danger-soft'), color: textColor('danger') };
    default:
      return { background: color('primary'), color: color('on-primary') };
  }
}
export function Button({ label, icon, variant = 'primary', disabled = false, onPress }: ButtonProps) {
  // Press feedback (M1); a disabled button has no pointer handlers.
  const { ref, ...press } = usePressMotion('button');
  return React.createElement(
    'button',
    {
      type: 'button',
      ref,
      disabled,
      onClick: () => {
        // (b) surface the tap to the host over the one-way transport (constraint #2), then
        // (a) run the app's own handler. Order is intentional: the host observes the event
        // even if the app handler throws. Disabled buttons suppress both.
        if (disabled) return;
        emitUiEvent('press', label);
        if (onPress) onPress();
      },
      ...(disabled ? {} : press),
      style: {
        boxSizing: 'border-box',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: space('sm'),
        minHeight: `${LAYOUT.buttonHeight.large}px`,
        margin: 0,
        padding: `${space('sm')} ${space('lg')}`,
        border: 'none',
        borderRadius: radius('full'),
        fontFamily: FONT,
        ...typeStyle('headline'),
        textAlign: 'center',
        cursor: disabled ? 'default' : 'pointer',
        // From 135%, a button takes a line of its own, so paired buttons stack (system.md §6).
        ...(stacks() ? { flex: '1 1 100%' } : {}),
        ...CONTROL_RESET,
        ...buttonColors(variant, disabled),
      },
    },
    icon ? React.createElement(Glyph, { name: icon, sizePx: 20 }) : null,
    label,
  );
}

// ── Controls (design D5/D6) ───────────────────────────────────────────────────
// Interactive form controls live in `controls.tsx` (their own review lens, shared event/
// appearance discipline) and are re-exported here so `vc-sdk` stays the single import surface.
export { TextInput, Switch, Checkbox, Slider, SegmentedControl, Stepper, DateInput, Picker } from './controls';
export type {
  TextInputProps,
  SwitchProps,
  CheckboxProps,
  SliderProps,
  SegmentedControlProps,
  StepperProps,
  DateInputProps,
  DateInputMode,
  PickerProps,
} from './controls';

// ── Surfaces (design D5/D6) ───────────────────────────────────────────────────
// Layout/display surfaces live in `surfaces.tsx` (own review lens) and are re-exported here so
// `vc-sdk` stays the single import surface.
export {
  Card,
  Divider,
  Spacer,
  Grid,
  Badge,
  ProgressBar,
  List,
  ListItem,
  EmptyState,
  Modal,
} from './surfaces';
export type {
  CardProps,
  GridProps,
  BadgeTone,
  BadgeProps,
  ProgressBarProps,
  ListProps,
  ListItemProps,
  EmptyStateProps,
  ModalProps,
} from './surfaces';

// ── Charts (design sdk-charts D2/D5/D6) ──────────────────────────────────────
// The single declarative chart component lives in `charts.tsx` (own review lens) and is
// re-exported here so `vc-sdk` stays the single import surface.
export { Chart } from './charts';
export type { ChartProps, ChartTone, SeriesPoint, DayPoint } from './charts';
