// ─────────────────────────────────────────────────────────────────────────────
// vc-sdk — interactive form controls (design sdk-design-system D5/D6)
// ─────────────────────────────────────────────────────────────────────────────
// Sibling module to `index.tsx` (the barrel re-exports everything below — design D5: "New
// components live in src/sdk/controls.tsx ... re-exported through index.tsx"). Same two hard
// contracts as index.tsx apply here: components accept TOKENS, not values (tokens.ts), and the
// only ambient capability touched is the one-way `ReactNativeWebView.postMessage` transport via
// `emitUiEvent` (constraint #2, shared from `events.ts` — not duplicated).
import * as React from 'react';
import { space, radius, color, weight, textSize, textColor, activeTheme, FONT, TABULAR_NUMS, WEIGHT, type PaintRole } from './tokens';
import { raisedShadow, stacks, touchTarget, typeStyle, useGroupSurface } from './kit';
import { emitUiEvent } from './events';
import { CONTROL_RESET, TAP_RESET } from './press';
import { Glyph } from './icon';
import { LAYOUT } from '../design/tokens';

// ── Field anatomy (system.md §7.1, §7.2) ─────────────────────────────────────
// The label every labelled control shares: `footnote` 600 in `text-muted`, 6 px above its field.
const LABEL_GAP = '6px';

function FieldLabel({ children }: { children?: React.ReactNode }) {
  return React.createElement('span', { style: { ...typeStyle('footnote', WEIGHT.semibold), color: textColor('text-muted') } }, children);
}

/** `field` with its label above it, or the bare field. */
function labelled(label: string | undefined, field: React.ReactElement): React.ReactElement {
  if (!label) return field;
  return React.createElement(
    'label',
    { style: { display: 'flex', flexDirection: 'column', gap: LABEL_GAP } },
    React.createElement(FieldLabel, null, label),
    field,
  );
}

/** The field box: `surface` (`sheet-group` in a Modal), 1 px `border`, r-md, 12 × 14, body text;
 *  focused, a 2 px border in the app's tint (the padding gives back the extra pixel). */
function fieldBox(focused: boolean, surface: PaintRole): Record<string, unknown> {
  const body = textSize('body');
  return {
    boxSizing: 'border-box',
    width: '100%',
    margin: 0,
    padding: focused ? '11px 13px' : '12px 14px',
    border: focused ? `2px solid ${color('primary')}` : `1px solid ${color('border')}`,
    borderRadius: radius('md'),
    background: color(surface),
    color: textColor('text'),
    caretColor: color('text'),
    fontFamily: FONT,
    fontSize: body.size,
    lineHeight: body.line,
    outline: 'none',
  };
}

interface TextFieldProps {
  label?: string;
  /** The native input's own props (type, value, placeholder, onChange, …). */
  input: Record<string, unknown>;
  tabular?: boolean;
}

/** A native text-like input in the field anatomy; `TextInput` and `NumberInput` draw through it.
 *  The placeholder is drawn by the SDK in `text-muted`: the native one can't be coloured inline,
 *  and the WebView's own grey falls under 4.5:1 on the dark `surface`. */
export function TextField({ label, input, tabular = false }: TextFieldProps) {
  const [focused, setFocused] = React.useState(false);
  const surface = useGroupSurface();
  const { placeholder, ...native } = input;
  const box = fieldBox(focused, surface);
  const field = React.createElement('input', {
    ...native,
    ...(typeof placeholder === 'string' ? { 'aria-placeholder': placeholder } : {}),
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    style: {
      ...box,
      WebkitAppearance: 'none',
      MozAppearance: 'textfield',
      appearance: 'none',
      userSelect: 'text',
      WebkitUserSelect: 'text',
      ...(tabular ? TABULAR_NUMS : {}),
      ...TAP_RESET,
    },
  });
  const empty = native.value === '' || native.value === undefined;
  // One tree shape whether or not the placeholder shows, so typing the first character never
  // remounts the input (and never drops its focus).
  const shown = React.createElement(
    'div',
    { style: { position: 'relative' } },
    field,
    typeof placeholder === 'string' && placeholder !== '' && empty
      ? React.createElement(
          'span',
          {
            'aria-hidden': true,
            style: {
              position: 'absolute',
              inset: 0,
              // The field's padding plus its 1 px border, so the text sits where typing starts.
              padding: '13px 15px',
              color: textColor('text-muted'),
              fontFamily: FONT,
              fontSize: box.fontSize,
              lineHeight: box.lineHeight,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              pointerEvents: 'none',
            },
          },
          placeholder,
        )
      : null,
  );
  return labelled(label, shown);
}

// ── TextInput ──────────────────────────────────────────────────────────────────
export interface TextInputProps {
  label?: string;
  value: string;
  placeholder?: string;
  onChange?: (s: string) => void;
}
export function TextInput({ label, value, placeholder, onChange }: TextInputProps) {
  return React.createElement(TextField, {
    label,
    input: {
      type: 'text',
      value,
      placeholder,
      onChange: (e: { target: { value: string } }) => {
        if (onChange) onChange(e.target.value);
      },
    },
  });
}

/** A labelled control's row: the whole row is the button, at least the platform's touch target
 *  high, the label in `body` `text` filling the space before the control. */
function controlRow(props: Record<string, unknown>, children: React.ReactNode[]): React.ReactElement {
  const body = textSize('body');
  return React.createElement(
    'button',
    {
      type: 'button',
      ...props,
      style: {
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: space('md'),
        width: '100%',
        minHeight: `${touchTarget()}px`,
        margin: 0,
        padding: 0,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        textAlign: 'start',
        fontFamily: FONT,
        fontSize: body.size,
        lineHeight: body.line,
        color: textColor('text'),
        ...CONTROL_RESET,
      },
    },
    ...children,
  );
}

function rowLabel(label: string): React.ReactElement {
  return React.createElement('span', { key: 'label', style: { flex: '1 1 auto', minWidth: 0 } }, label);
}

// ── Switch ────────────────────────────────────────────────────────────────────
// The platform's own shape (system.md §7.2): iOS a 48 × 28 track with a 24 knob; Android Material's
// outlined 52 × 32 track whose knob grows from 16 to 24 when on. Off, the iOS track is `fill-strong`
// under a `thumb` knob; on, the track is the app's tint under an on-tint knob.
interface SwitchShape {
  width: number;
  height: number;
  border: number;
  /** Knob side and offset from the inner top-left corner, off and on. */
  off: { size: number; inset: number };
  on: { size: number; inset: number };
}
const SWITCH_SHAPE: Readonly<Record<'ios' | 'android', SwitchShape>> = {
  ios: { width: 48, height: 28, border: 0, off: { size: 24, inset: 2 }, on: { size: 24, inset: 2 } },
  android: { width: 52, height: 32, border: 2, off: { size: 16, inset: 6 }, on: { size: 24, inset: 2 } },
};

export interface SwitchProps {
  label?: string;
  value: boolean;
  onChange?: (b: boolean) => void;
}
export function Switch({ label, value, onChange }: SwitchProps) {
  const platform = activeTheme().platform;
  const shape = SWITCH_SHAPE[platform];
  const inner = shape.width - shape.border * 2;
  const knob = value ? shape.on : shape.off;
  const knobLeft = value ? inner - knob.size - knob.inset : knob.inset;
  const android = platform === 'android';
  const offTrack = android ? color('fill') : color('fill-strong');
  const offKnob = android ? color('text-muted') : color('thumb');
  const onOrOff = value ? color('primary') : color('border');
  const track = React.createElement(
    'span',
    {
      key: 'track',
      style: {
        position: 'relative',
        display: 'block',
        boxSizing: 'border-box',
        width: `${shape.width}px`,
        height: `${shape.height}px`,
        borderRadius: radius('full'),
        background: value ? color('primary') : offTrack,
        border: android ? `${shape.border}px solid ${onOrOff}` : 'none',
        flexShrink: 0,
      },
    },
    React.createElement('span', {
      style: {
        position: 'absolute',
        top: `${knob.inset}px`,
        left: 0,
        width: `${knob.size}px`,
        height: `${knob.size}px`,
        borderRadius: radius('full'),
        background: value ? color('on-primary') : offKnob,
        boxShadow: !android && !value ? raisedShadow() : 'none',
        transform: `translateX(${knobLeft}px)`,
        transition: 'transform 150ms ease',
      },
    }),
  );
  return controlRow(
    {
      role: 'switch',
      'aria-checked': value,
      'aria-label': label,
      onClick: () => {
        emitUiEvent('press', label ?? 'switch');
        if (onChange) onChange(!value);
      },
    },
    [...(label ? [rowLabel(label)] : []), track],
  );
}

// ── Checkbox ──────────────────────────────────────────────────────────────────
// A 24 box, r-sm, 2 px `border`; checked, the app's tint with an on-tint `check`. The whole row is
// the target and the only click handler, so box and label always toggle together.
const CHECKBOX_SIZE = 24;

export interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange?: (b: boolean) => void;
}
export function Checkbox({ label, checked, onChange }: CheckboxProps) {
  const box = React.createElement(
    'span',
    {
      key: 'box',
      style: {
        boxSizing: 'border-box',
        width: `${CHECKBOX_SIZE}px`,
        height: `${CHECKBOX_SIZE}px`,
        borderRadius: radius('sm'),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        background: checked ? color('primary') : 'transparent',
        border: `2px solid ${checked ? color('primary') : color('border')}`,
      },
    },
    checked ? React.createElement(Glyph, { name: 'check', sizePx: 16, colorValue: color('on-primary') }) : null,
  );
  return controlRow(
    {
      role: 'checkbox',
      'aria-checked': checked,
      onClick: () => {
        emitUiEvent('press', label);
        if (onChange) onChange(!checked);
      },
    },
    [box, rowLabel(label)],
  );
}

// ── Slider ────────────────────────────────────────────────────────────────────
// A 6 px `fill-strong` track with the app's tint up to a 28 `thumb`, driven by Pointer Events with
// pointer capture (the native range input can't be styled inline). The touch area is the platform's
// target high, and the track is inset by half a thumb so the thumb never leaves the control.
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
const SLIDER_TRACK = 6;
const SLIDER_THUMB = 28;

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
  const release = (e: SliderPointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    emitUiEvent('press', label ?? 'slider');
  };

  const clampedValue = Math.min(max, Math.max(min, safeValue));
  const pct = max > min ? ((clampedValue - min) / (max - min)) * 100 : 0;

  const touchArea = React.createElement(
    'div',
    {
      role: 'slider',
      'aria-label': label,
      'aria-valuenow': clampedValue,
      'aria-valuemin': min,
      'aria-valuemax': max,
      style: {
        boxSizing: 'border-box',
        width: '100%',
        height: `${touchTarget()}px`,
        padding: `0 ${SLIDER_THUMB / 2}px`,
        display: 'flex',
        alignItems: 'center',
        touchAction: 'none',
        cursor: 'pointer',
        ...CONTROL_RESET,
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
      onPointerUp: release,
      onPointerCancel: release,
    },
    React.createElement(
      'div',
      {
        ref: trackRef,
        style: {
          position: 'relative',
          flexGrow: 1,
          height: `${SLIDER_TRACK}px`,
          borderRadius: radius('full'),
          background: color('fill-strong'),
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
          width: `${SLIDER_THUMB}px`,
          height: `${SLIDER_THUMB}px`,
          borderRadius: radius('full'),
          background: color('thumb'),
          boxShadow: raisedShadow(),
          left: `calc(${pct}% - ${SLIDER_THUMB / 2}px)`,
          top: `${(SLIDER_TRACK - SLIDER_THUMB) / 2}px`,
        },
      }),
    ),
  );

  if (!label) return touchArea;
  const body = textSize('body');
  return React.createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column' } },
    React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          columnGap: space('md'),
          fontSize: body.size,
          lineHeight: body.line,
        },
      },
      React.createElement('span', { style: { color: textColor('text') } }, label),
      React.createElement('span', { style: { color: textColor('text-muted'), ...TABULAR_NUMS } }, String(value)),
    ),
    touchArea,
  );
}

// ── SegmentedControl ──────────────────────────────────────────────────────────
// A `fill` capsule 36 high with a `thumb` under the selected option, labels `callout` 600 in `text`.
// Like the Stepper, the capsule is drawn behind buttons that are the platform's target high.
const SEGMENT_VISUAL = LAYOUT.minHitVisual;
const SEGMENT_INSET = 2;

export interface SegmentedControlProps {
  options: string[];
  value: string;
  onChange?: (s: string) => void;
}
export function SegmentedControl({ options, value, onChange }: SegmentedControlProps) {
  const target = touchTarget();
  const capsuleTop = (target - SEGMENT_VISUAL) / 2;
  const label = typeStyle('callout', WEIGHT.semibold);
  const dark = activeTheme().scheme === 'dark';
  return React.createElement(
    'div',
    {
      role: 'radiogroup',
      style: {
        position: 'relative',
        display: 'flex',
        flexDirection: 'row',
        minHeight: `${target}px`,
        padding: `0 ${SEGMENT_INSET}px`,
        boxSizing: 'border-box',
      },
    },
    React.createElement('div', {
      key: 'capsule',
      style: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: `${capsuleTop}px`,
        bottom: `${capsuleTop}px`,
        borderRadius: radius('full'),
        background: color('fill'),
      },
    }),
    ...options.map((option, i) => {
      const selected = option === value;
      return React.createElement(
        'button',
        {
          key: `${i}:${option}`,
          type: 'button',
          role: 'radio',
          'aria-checked': selected,
          onClick: () => {
            emitUiEvent('press', option);
            if (onChange) onChange(option);
          },
          style: {
            position: 'relative',
            flex: '1 1 0',
            minWidth: 0,
            margin: 0,
            minHeight: `${target}px`,
            padding: `0 ${space('md')}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            background: 'transparent',
            fontFamily: FONT,
            ...label,
            color: textColor('text'),
            cursor: 'pointer',
            ...CONTROL_RESET,
          },
        },
        selected
          ? React.createElement('span', {
              key: 'thumb',
              style: {
                position: 'absolute',
                left: 0,
                right: 0,
                top: `${capsuleTop + SEGMENT_INSET}px`,
                bottom: `${capsuleTop + SEGMENT_INSET}px`,
                borderRadius: radius('full'),
                background: color('thumb'),
                boxShadow: dark ? 'none' : raisedShadow(),
              },
            })
          : null,
        React.createElement('span', { key: 'label', style: { position: 'relative' } }, option),
      );
    }),
  );
}

// ── Stepper ───────────────────────────────────────────────────────────────────
// Label at the start; at the end a `fill` capsule 36 high holding minus, the tabular value and plus.
// Each button is 44 wide and as tall as the platform's touch target, so the capsule is the visual
// and the box around it is the target (system.md §7.2). Holding a button repeats after 400 ms at
// 8 steps a second; a button at its bound is disabled.
const STEPPER_VISUAL_HEIGHT = LAYOUT.minHitVisual;
const STEPPER_BUTTON_WIDTH = 44;
/** How long a press is held before it repeats, and the repeat period (8 a second). */
export const STEPPER_HOLD_MS = 400;
export const STEPPER_REPEAT_MS = 125;

export interface StepperProps {
  label?: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

/** Decimal places of `step`, so repeated steps never accumulate float error (0.1 + 0.2). */
function decimalsOf(step: number): number {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

export function Stepper({ label, value, onChange, min = 0, max, step = 1 }: StepperProps) {
  const safeStep = Number.isFinite(step) && step > 0 ? step : 1;
  const upper = max !== undefined && Number.isFinite(max) ? max : Infinity;
  const current = Number.isFinite(value) ? value : min;
  const latest = React.useRef(current);
  latest.current = current;
  const repeat = React.useRef<{ hold?: ReturnType<typeof setTimeout>; tick?: ReturnType<typeof setInterval> }>({});

  const stop = React.useCallback(() => {
    clearTimeout(repeat.current.hold);
    clearInterval(repeat.current.tick);
    repeat.current = {};
  }, []);
  React.useEffect(() => stop, [stop]);

  const stepBy = (direction: 1 | -1): boolean => {
    const raw = latest.current + direction * safeStep;
    const next = Math.min(upper, Math.max(min, Number(raw.toFixed(decimalsOf(safeStep)))));
    if (next === latest.current) return false;
    latest.current = next;
    onChange(next);
    return true;
  };

  const startRepeat = (direction: 1 | -1): void => {
    stop();
    const tick = (): void => {
      if (!stepBy(direction)) stop();
    };
    repeat.current.hold = setTimeout(() => {
      repeat.current.tick = setInterval(tick, STEPPER_REPEAT_MS);
    }, STEPPER_HOLD_MS);
  };

  const button = (direction: 1 | -1) => {
    const disabled = direction === 1 ? current >= upper : current <= min;
    const name = direction === 1 ? 'Increase' : 'Decrease';
    return React.createElement(
      'button',
      {
        key: name,
        type: 'button',
        'aria-label': name,
        disabled,
        onPointerDown: () => {
          if (disabled) return;
          emitUiEvent('press', label ?? name);
          if (stepBy(direction)) startRepeat(direction);
        },
        onPointerUp: stop,
        onPointerLeave: stop,
        onPointerCancel: stop,
        // A pointer press already stepped on pointerdown; only a keyboard activation (a click with
        // no pointer, `detail` 0) steps here.
        onClick: (e: { detail: number }) => {
          if (disabled || e.detail !== 0) return;
          emitUiEvent('press', label ?? name);
          stepBy(direction);
        },
        style: {
          position: 'relative',
          boxSizing: 'border-box',
          width: `${STEPPER_BUTTON_WIDTH}px`,
          height: '100%',
          padding: 0,
          border: 'none',
          background: 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: disabled ? color('text-3') : textColor('text'),
          cursor: disabled ? 'default' : 'pointer',
          touchAction: 'manipulation',
          ...CONTROL_RESET,
        },
      },
      React.createElement(Glyph, { name: direction === 1 ? 'plus' : 'minus', sizePx: 20 }),
    );
  };

  const target = touchTarget();
  const valueSize = textSize('subtitle');
  const group = React.createElement(
    'div',
    {
      role: 'spinbutton',
      'aria-label': label,
      'aria-valuenow': current,
      'aria-valuemin': min,
      ...(upper === Infinity ? {} : { 'aria-valuemax': upper }),
      style: {
        position: 'relative',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        height: `${target}px`,
        // Its own width, never stretched across a Stack.
        width: 'max-content',
        flexShrink: 0,
      },
    },
    React.createElement('div', {
      key: 'capsule',
      style: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: `${(target - STEPPER_VISUAL_HEIGHT) / 2}px`,
        height: `${STEPPER_VISUAL_HEIGHT}px`,
        borderRadius: radius('full'),
        background: color('fill'),
      },
    }),
    button(-1),
    React.createElement(
      'span',
      {
        key: 'value',
        style: {
          position: 'relative',
          minWidth: '2ch',
          textAlign: 'center',
          fontSize: valueSize.size,
          lineHeight: valueSize.line,
          letterSpacing: valueSize.tracking,
          fontWeight: weight(valueSize.weight),
          color: textColor('text'),
          ...TABULAR_NUMS,
        },
      },
      String(current),
    ),
    button(1),
  );
  if (!label) return group;
  const body = textSize('body');
  // From 135% the label goes above the capsule (system.md §6).
  const stacked = stacks();
  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: stacked ? 'column' : 'row',
        alignItems: stacked ? 'flex-start' : 'center',
        justifyContent: 'space-between',
        gap: stacked ? space('xs') : space('md'),
        fontSize: body.size,
        lineHeight: body.line,
        color: textColor('text'),
      },
    },
    React.createElement('span', null, label),
    group,
  );
}

// ── Field shell (DateInput, Picker) ───────────────────────────────────────────
// The field anatomy (`fieldBox`) drawn around the value, with the platform's own control
// laid over it fully transparent: a tap lands on the native element and opens the native picker or
// list, while no native chrome ever shows. Pure SDK styles; nothing in the sandbox changes.
interface FieldShellProps {
  label?: string;
  /** The text the field shows; absent = the placeholder, in `text-muted`. */
  shown?: string;
  placeholder: string;
  leadingIcon?: string;
  trailingIcon?: string;
  /** The transparent native control, given its overlay style by the shell. */
  renderNative: (overlay: Record<string, unknown>, focus: { onFocus: () => void; onBlur: () => void }) => React.ReactElement;
}

function FieldShell({ label, shown, placeholder, leadingIcon, trailingIcon, renderNative }: FieldShellProps) {
  const [focused, setFocused] = React.useState(false);
  const surface = useGroupSurface();
  const body = textSize('body');
  const overlay = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    margin: 0,
    padding: 0,
    border: 'none',
    opacity: 0,
    fontSize: body.size,
    cursor: 'pointer',
    WebkitAppearance: 'none',
    appearance: 'none',
    ...TAP_RESET,
  };
  const icon = (name: string, key: string) =>
    React.createElement(Glyph, { key, name, sizePx: 20, colorValue: textColor('text-muted') });
  const field = React.createElement(
    'div',
    {
      style: {
        ...fieldBox(focused, surface),
        position: 'relative',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: space('sm'),
      },
    },
    ...(leadingIcon ? [icon(leadingIcon, 'leading')] : []),
    React.createElement(
      'span',
      {
        key: 'shown',
        style: {
          flexGrow: 1,
          minWidth: 0,
          color: shown === undefined ? textColor('text-muted') : textColor('text'),
          ...(shown === undefined ? {} : TABULAR_NUMS),
        },
      },
      shown ?? placeholder,
    ),
    ...(trailingIcon ? [icon(trailingIcon, 'trailing')] : []),
    React.cloneElement(
      renderNative(overlay, { onFocus: () => setFocused(true), onBlur: () => setFocused(false) }),
      { key: 'native' },
    ),
  );
  return labelled(label, field);
}

// ── DateInput ─────────────────────────────────────────────────────────────────
// The value is epoch milliseconds (the storage `date` field's own shape) or null when unset. `date`
// mode stores local midnight of the picked day; `time` keeps the value's day (today when unset);
// `datetime` stores the picked local minute.
export type DateInputMode = 'date' | 'time' | 'datetime';

export interface DateInputProps {
  label?: string;
  value: number | null;
  onChange: (ms: number | null) => void;
  mode?: DateInputMode;
}

const NATIVE_TYPE: Readonly<Record<DateInputMode, string>> = { date: 'date', time: 'time', datetime: 'datetime-local' };
const DATE_FORMAT: Readonly<Record<DateInputMode, Intl.DateTimeFormatOptions>> = {
  date: { dateStyle: 'medium' },
  time: { timeStyle: 'short' },
  datetime: { dateStyle: 'medium', timeStyle: 'short' },
};
const DATE_PLACEHOLDER: Readonly<Record<DateInputMode, string>> = {
  date: 'Choose a date',
  time: 'Choose a time',
  datetime: 'Choose a date and time',
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** `ms` in the native control's own value format, read in local time. */
function nativeValue(ms: number, mode: DateInputMode): string {
  const d = new Date(ms);
  const day = `${String(d.getFullYear()).padStart(4, '0')}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (mode === 'date') return day;
  if (mode === 'time') return time;
  return `${day}T${time}`;
}

/** Local time of a calendar day and minute, valid for every year (no two-digit year mapping). */
function localMs(year: number, month: number, day: number, hours: number, minutes: number): number {
  const d = new Date(0);
  d.setFullYear(year, month - 1, day);
  d.setHours(hours, minutes, 0, 0);
  return d.getTime();
}

/** The native control's value as epoch ms; null when cleared, undefined when unreadable. */
function msFromNative(text: string, mode: DateInputMode, previous: number | null): number | null | undefined {
  if (text === '') return null;
  const day = /^(\d{4,})-(\d{2})-(\d{2})/.exec(text);
  const time = /(?:^|T)(\d{2}):(\d{2})/.exec(text);
  if (mode === 'date') return day ? localMs(+day[1], +day[2], +day[3], 0, 0) : undefined;
  if (mode === 'time') {
    if (!time) return undefined;
    const base = new Date(previous !== null && Number.isFinite(previous) ? previous : Date.now());
    return localMs(base.getFullYear(), base.getMonth() + 1, base.getDate(), +time[1], +time[2]);
  }
  return day && time ? localMs(+day[1], +day[2], +day[3], +time[1], +time[2]) : undefined;
}

export function DateInput({ label, value, onChange, mode = 'date' }: DateInputProps) {
  const safeMode: DateInputMode = Object.prototype.hasOwnProperty.call(NATIVE_TYPE, mode) ? mode : 'date';
  const has = typeof value === 'number' && Number.isFinite(value);
  return React.createElement(FieldShell, {
    label,
    shown: has ? new Intl.DateTimeFormat(undefined, DATE_FORMAT[safeMode]).format(new Date(value)) : undefined,
    placeholder: DATE_PLACEHOLDER[safeMode],
    leadingIcon: safeMode === 'time' ? 'clock' : 'calendar',
    renderNative: (overlay, focus) =>
      React.createElement('input', {
        type: NATIVE_TYPE[safeMode],
        'aria-label': label ?? DATE_PLACEHOLDER[safeMode],
        value: has ? nativeValue(value, safeMode) : '',
        onChange: (e: { target: { value: string } }) => {
          const next = msFromNative(e.target.value, safeMode, has ? value : null);
          if (next === undefined) return;
          emitUiEvent('press', label ?? 'date');
          onChange(next);
        },
        ...focus,
        style: overlay,
      }),
  });
}

// ── Picker ────────────────────────────────────────────────────────────────────
// One choice from a list, through the platform's own list (a transparent native `select` over the
// field). For two to four short options a `SegmentedControl` reads better.
export interface PickerProps {
  label?: string;
  options: string[];
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
}

export function Picker({ label, options, value, onChange, placeholder = 'Choose one' }: PickerProps) {
  const list = Array.isArray(options) ? options.map(String) : [];
  const chosen = list.includes(value);
  return React.createElement(FieldShell, {
    label,
    shown: chosen ? value : undefined,
    placeholder,
    trailingIcon: 'chevron-down',
    renderNative: (overlay, focus) =>
      React.createElement(
        'select',
        {
          'aria-label': label ?? placeholder,
          value: chosen ? value : '',
          onChange: (e: { target: { value: string } }) => {
            emitUiEvent('press', label ?? 'picker');
            onChange(e.target.value);
          },
          ...focus,
          style: overlay,
        },
        ...(chosen ? [] : [React.createElement('option', { key: 'placeholder', value: '', disabled: true }, placeholder)]),
        // Keyed by position too: two equal options are still two rows.
        ...list.map((option, i) => React.createElement('option', { key: `${i}:${option}`, value: option }, option)),
      ),
  });
}
