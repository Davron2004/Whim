// ─────────────────────────────────────────────────────────────────────────────
// vc-sdk — toast (docs/design/system.md §7.1 Toast, §7.2)
// ─────────────────────────────────────────────────────────────────────────────
// In-page UI, not a bridge message: `toast(text)` is a module-level function like `nav`, and the
// SDK-owned `NavRoot` mounts the one `ToastHost` that draws it. Nothing crosses to the host; a realm
// reset destroys the host, its timer and any pending toast together.
import * as React from 'react';
import { SHADOWS, TOP_HIGHLIGHT, TYPE_SCALE } from '../design/tokens';
import { activeTheme, color, radius, FONT } from './tokens';

/** How long a toast stays up. */
export const TOAST_MS = 4000;
/** Clearance above whatever floats at the bottom (the orb's footprint), in CSS px. */
const TOAST_GAP_PX = 12;

type ToastListener = (text: string) => void;

let toastListener: ToastListener | undefined;

/**
 * Show a short message at the bottom of the app for 4 seconds; a second call replaces the first.
 * Calls made while the app first renders (including its first effects) are ignored, so a toast
 * always answers something the person did.
 */
export function toast(text: string): void {
  const message = String(text).trim();
  if (message !== '') toastListener?.(message);
}

interface ShownToast {
  id: number;
  text: string;
}

export interface ToastHostProps {
  /** How much of the bottom edge the host's chrome covers (the loader's sanitized inset). */
  bottomInset: number;
}

/** Repository-internal: `NavRoot` renders it after the app's screen, so its subscription (an effect)
 *  runs after the screen's first effects, which is what makes first-render calls ignored. */
export function ToastHost({ bottomInset }: ToastHostProps): React.ReactElement | null {
  const [shown, setShown] = React.useState<ShownToast | null>(null);

  React.useEffect(() => {
    let nextId = 0;
    const listener: ToastListener = (text) => {
      nextId += 1;
      setShown({ id: nextId, text });
    };
    toastListener = listener;
    return () => {
      if (toastListener === listener) toastListener = undefined;
    };
  }, []);

  const shownId = shown?.id;
  React.useEffect(() => {
    if (shownId === undefined) return undefined;
    // Keyed on the id: a replacement clears this timer and starts its own full 4 s.
    const timer = setTimeout(() => setShown(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [shownId]);

  if (!shown) return null;
  const theme = activeTheme();
  const callout = TYPE_SCALE.callout;
  return React.createElement(
    'div',
    {
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': true,
      style: {
        position: 'fixed',
        left: '50%',
        bottom: `${Math.max(0, bottomInset) + TOAST_GAP_PX}px`,
        transform: 'translateX(-50%)',
        zIndex: 1100,
        boxSizing: 'border-box',
        width: 'max-content',
        maxWidth: 'min(360px, calc(100% - 40px))',
        minHeight: '48px',
        display: 'flex',
        alignItems: 'center',
        padding: '12px 16px',
        borderRadius: radius('full'),
        background: color('raised'),
        boxShadow: `${SHADOWS['shadow-floating'][theme.scheme]}, inset 0 1px 0 ${TOP_HIGHLIGHT[theme.scheme]}`,
        color: color('text'),
        fontFamily: FONT,
        fontSize: `${Math.round(callout.size * theme.fontScale * 100) / 100}px`,
        lineHeight: `${Math.round(callout.lineHeight * theme.fontScale * 100) / 100}px`,
        letterSpacing: `${callout.tracking}em`,
        fontWeight: callout.weight,
      },
    },
    shown.text,
  );
}
