/**
 * Minimal per-request dev logging (task 4.1, design D5): one console line per request carrying
 * method, path, status, and duration — enough during dev/LAN work to tell "the request arrived
 * and the pipeline ran" apart from "the request never arrived", without adding a log call inside
 * any response-path hot loop (SSE token emission is untouched — see `sse.ts`'s `onSettled`).
 *
 * NEVER pass request/response bodies, prompt text, or the `x-whim-device` header value here —
 * device identifiers and prompts are user data, not diagnostics.
 */
export function logRequest(method: string, path: string, status: number, startedAt: number): void {
  const durationMs = Math.round(performance.now() - startedAt);
  console.log(`[whim-server] ${method} ${path} ${status} ${durationMs}ms`);
}

/**
 * Per-run dev logging inside the generation pipeline (design D5 scope, extended for
 * observability): one `[whim-server]`-prefixed line per breadcrumb — run start, stage
 * transitions, model-call failures, repair triggers, and terminal outcomes — printed via plain
 * `console.log` with the prefix centralized here.
 *
 * NEVER pass prompt text, generated source, the `x-whim-device` header value, the OpenRouter API
 * key, or request/response bodies — the same privacy floor as `logRequest`. A logged failure
 * reason is the same product-prose string the wire's `failure` event carries (there is no
 * scrubbing step anywhere in this codebase) — the log line just adds error class/message/stack
 * detail the wire event never carries.
 */
export function logRun(...parts: unknown[]): void {
  console.log('[whim-server]', ...parts);
}
