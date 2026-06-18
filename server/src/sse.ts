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
 */
export function buildSseStream(
  source: AsyncIterable<GenerationEvent>,
  keepaliveMs?: number,
): ReadableStream<Uint8Array> {
  let id = 0;
  const useKeepalive = typeof keepaliveMs === 'number' && keepaliveMs > 0;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let keepaliveInterval: ReturnType<typeof setInterval> | undefined;

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
          id++;
          controller.enqueue(enc.encode(eventFrame(event, id)));
        }
      } catch (err) {
        if (keepaliveInterval !== undefined) clearInterval(keepaliveInterval);
        controller.error(err);
        return;
      }

      if (keepaliveInterval !== undefined) clearInterval(keepaliveInterval);
      controller.close();
    },
  });
}
