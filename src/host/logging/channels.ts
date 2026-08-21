/**
 * channels — the one place a log channel name is written (obs-v1, spec "One logging seam;
 * `console.*` is not a device log surface").
 *
 * These replace the string prefixes the device used to paste in front of `console.log` messages
 * (`[whim:gen]`, `[whim]`, `[whim:page]`). A call site imports a constant from here and passes it
 * to `log.<level>(...)`; it never writes the literal. Adding a channel means adding it here.
 */

/** Every declared channel, keyed by the subsystem that emits on it. */
export const CHANNELS = {
  /** Generation client + transport (was the `[whim:gen]` prefix). */
  gen: 'whim:gen',
  /** The mini-app container / WebView host (was the `[whim]` prefix). */
  app: 'whim',
  /** Log lines relayed out of the sandbox page (was the `[whim:page]` prefix). */
  page: 'whim:page',
  /** The launcher's screen error boundary. */
  screen: 'whim:screen',
  /** The logging seam reporting on itself — notably a dev-sink delivery failure. */
  sink: 'whim:sink',
} as const;

/** The closed set of channel names. A channel that is not in `CHANNELS` does not type-check. */
export type Channel = (typeof CHANNELS)[keyof typeof CHANNELS];

/** All declared channel names, for readers that enumerate (the overlay's channel filter). */
export const ALL_CHANNELS: readonly Channel[] = Object.values(CHANNELS);
