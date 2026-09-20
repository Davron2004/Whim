/**
 * resolve-options Node suite (review fix N3) — the pure fallback `LauncherRoot.tsx`'s
 * `resolveClientOptions` composes: the gated memo when it is already non-null, otherwise the live
 * read (`consent-options.ts`). This is the regression `prompt-flow-wiring.suite.ts`'s static pin
 * on the `LauncherRoot.tsx` call site can't reach: reverting the call site to `() => clientOptions`
 * (dropping the live fallback entirely) leaves `resolveOptions` itself untested but still green.
 */
import { Harness } from './harness';
import { resolveOptions } from '../resolve-options';

export async function runResolveOptionsTests(h: Harness): Promise<void> {
  await h.test('resolveOptions: a non-null memo wins over the live value', () => {
    h.eq(resolveOptions('memo', 'live'), 'memo', 'the memo is preferred when it already reflects the current grant');
  });

  await h.test('resolveOptions: a null memo falls back to the live value', () => {
    h.eq(resolveOptions(null, 'live'), 'live', 'a null memo falls back to the fresh live read');
  });

  await h.test('resolveOptions: both null resolves to null', () => {
    h.eq(resolveOptions(null, null), null, 'no consent grant on either side means no options at all');
  });
}
