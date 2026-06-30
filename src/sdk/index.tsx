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
  type SpaceToken,
  type RadiusToken,
  type ColorToken,
  type TextSizeToken,
  type WeightToken,
} from './tokens';

// The storage verb/param types are the `mini-app-storage-engine` D8 inter-change seam,
// re-exported here so a mini-app author types its `schema` and storage calls against the
// SAME contract the host gates with. Type-only: nothing from the engine is bundled into the
// SDK (the facade below holds only the one-way transport — carry-forward constraint #2).
import type {
  JsonValue,
  StorageRecord,
  ListQuery,
  SchemaArtifact,
  FieldType,
} from '../host/storage-engine/contract';
export type { JsonValue, StorageRecord, ListQuery, SchemaArtifact, FieldType };

// The closed cue token sets (effects-and-cues D4) — type-only, so NOTHING from the bridge is
// bundled into the SDK (the facade still holds only the one-way transport — constraint #2). A
// mini-app types its `cues.haptic`/`cues.sound` calls against the SAME tokens the host gate
// validates, so an off-set token is a compile error in the app, not just a runtime denial.
import type { HapticKind, SoundName } from '../host/bridge/contract';
export type { HapticKind, SoundName };

// ── State (design D6 / task 3.3) ─────────────────────────────────────────────
// In-memory, web-side, no bridge: this is literally React's useState/useEffect, surfaced
// through the SDK so the bundle never has to import `react` itself (the SDK stays the only
// import surface for app authors, even though `react` is also a resolvable runtime external).
export const useState = React.useState;
export const useEffect = React.useEffect;

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
}

/**
 * Returns a plain AppSpec descriptor. It does NOT mount anything — the trusted host decides
 * when and where to render (the agent's code describes; the host renders). Keeping this a
 * pure descriptor is what lets the host own mounting, re-injection, and the realm lifecycle.
 */
export function defineApp(spec: AppSpec): AppSpec {
  return spec;
}

// ── The one-way UI-event transport (constraint #2) ───────────────────────────
// A press is surfaced to the RN host as a one-way string on the §5.6 transport — the same
// pipe that later carries the syscall RPC envelope. It grants the app NOTHING (fire-and-
// forget, no return value, no native handle); it only lets a user interaction reach the host
// (sandbox-rendering: "a tap reaches the host"). If the transport stub is absent (e.g. a
// plain desktop preview with no host), this is a no-op.
function emitUiEvent(type: string, label?: string): void {
  try {
    const rnww = (globalThis as { ReactNativeWebView?: { postMessage(s: string): void } })
      .ReactNativeWebView;
    if (rnww && typeof rnww.postMessage === 'function') {
      rnww.postMessage(JSON.stringify({ __whimUiEvent: true, type, label }));
    }
  } catch {
    /* one-way, best-effort: never let telemetry break the render */
  }
}

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

export interface ScreenProps {
  padding?: SpaceToken;
  children?: React.ReactNode;
}
export function Screen({ padding = 'lg', children }: ScreenProps) {
  return React.createElement(
    'div',
    {
      style: {
        boxSizing: 'border-box',
        minHeight: '100%',
        padding: space(padding),
        background: color('bg'),
        color: color('text'),
        font: '16px system-ui, -apple-system, sans-serif',
      },
    },
    children,
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

export function Row({ gap = 'md', children }: StackProps) {
  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: space(gap),
      },
    },
    children,
  );
}

export interface TextProps {
  size?: TextSizeToken;
  color?: ColorToken;
  weight?: WeightToken;
  children?: React.ReactNode;
}
export function Text({ size = 'body', color: colorToken = 'text', weight: weightToken, children }: TextProps) {
  const t = textSize(size);
  return React.createElement(
    'span',
    {
      style: {
        fontSize: t.size,
        lineHeight: t.line,
        fontWeight: weight(weightToken ?? t.weight),
        color: color(colorToken),
      },
    },
    children,
  );
}

export interface HeadingProps {
  size?: Extract<TextSizeToken, 'subtitle' | 'title' | 'display'>;
  color?: ColorToken;
  children?: React.ReactNode;
}
export function Heading({ size = 'title', color: colorToken = 'text', children }: HeadingProps) {
  const t = textSize(size);
  return React.createElement(
    'div',
    {
      style: {
        fontSize: t.size,
        lineHeight: t.line,
        fontWeight: weight('bold'),
        color: color(colorToken),
        margin: 0,
      },
    },
    children,
  );
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
  const field = React.createElement('input', {
    type: 'number',
    value: Number.isFinite(value) ? value : 0,
    min,
    max,
    step,
    inputMode: 'decimal',
    onChange: (e: { target: { value: string } }) => {
      const n = parseFloat(e.target.value);
      if (onChange) onChange(Number.isNaN(n) ? 0 : n);
    },
    style: {
      font: 'inherit',
      fontSize: textSize('subtitle').size,
      padding: `${space('sm')} ${space('md')}`,
      borderRadius: radius('md'),
      border: `1px solid ${color('border')}`,
      background: color('bg'),
      color: color('text'),
      width: '100%',
      boxSizing: 'border-box',
      outline: 'none',
      WebkitAppearance: 'none',
      MozAppearance: 'textfield',
    },
  });
  if (!label) return field;
  return React.createElement(
    'label',
    { style: { display: 'flex', flexDirection: 'column', gap: space('xs') } },
    React.createElement(Text, { size: 'caption', color: 'text-muted' }, label),
    field,
  );
}

export interface ButtonProps {
  label: string;
  radius?: RadiusToken;
  onPress?: () => void;
}
export function Button({ label, radius: radiusToken = 'md', onPress }: ButtonProps) {
  return React.createElement(
    'button',
    {
      type: 'button',
      onClick: () => {
        // (b) surface the tap to the host over the one-way transport (constraint #2), then
        // (a) run the app's own handler. Order is intentional: the host observes the event
        // even if the app handler throws.
        emitUiEvent('press', label);
        if (onPress) onPress();
      },
      style: {
        font: '600 17px system-ui, sans-serif',
        padding: `${space('md')} ${space('lg')}`,
        borderRadius: radius(radiusToken),
        border: 'none',
        color: color('on-primary'),
        background: color('primary'),
        width: '100%',
        cursor: 'pointer',
      },
    },
    label,
  );
}

// NOTE (design Open Question — "Slider or SegmentedControl?"): the tip-splitter fixture uses
// `NumberInput` for all three numeric inputs (bill / tip% / people), so neither Slider nor
// SegmentedControl is needed for v0.1. Resolved by NOT shipping unexercised components in
// this security-critical change ("implement only what it uses"); the chosen control is a
// deferred call for the SDK design-system change, made with the real component surface in hand.
