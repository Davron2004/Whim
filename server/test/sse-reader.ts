/**
 * Test-side SSE reader: reads a Response body to completion, parses SSE frames
 * (event:/data:/id: fields separated by blank lines), and returns structured results.
 *
 * Keepalive comment lines (`: ...`) are counted but not included in parsed events.
 */
import { GenerationEvent } from '@whim/contract';

export interface ParsedSseEvent {
  id: number;
  event: string;
  data: GenerationEvent;
}

export interface SseReadResult {
  events: ParsedSseEvent[];
  keepaliveCount: number;
  skippedFrames: number;
}

/**
 * Read a `Response` whose body is a `text/event-stream` to completion.
 * Returns all parsed events and a count of keepalive comment lines.
 */
export async function readSseResponse(response: Response): Promise<SseReadResult> {
  if (!response.body) {
    throw new Error('Response has no body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let rawText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    rawText += decoder.decode(value, { stream: true });
  }
  rawText += decoder.decode(); // flush

  return parseSseText(rawText);
}

function parseSseText(text: string): SseReadResult {
  const events: ParsedSseEvent[] = [];
  let keepaliveCount = 0;
  let skippedFrames = 0;

  // Split into blocks by double newline
  const blocks = text.split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.length > 0);
    if (lines.length === 0) continue;

    // Detect keepalive comment lines (start with ':')
    const commentLines = lines.filter((l) => l.startsWith(':'));
    const fieldLines = lines.filter((l) => !l.startsWith(':'));

    keepaliveCount += commentLines.length;

    if (fieldLines.length === 0) continue;

    // Parse event/data/id fields
    let eventType: string | undefined;
    let dataStr: string | undefined;
    let idStr: string | undefined;

    for (const line of fieldLines) {
      if (line.startsWith('event: ')) {
        eventType = line.slice('event: '.length);
      } else if (line.startsWith('data: ')) {
        dataStr = line.slice('data: '.length);
      } else if (line.startsWith('id: ')) {
        idStr = line.slice('id: '.length);
      }
    }

    if (eventType === undefined || dataStr === undefined || idStr === undefined) {
      // Incomplete frame — skip
      skippedFrames++;
      continue;
    }

    const id = parseInt(idStr, 10);
    const parsedData = GenerationEvent.parse(JSON.parse(dataStr));

    events.push({ id, event: eventType, data: parsedData });
  }

  return { events, keepaliveCount, skippedFrames };
}
