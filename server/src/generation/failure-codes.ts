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
] as const;
export type TerminalFailureCode = (typeof TERMINAL_FAILURE_CODES)[number];
