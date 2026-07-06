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
import { TAP_RESET } from './press';

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
      userSelect: 'text',
      WebkitUserSelect: 'text',
      ...TAP_RESET,
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
        ...TAP_RESET,
      },
    },
    ...(label ? [React.createElement(FieldLabel, { key: 'label' }, label)] : []),
    track,
  );
}

// ── Checkbox ──────────────────────────────────────────────────────────────────
// Custom div box (native `input type="checkbox"` renders a bright white unchecked square that
// clashes on dark themes) speaking the same visual language as `Switch` above: the whole row is
// the ONLY click target (no handler on the box itself), so label + box always toggle together
// from a single event.
export interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange?: (b: boolean) => void;
}
export function Checkbox({ label, checked, onChange }: CheckboxProps) {
  const box = React.createElement(
    'div',
    {
      style: {
        boxSizing: 'border-box',
        width: '22px',
        height: '22px',
        borderRadius: radius('sm'),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        background: checked ? color('primary') : 'transparent',
        border: `2px solid ${checked ? color('primary') : color('border')}`,
        transition: 'background 120ms ease, border 120ms ease',
      },
    },
    checked
      ? React.createElement(
          'span',
          {
            style: {
              fontSize: '14px',
              fontWeight: weight('bold'),
              lineHeight: '1',
              color: color('on-primary'),
            },
          },
          '✓',
        )
      : null,
  );
  return React.createElement(
    'div',
    {
      role: 'checkbox',
      'aria-checked': checked,
      onClick: () => {
        emitUiEvent('press', label);
        if (onChange) onChange(!checked);
      },
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: space('sm'),
        cursor: 'pointer',
        font: `16px ${FONT}`,
        color: color('text'),
        ...TAP_RESET,
      },
    },
    box,
    label,
  );
}

// ── Slider ────────────────────────────────────────────────────────────────────
// Custom pointer-driven track — the native `input type="range"` renders a glaring white
// unfilled track on dark themes and its thumb is not stylable with inline styles, so this is a
// plain div track/fill/thumb driven by Pointer Events instead of `accent-color`. The touch
// region is a taller, invisible container around a slim visual track (so the draggable area
// stays comfortable while the rendered track stays thin); pointer capture on that container
// keeps the drag live even once the pointer leaves the track's own bounds.
interface SliderTrackEl {
  getBoundingClientRect(): { left: number; width: number };
}
type SliderPointerEvent = {
  clientX: number;
  pointerId: number;
  currentTarget: {
    setPointerCapture(pointerId: number): void;
    releasePointerCapture(pointerId: number): void;
  };
};

export interface SliderProps {
  label?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange?: (n: number) => void;
}
export function Slider({ label, value, min = 0, max = 100, step = 1, onChange }: SliderProps) {
  const trackRef = React.useRef<SliderTrackEl | null>(null);
  const draggingRef = React.useRef(false);
  const safeValue = Number.isFinite(value) ? value : min;
  const lastEmittedRef = React.useRef(safeValue);

  // Raw pointer position -> quantized value; only calls `onChange` when the quantized result
  // actually moves (keeps the last emitted value in `lastEmittedRef` so a sub-step jitter
  // doesn't spam identical onChange calls).
  const commit = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const pct = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
    const raw = min + pct * (max - min);
    const stepped = Math.round((raw - min) / step) * step + min;
    const next = Math.min(max, Math.max(min, stepped));
    if (next !== lastEmittedRef.current) {
      lastEmittedRef.current = next;
      if (onChange) onChange(next);
    }
  };

  const clampedValue = Math.min(max, Math.max(min, safeValue));
  const pct = max > min ? ((clampedValue - min) / (max - min)) * 100 : 0;

  const touchArea = React.createElement(
    'div',
    {
      style: {
        boxSizing: 'border-box',
        width: '100%',
        paddingTop: space('sm'),
        paddingBottom: space('sm'),
        touchAction: 'none',
        ...TAP_RESET,
      },
      onPointerDown: (e: SliderPointerEvent) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        draggingRef.current = true;
        commit(e.clientX);
      },
      onPointerMove: (e: SliderPointerEvent) => {
        if (!draggingRef.current) return;
        commit(e.clientX);
      },
      onPointerUp: (e: SliderPointerEvent) => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
        emitUiEvent('press', label ?? 'slider');
      },
      onPointerCancel: (e: SliderPointerEvent) => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
        emitUiEvent('press', label ?? 'slider');
      },
    },
    React.createElement(
      'div',
      {
        ref: trackRef,
        style: {
          position: 'relative',
          height: '8px',
          borderRadius: radius('full'),
          background: color('surface'),
          border: `1px solid ${color('border')}`,
          overflow: 'visible',
        },
      },
      React.createElement('div', {
        style: {
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: `${pct}%`,
          background: color('primary'),
          borderRadius: radius('full'),
        },
      }),
      React.createElement('div', {
        style: {
          position: 'absolute',
          width: '22px',
          height: '22px',
          borderRadius: radius('full'),
          background: color('primary'),
          border: `2px solid ${color('on-primary')}`,
          left: `calc(${pct}% - 11px)`,
          top: '50%',
          transform: 'translateY(-50%)',
        },
      }),
    ),
  );

  if (!label) return touchArea;
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
    touchArea,
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
            ...TAP_RESET,
          },
        },
        option,
      );
    }),
  );
}
