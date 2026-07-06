/**
 * SSE framing helpers.
 *
 * Frame format (per SSE spec):
 *   event: <type>\n
 *   data: <json>\n
 *   id: <monotonic-int>\n
 *   \n
 *
 * Keepalives are `:` comment lines emitted at an injectable interval while waiting for events
 * (off when keepaliveMs is 0/undefined).
 */
import type { GenerationEvent } from '@whim/contract';

const enc = new TextEncoder();

function eventFrame(event: GenerationEvent, id: number): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\nid: ${id}\n\n`;
}

const KEEPALIVE_FRAME = ': keepalive\n\n';

/**
 * Build a web `ReadableStream<Uint8Array>` from an `AsyncIterable<GenerationEvent>`.
 *
 * @param source      - The event source to drain.
 * @param keepaliveMs - Emit a keepalive comment every N ms while the stream is open.
 *                      0 or undefined = disabled.
 * @param onCancel    - Invoked (in addition to the keepalive cleanup) when the consumer cancels
 *                      the stream — the caller wires this to abort the pipeline run producing
 *                      `source`. A source that then ends early still closes this stream cleanly
 *                      (no further enqueue/close calls reach the already-cancelled controller).
 */
export function buildSseStream(
  source: AsyncIterable<GenerationEvent>,
  keepaliveMs?: number,
  onCancel?: () => void,
): ReadableStream<Uint8Array> {
  let id = 0;
  const useKeepalive = typeof keepaliveMs === 'number' && keepaliveMs > 0;
  let keepaliveInterval: ReturnType<typeof setInterval> | undefined;
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      if (useKeepalive) {
        keepaliveInterval = setInterval(() => {
          try {
            controller.enqueue(enc.encode(KEEPALIVE_FRAME));
          } catch {
            // Stream may already be closed; interval will be cleared below
          }
        }, keepaliveMs!);
      }

      try {
        for await (const event of source) {
          if (cancelled) break;
          id++;
          controller.enqueue(enc.encode(eventFrame(event, id)));
        }
      } catch (err) {
        if (keepaliveInterval !== undefined) clearInterval(keepaliveInterval);
        if (!cancelled) controller.error(err);
        return;
      }

      if (keepaliveInterval !== undefined) clearInterval(keepaliveInterval);
      if (!cancelled) controller.close();
    },
    cancel() {
      cancelled = true;
      if (keepaliveInterval !== undefined) clearInterval(keepaliveInterval);
      onCancel?.();
    },
  });
}
