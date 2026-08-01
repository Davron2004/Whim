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
