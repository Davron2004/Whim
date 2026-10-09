// ─────────────────────────────────────────────────────────────────────────────
// vc-sdk — interactive form controls (design sdk-design-system D5/D6)
// ─────────────────────────────────────────────────────────────────────────────
// Sibling module to `index.tsx` (the barrel re-exports everything below — design D5: "New
// components live in src/sdk/controls.tsx ... re-exported through index.tsx"). Same two hard
// contracts as index.tsx apply here: components accept TOKENS, not values (tokens.ts), and the
// only ambient capability touched is the one-way `ReactNativeWebView.postMessage` transport via
// `emitUiEvent` (constraint #2, shared from `events.ts` — not duplicated).
import * as React from 'react';
import { space, radius, color, weight, textSize, textColor, activeTheme, FONT, TABULAR_NUMS } from './tokens';
import { emitUiEvent } from './events';
import { CONTROL_RESET, TAP_RESET } from './press';
import { Glyph } from './icon';
import { LAYOUT } from '../design/tokens';

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
        ...CONTROL_RESET,
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
        ...CONTROL_RESET,
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
            ...CONTROL_RESET,
          },
        },
        option,
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

  const target = LAYOUT.touchTarget[activeTheme().platform];
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
  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space('md'),
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
// The field anatomy of system.md §7.1 (surface, 1 px border, r-md, padding 12 × 14, body text, a
// 2 pt text-colour border while focused) drawn around the value, with the platform's own control
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
        position: 'relative',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: space('sm'),
        width: '100%',
        padding: focused ? '11px 13px' : '12px 14px',
        border: focused ? `2px solid ${color('text')}` : `1px solid ${color('border')}`,
        borderRadius: radius('md'),
        background: color('surface'),
        fontFamily: FONT,
        fontSize: body.size,
        lineHeight: body.line,
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
  if (!label) return field;
  return React.createElement(
    'label',
    { style: { display: 'flex', flexDirection: 'column', gap: space('xs') } },
    React.createElement(FieldLabel, null, label),
    field,
  );
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
