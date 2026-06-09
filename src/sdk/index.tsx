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

// ── State (design D6 / task 3.3) ─────────────────────────────────────────────
// In-memory, web-side, no bridge: this is literally React's useState, surfaced through the
// SDK so the bundle never has to import `react` itself (the SDK stays the only import
// surface for app authors, even though `react` is also a resolvable runtime external).
export const useState = React.useState;

// ── App descriptor (design D6 / task 3.1) ────────────────────────────────────
export type ScreenComponent = React.ComponentType<Record<string, unknown>>;

export interface AppSpec {
  name: string;
  initial: string;
  screens: Record<string, ScreenComponent>;
  /** v0.1 tip splitter is Tier-0: zero syscalls. The bridge/capability gate is v0.2. */
  capabilities: string[];
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
