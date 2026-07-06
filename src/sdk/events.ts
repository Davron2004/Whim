// ─────────────────────────────────────────────────────────────────────────────
// vc-sdk — internal one-way UI-event transport (constraint #2)
// ─────────────────────────────────────────────────────────────────────────────
// Extracted out of `index.tsx` so sibling SDK modules (`controls.tsx`, `surfaces.tsx` — design
// D5) can share the SAME emitter instead of duplicating it or importing back into the barrel
// (which would make `index.tsx` <-> `controls.tsx` circular). Not part of the public `vc-sdk`
// surface — `index.tsx` re-exports components, never this.
//
// A press/toggle/change is surfaced to the RN host as a one-way string on the §5.6 transport —
// the same pipe that later carries the syscall RPC envelope. It grants the app NOTHING (fire-
// and-forget, no return value, no native handle); it only lets a user interaction reach the host
// (sandbox-rendering: "a tap reaches the host"). If the transport stub is absent (e.g. a plain
// desktop preview with no host), this is a no-op.
export function emitUiEvent(type: string, label?: string): void {
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
