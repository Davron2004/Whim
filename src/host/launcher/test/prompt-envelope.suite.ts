/**
 * prompt-envelope Node suite (task 1.2 §24-26, `installed-apps.spec.md`) — `parsePromptEnvelope`
 * over valid v1 envelopes, invalid JSON, and wrong-shape JSON, all falling back to the raw
 * string rather than throwing (History's "does not error" requirement).
 */

import { Harness } from './harness';
import { parsePromptEnvelope } from '../prompt-envelope';

export async function runPromptEnvelopeTests(h: Harness): Promise<void> {
  // §24 valid v1 envelope
  await h.test('prompt-envelope §24 valid v1 envelope parses to its text', () => {
    h.eq(parsePromptEnvelope('{"v":1,"text":"make a tip splitter"}'), { text: 'make a tip splitter' }, 'valid envelope parses');
  });

  // §25 invalid JSON falls back to the raw string, unchanged, without throwing
  await h.test('prompt-envelope §25 invalid JSON falls back to the raw string', () => {
    h.eq(parsePromptEnvelope('Example: track water'), { text: 'Example: track water' }, 'raw legacy prompt string falls back unchanged');
    h.eq(parsePromptEnvelope(''), { text: '' }, 'empty string falls back unchanged');
    h.eq(parsePromptEnvelope('{not json'), { text: '{not json' }, 'malformed JSON falls back unchanged');
  });

  // §26 wrong shape falls back the same way
  await h.test('prompt-envelope §26 wrong-shape JSON falls back to the raw string', () => {
    h.eq(parsePromptEnvelope('{"v":2,"text":"future version"}'), { text: '{"v":2,"text":"future version"}' }, 'v !== 1 falls back');
    h.eq(parsePromptEnvelope('{"v":1}'), { text: '{"v":1}' }, 'missing text falls back');
    h.eq(parsePromptEnvelope('{"v":1,"text":42}'), { text: '{"v":1,"text":42}' }, 'non-string text falls back');
    h.eq(parsePromptEnvelope('42'), { text: '42' }, 'a bare JSON number falls back');
    h.eq(parsePromptEnvelope('[1,2,3]'), { text: '[1,2,3]' }, 'a JSON array falls back');
    h.eq(parsePromptEnvelope('null'), { text: 'null' }, 'JSON null falls back');
  });
}
