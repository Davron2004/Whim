// ─────────────────────────────────────────────────────────────────────────────
// vc-sdk — interactive form controls (design sdk-design-system D5/D6)
// ─────────────────────────────────────────────────────────────────────────────
// Sibling module to `index.tsx` (the barrel re-exports everything below — design D5: "New
// components live in src/sdk/controls.tsx ... re-exported through index.tsx"). Same two hard
// contracts as index.tsx apply here: components accept TOKENS, not values (tokens.ts), and the
// only ambient capability touched is the one-way `ReactNativeWebView.postMessage` transport via
// `emitUiEvent` (constraint #2, shared from `events.ts` — not duplicated).
import * as React from 'react';
import { space, radius, color, weight, textSize, FONT } from './tokens';
import { emitUiEvent } from './events';

// Shared small-print label — mirrors `Text({size:'caption', color:'text-muted'})` from
// index.tsx exactly (same style keys/values) without importing the barrel back into this
// module (would make index.tsx <-> controls.tsx circular).
function FieldLabel({ children }: { children?: React.ReactNode }) {
  const t = textSize('caption');
  return React.createElement(
    'span',
    {
      style: {
        fontSize: t.size,
        lineHeight: t.line,
        fontWeight: weight(t.weight),
        color: color('text-muted'),
      },
    },
    children,
  );
}

// ── TextInput ──────────────────────────────────────────────────────────────────
// Same chrome discipline as NumberInput (index.tsx): label block, border, radius 'md', bg
// token, appearance/outline resets — just a string field instead of a numeric one.
export interface TextInputProps {
  label?: string;
  value: string;
  placeholder?: string;
  onChange?: (s: string) => void;
}
export function TextInput({ label, value, placeholder, onChange }: TextInputProps) {
  const field = React.createElement('input', {
    type: 'text',
    value,
    placeholder,
    onChange: (e: { target: { value: string } }) => {
      if (onChange) onChange(e.target.value);
    },
    style: {
      font: `16px ${FONT}`,
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
      MozAppearance: 'none',
    },
  });
  if (!label) return field;
  return React.createElement(
    'label',
    { style: { display: 'flex', flexDirection: 'column', gap: space('xs') } },
    React.createElement(FieldLabel, null, label),
    field,
  );
}

// ── Switch ────────────────────────────────────────────────────────────────────
// Custom div track+knob (no native checkbox chrome) — the knob's position transitions via CSS
// `transform`. The outer row is the ONLY click target (no handler on the inner track), so the
// whole control — label included — toggles from a single event, never double-fires.
const SWITCH_TRACK_W = 44;
const SWITCH_TRACK_H = 24;
const SWITCH_KNOB = 18;
const SWITCH_INSET = 3;
const SWITCH_KNOB_OFFSET = SWITCH_TRACK_W - SWITCH_KNOB - SWITCH_INSET * 2;

export interface SwitchProps {
  label?: string;
  value: boolean;
  onChange?: (b: boolean) => void;
}
export function Switch({ label, value, onChange }: SwitchProps) {
  const track = React.createElement(
    'div',
    {
      style: {
        position: 'relative',
        width: `${SWITCH_TRACK_W}px`,
        height: `${SWITCH_TRACK_H}px`,
        borderRadius: radius('full'),
        background: value ? color('primary') : color('surface'),
        border: `1px solid ${value ? color('primary') : color('border')}`,
        boxSizing: 'border-box',
        flexShrink: 0,
      },
    },
    React.createElement('div', {
      style: {
        position: 'absolute',
        top: `${SWITCH_INSET}px`,
        left: `${SWITCH_INSET}px`,
        width: `${SWITCH_KNOB}px`,
        height: `${SWITCH_KNOB}px`,
        borderRadius: radius('full'),
        background: color('on-primary'),
        transform: value ? `translateX(${SWITCH_KNOB_OFFSET}px)` : 'translateX(0)',
        transition: 'transform 150ms ease',
      },
    }),
  );
  return React.createElement(
    'div',
    {
      role: 'switch',
      'aria-checked': value,
      onClick: () => {
        emitUiEvent('press', label ?? 'switch');
        if (onChange) onChange(!value);
      },
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: label ? 'space-between' : 'flex-start',
        gap: space('md'),
        cursor: 'pointer',
        font: `16px ${FONT}`,
        color: color('text'),
      },
    },
    ...(label ? [React.createElement(FieldLabel, { key: 'label' }, label)] : []),
    track,
  );
}

// ── Checkbox ──────────────────────────────────────────────────────────────────
// Native `input type="checkbox"` + `accentColor: color('primary')`; the whole row is a native
// `<label>` wrapping the input, so clicking the label text toggles it too (no manual handler
// needed for "row clickable").
export interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange?: (b: boolean) => void;
}
export function Checkbox({ label, checked, onChange }: CheckboxProps) {
  return React.createElement(
    'label',
    {
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: space('sm'),
        cursor: 'pointer',
        font: `16px ${FONT}`,
        color: color('text'),
      },
    },
    React.createElement('input', {
      type: 'checkbox',
      checked,
      onChange: (e: { target: { checked: boolean } }) => {
        emitUiEvent('press', label);
        if (onChange) onChange(e.target.checked);
      },
      style: {
        accentColor: color('primary'),
        width: '18px',
        height: '18px',
        cursor: 'pointer',
        margin: 0,
      },
    }),
    label,
  );
}

// ── Slider ────────────────────────────────────────────────────────────────────
// Native `input type="range"` + `accentColor` — pseudo-element thumb styling is impossible with
// inline styles, so `accent-color` is the sanctioned lever (design D6).
export interface SliderProps {
  label?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange?: (n: number) => void;
}
export function Slider({ label, value, min = 0, max = 100, step = 1, onChange }: SliderProps) {
  const field = React.createElement('input', {
    type: 'range',
    value: Number.isFinite(value) ? value : 0,
    min,
    max,
    step,
    onChange: (e: { target: { value: string } }) => {
      const n = parseFloat(e.target.value);
      emitUiEvent('press', label ?? 'slider');
      if (onChange) onChange(Number.isNaN(n) ? 0 : n);
    },
    style: {
      accentColor: color('primary'),
      width: '100%',
      boxSizing: 'border-box',
    },
  });
  if (!label) return field;
  return React.createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: space('xs') } },
    React.createElement(
      'div',
      { style: { display: 'flex', flexDirection: 'row', justifyContent: 'space-between' } },
      React.createElement(FieldLabel, null, label),
      React.createElement(
        'span',
        {
          style: {
            fontSize: textSize('caption').size,
            lineHeight: textSize('caption').line,
            fontWeight: weight('semibold'),
            color: color('text'),
          },
        },
        String(value),
      ),
    ),
    field,
  );
}

// ── SegmentedControl ──────────────────────────────────────────────────────────
// Rounded surface container (outer radius 'md'), equal-width segments; the selected segment
// gets `primary`/`on-primary` at a radius one step smaller than the container ('sm') — the
// unselected segments stay transparent with the plain text color.
export interface SegmentedControlProps {
  options: string[];
  value: string;
  onChange?: (s: string) => void;
}
export function SegmentedControl({ options, value, onChange }: SegmentedControlProps) {
  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'row',
        background: color('surface'),
        border: `1px solid ${color('border')}`,
        borderRadius: radius('md'),
        padding: '2px',
        gap: '2px',
        boxSizing: 'border-box',
      },
    },
    ...options.map((option) => {
      const selected = option === value;
      return React.createElement(
        'button',
        {
          key: option,
          type: 'button',
          onClick: () => {
            emitUiEvent('press', option);
            if (onChange) onChange(option);
          },
          style: {
            flex: '1 1 0',
            font: `500 14px ${FONT}`,
            padding: `${space('xs')} ${space('sm')}`,
            border: 'none',
            borderRadius: radius('sm'),
            background: selected ? color('primary') : 'transparent',
            color: selected ? color('on-primary') : color('text'),
            cursor: 'pointer',
          },
        },
        option,
      );
    }),
  );
}
