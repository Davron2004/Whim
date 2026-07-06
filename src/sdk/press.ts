// ─────────────────────────────────────────────────────────────────────────────
// vc-sdk — shared tap-highlight suppression + pressed-state helper (device-review fix)
// ─────────────────────────────────────────────────────────────────────────────
// Android WebView paints its own translucent `-webkit-tap-highlight-color` highlight across
// the FULL border box of any element carrying a click/pointer handler, independent of the
// element's own visual response — a Switch's whole row flashes cyan, a ghost Button flashes
// blue. `TAP_RESET` is spread into every such element's style to suppress that native paint;
// `usePressed` gives the few components with no intrinsic visual state change (Button, Card,
// ListItem) a deliberate, correctly-sized replacement instead. Not part of the public `vc-sdk`
// surface — `index.tsx` never re-exports this module, only consumes it internally (same
// pattern as `events.ts`).
import * as React from 'react';

/** Spread into the `style` of every element that carries an `onClick`/`onPointerDown` handler
 *  so Android's system tap highlight never paints. */
export const TAP_RESET = { WebkitTapHighlightColor: 'transparent' } as const;

export interface PressHandlers {
  onPointerDown: () => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
}

/** Minimal pressed-state toggle for components whose ONLY press feedback is this state (no
 *  built-in toggle/track/knob motion to lean on already). A plain `useState` boolean flipped
 *  by the four pointer-lifecycle events that can end a press — no timers, no refs beyond the
 *  state cell itself. */
export function usePressed(): { pressed: boolean; pressHandlers: PressHandlers } {
  const [pressed, setPressed] = React.useState(false);
  const pressHandlers: PressHandlers = {
    onPointerDown: () => setPressed(true),
    onPointerUp: () => setPressed(false),
    onPointerLeave: () => setPressed(false),
    onPointerCancel: () => setPressed(false),
  };
  return { pressed, pressHandlers };
}
