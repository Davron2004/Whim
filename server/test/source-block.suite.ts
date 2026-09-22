/**
 * server/test/source-block.suite.ts — unit tests for `unwrapSourceFence`
 * (../src/generation/source-block.ts). Covers the engineer-turn fence
 * tolerance. Machine-level "no repair spent on a fenced reply" coverage lives in
 * machine.suite.ts's testGenerateReplyFencedIsUnwrappedNoRepair.
 */
import { eq, section } from './harness';
import { unwrapSourceFence } from '../src/generation/source-block';

export function runSourceBlockTests(): void {
  section('source-block.ts — unwrapSourceFence: tolerant of a leading markdown fence');

  eq(
    'unwrapSourceFence: a ```typescript-tagged fence is stripped',
    unwrapSourceFence('```typescript\nexport default {};\n```'),
    'export default {};',
  );

  eq(
    'unwrapSourceFence: a bare ``` fence (no language tag) is stripped',
    unwrapSourceFence('```\nexport default {};\n```'),
    'export default {};',
  );

  eq(
    'unwrapSourceFence: a missing closing fence (truncated reply) is tolerated',
    unwrapSourceFence('```ts\nexport default {};\n// the reply cuts off here'),
    'export default {};\n// the reply cuts off here',
  );

  const withBacktickTemplateLiteral = 'export const label = `total: ${n}`;\nexport default {};';
  eq(
    'unwrapSourceFence: unfenced source containing a template literal stays byte-identical',
    unwrapSourceFence(withBacktickTemplateLiteral),
    withBacktickTemplateLiteral,
  );

  eq(
    'unwrapSourceFence: a short prose preamble before the fence is tolerated',
    unwrapSourceFence('Here is the app:\n```ts\nexport default {};\n```'),
    'export default {};',
  );

  const proseNoFence = 'Here is the app, written as requested with no markdown fence:\nexport default {};';
  eq(
    'unwrapSourceFence: prose with no fence at all is returned unchanged',
    unwrapSourceFence(proseNoFence),
    proseNoFence,
  );
}
