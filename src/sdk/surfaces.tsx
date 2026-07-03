// ─────────────────────────────────────────────────────────────────────────────
// vc-sdk — layout/display surfaces (design sdk-design-system D5/D6)
// ─────────────────────────────────────────────────────────────────────────────
// Sibling module to `index.tsx` (the barrel re-exports everything below — design D5: "New
// components live in ... src/sdk/surfaces.tsx ... re-exported through index.tsx"). Same two hard
// contracts as index.tsx/controls.tsx apply here: components accept TOKENS, not values
// (tokens.ts), and the only ambient capability touched is the one-way
// `ReactNativeWebView.postMessage` transport via `emitUiEvent` (constraint #2, shared from
// `events.ts` — not duplicated).
import * as React from 'react';
import { space, radius, color, weight, textSize, type SpaceToken, type RadiusToken } from './tokens';
import { emitUiEvent } from './events';

// ── Card ──────────────────────────────────────────────────────────────────────
// Surface bg + 1px border, no native button semantics (a generic container, not nested invalid
// HTML) — `onPress`, when present, makes the whole element clickable: cursor pointer, emits the
// interaction over the one-way transport, then runs the app's own handler (same order as
// `Button`/the controls in `controls.tsx`).
export interface CardProps {
  padding?: SpaceToken;
  radius?: RadiusToken;
  onPress?: () => void;
  children?: React.ReactNode;
}
export function Card({ padding = 'lg', radius: radiusToken = 'lg', onPress, children }: CardProps) {
  return React.createElement(
    'div',
    {
      onClick: onPress
        ? () => {
            emitUiEvent('press', 'card');
            onPress();
          }
        : undefined,
      style: {
        boxSizing: 'border-box',
        padding: space(padding),
        borderRadius: radius(radiusToken),
        background: color('surface'),
        border: `1px solid ${color('border')}`,
        cursor: onPress ? 'pointer' : undefined,
      },
    },
    children,
  );
}

// ── Divider ───────────────────────────────────────────────────────────────────
// A 1px hairline, full width. No margin — spacing belongs to the surrounding `Stack`'s gap.
export function Divider() {
  return React.createElement('div', {
    style: {
      width: '100%',
      height: '1px',
      background: color('border'),
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
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: space(gap),
      },
    },
    children,
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────────
// An inline pill: tinted background (tone color + an 8-digit-hex alpha suffix), text in the
// tone's plain color. `neutral` reads through the `text-muted` role instead of a color token
// named `neutral` (there isn't one — D2's roles are the closed vocabulary).
export type BadgeTone = 'neutral' | 'primary' | 'positive' | 'warning' | 'danger';
export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
}
function badgeToneColor(tone: BadgeTone): string {
  return tone === 'neutral' ? color('text-muted') : color(tone);
}
export function Badge({ label, tone = 'neutral' }: BadgeProps) {
  const toneColor = badgeToneColor(tone);
  return React.createElement(
    'span',
    {
      style: {
        display: 'inline-block',
        borderRadius: radius('full'),
        padding: `${space('xs')} ${space('sm')}`,
        background: `${toneColor}22`,
        color: toneColor,
        fontSize: textSize('caption').size,
        lineHeight: textSize('caption').line,
        fontWeight: weight('medium'),
      },
    },
    label,
  );
}

// ── ProgressBar ───────────────────────────────────────────────────────────────
// `value` is clamped to [0, 1] before it ever reaches a style — an out-of-range prop can't
// overflow or invert the filled span.
export interface ProgressBarProps {
  value: number;
  tone?: 'primary' | 'positive' | 'warning' | 'danger';
}
export function ProgressBar({ value, tone = 'primary' }: ProgressBarProps) {
  const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  return React.createElement(
    'div',
    {
      style: {
        width: '100%',
        height: '8px',
        boxSizing: 'border-box',
        borderRadius: radius('full'),
        background: color('surface'),
        border: `1px solid ${color('border')}`,
        overflow: 'hidden',
      },
    },
    React.createElement('span', {
      style: {
        display: 'block',
        width: `${clamped * 100}%`,
        height: '100%',
        borderRadius: radius('full'),
        background: color(tone),
      },
    }),
  );
}

// ── List / ListItem ───────────────────────────────────────────────────────────
// `List` is a Card-like container (surface bg, border, radius 'lg') with zero padding of its
// own — each child is wrapped so every child but the first grows a hairline top border,
// producing dividers between rows without a separate `Divider` per row.
export interface ListProps {
  children?: React.ReactNode;
}
export function List({ children }: ListProps) {
  const items = React.Children.toArray(children);
  return React.createElement(
    'div',
    {
      style: {
        boxSizing: 'border-box',
        borderRadius: radius('lg'),
        background: color('surface'),
        border: `1px solid ${color('border')}`,
        overflow: 'hidden',
      },
    },
    ...items.map((child, i) =>
      React.createElement(
        'div',
        {
          key: i,
          style: i > 0 ? { borderTop: `1px solid ${color('border')}` } : undefined,
        },
        child,
      ),
    ),
  );
}

export interface ListItemProps {
  title: string;
  subtitle?: string;
  trailing?: string;
  onPress?: () => void;
}
export function ListItem({ title, subtitle, trailing, onPress }: ListItemProps) {
  return React.createElement(
    'div',
    {
      onClick: onPress
        ? () => {
            emitUiEvent('press', title);
            onPress();
          }
        : undefined,
      style: {
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space('md'),
        padding: `${space('md')} ${space('lg')}`,
        cursor: onPress ? 'pointer' : undefined,
      },
    },
    React.createElement(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: space('xs') } },
      React.createElement(
        'span',
        {
          style: {
            fontSize: textSize('body').size,
            lineHeight: textSize('body').line,
            fontWeight: weight('medium'),
            color: color('text'),
          },
        },
        title,
      ),
      ...(subtitle
        ? [
            React.createElement(
              'span',
              {
                key: 'subtitle',
                style: {
                  fontSize: textSize('caption').size,
                  lineHeight: textSize('caption').line,
                  fontWeight: weight('regular'),
                  color: color('text-muted'),
                },
              },
              subtitle,
            ),
          ]
        : []),
    ),
    ...(trailing
      ? [
          React.createElement(
            'span',
            {
              key: 'trailing',
              style: {
                fontSize: textSize('body').size,
                lineHeight: textSize('body').line,
                fontWeight: weight('regular'),
                color: color('text-muted'),
                flexShrink: 0,
              },
            },
            trailing,
          ),
        ]
      : []),
  );
}

// ── EmptyState ────────────────────────────────────────────────────────────────
// A centered, muted column — the "nothing here yet" placeholder every record-backed screen
// needs.
export interface EmptyStateProps {
  title: string;
  hint?: string;
}
export function EmptyState({ title, hint }: EmptyStateProps) {
  return React.createElement(
    'div',
    {
      style: {
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: space('xs'),
        padding: space('xl'),
      },
    },
    React.createElement(
      'span',
      {
        style: {
          fontSize: textSize('subtitle').size,
          lineHeight: textSize('subtitle').line,
          fontWeight: weight('medium'),
          color: color('text'),
        },
      },
      title,
    ),
    ...(hint
      ? [
          React.createElement(
            'span',
            {
              key: 'hint',
              style: {
                fontSize: textSize('caption').size,
                lineHeight: textSize('caption').line,
                fontWeight: weight('regular'),
                color: color('text-muted'),
              },
            },
            hint,
          ),
        ]
      : []),
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────
// Renders `null` when hidden — a mini-app conditionally renders a `Modal` the same way it would
// any other component, no imperative show/hide API (deferred — design Non-Goals: "Toast/Alert").
// A backdrop tap calls `onClose`; a tap inside the sheet stops propagation so it never bubbles
// to the backdrop's own handler.
export interface ModalProps {
  visible: boolean;
  title?: string;
  onClose: () => void;
  children?: React.ReactNode;
}
export function Modal({ visible, title, onClose, children }: ModalProps) {
  if (!visible) return null;
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
        background: 'rgba(0,0,0,0.5)',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
      },
    },
    React.createElement(
      'div',
      {
        onClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
        style: {
          boxSizing: 'border-box',
          width: '100%',
          background: color('bg'),
          borderTopLeftRadius: radius('lg'),
          borderTopRightRadius: radius('lg'),
          paddingTop: space('lg'),
          paddingRight: space('lg'),
          // Extra clearance so the sheet's content/close affordance doesn't sit flush against
          // Android's gesture-nav pill.
          paddingBottom: space('xl'),
          paddingLeft: space('lg'),
          display: 'flex',
          flexDirection: 'column',
          gap: space('md'),
        },
      },
      ...(title
        ? [
            React.createElement(
              'div',
              {
                key: 'title',
                style: {
                  fontSize: textSize('subtitle').size,
                  lineHeight: textSize('subtitle').line,
                  fontWeight: weight('bold'),
                  color: color('text'),
                },
              },
              title,
            ),
          ]
        : []),
      children,
    ),
  );
}
