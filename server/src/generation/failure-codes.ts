/**
 * The generation pipeline's terminal failure codes (developer-observability D9): one machine-
 * readable code per way a run ends in a `failure` terminal, beside the user-facing `reason`
 * sentence the wire carries. The usage ledger stores the code, never the sentence, so a failed
 * row names why it failed without holding any text. A leaf module: the ledger and the operator
 * command import it without pulling in the machine.
 */
export const TERMINAL_FAILURE_CODES = [
  'plan_failed',
  'repair_exhausted',
  'containment_failed',
  'run_unverified',
  'expired',
  'credit_exhausted',
  'internal_error',
  // The generation waited in the line for a free slot longer than the server allows (beta-1 D8).
  'queue_timeout',
] as const;
export type TerminalFailureCode = (typeof TERMINAL_FAILURE_CODES)[number];

/**
 * Why any other request failed (developer-observability F7): a clarify/rewrite model call that threw
 * or answered nothing usable, or a server-side failure (a store that threw, a route with no model
 * configured, a generation that ended without a terminal). Closed like the terminal codes, so the
 * ledger never stores an error's text.
 */
export const REQUEST_FAILURE_CODES = ['model_failure', 'internal_error'] as const;
export type RequestFailureCode = (typeof REQUEST_FAILURE_CODES)[number];
