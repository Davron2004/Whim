/**
 * prompt-envelope Node suite (task 1.2 §24-26, `installed-apps.spec.md`) — `parsePromptEnvelope`
 * over the envelope versions a reader accepts, invalid JSON, and wrong-shape JSON, all falling
 * back to the raw string rather than throwing (History's "does not error" requirement), and the v2
 * envelope's round-trip (text plus the run's summary).
 */

import { Harness } from './harness';
import { parsePromptEnvelope, promptEnvelope } from '../prompt-envelope';
import { storedSummary } from '../history-logic';
import type { RunSummary } from '@whim/contract';

export async function runPromptEnvelopeTests(h: Harness): Promise<void> {
  // §24 every envelope version a reader may encounter parses to its text, with no migration
  await h.test('prompt-envelope §24 valid v1 envelope parses to its text', () => {
    h.eq(parsePromptEnvelope('{"v":1,"text":"make a tip splitter"}'), { text: 'make a tip splitter' }, 'valid envelope parses');
    h.eq(parsePromptEnvelope('{"v":2,"text":"make a tip splitter"}'), { text: 'make a tip splitter' }, 'the current envelope parses');
  });

  // §25 invalid JSON falls back to the raw string, unchanged, without throwing
  await h.test('prompt-envelope §25 invalid JSON falls back to the raw string', () => {
    h.eq(parsePromptEnvelope('Example: track water'), { text: 'Example: track water' }, 'raw legacy prompt string falls back unchanged');
    h.eq(parsePromptEnvelope(''), { text: '' }, 'empty string falls back unchanged');
    h.eq(parsePromptEnvelope('{not json'), { text: '{not json' }, 'malformed JSON falls back unchanged');
  });

  // §26 wrong shape falls back the same way
  await h.test('prompt-envelope §26 wrong-shape JSON falls back to the raw string', () => {
    h.eq(parsePromptEnvelope('{"v":9,"text":"future version"}'), { text: '{"v":9,"text":"future version"}' }, 'an unreadable version falls back');
    h.eq(parsePromptEnvelope('{"v":1}'), { text: '{"v":1}' }, 'missing text falls back');
    h.eq(parsePromptEnvelope('{"v":1,"text":42}'), { text: '{"v":1,"text":42}' }, 'non-string text falls back');
    h.eq(parsePromptEnvelope('42'), { text: '42' }, 'a bare JSON number falls back');
    h.eq(parsePromptEnvelope('[1,2,3]'), { text: '[1,2,3]' }, 'a JSON array falls back');
    h.eq(parsePromptEnvelope('null'), { text: 'null' }, 'JSON null falls back');
  });

  // The envelope a delivery writes: the verbatim prompt, with the run's summary beside it when the
  // server sent one. History reads both back.
  await h.test('prompt-envelope: a delivered prompt round-trips its text and the run summary, and a run with none reads none', () => {
    const summary: RunSummary = { text: 'It saves every brew now.', kind: 'Added', touched: ['History'], marks: [{ cls: 'chg', start: 3, end: 8 }] };
    const withSummary = promptEnvelope('a timer with my pour-over recipe', summary);
    h.eq(parsePromptEnvelope(withSummary), { text: 'a timer with my pour-over recipe' }, 'the verbatim prompt reads back');
    h.eq(storedSummary(withSummary), summary, 'and the summary rides beside it, unmodified');
    const bare = promptEnvelope('a dice roller');
    h.eq(parsePromptEnvelope(bare), { text: 'a dice roller' }, 'a run with no summary still reads its prompt');
    h.ok(storedSummary(bare) === undefined, 'and finds no summary');
    h.ok(storedSummary('{"v":1,"text":"make a tip splitter"}') === undefined, 'nor does a v1 envelope');
    h.ok(storedSummary('Example: track water') === undefined, 'nor a raw legacy string');
  });
}
