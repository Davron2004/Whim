/**
 * bundle-validity Node suite — the pure predicate the install-time guard runs
 * (`build-lifecycle.ts#deliverResult`, `seed.ts#seedFirstRun`; the stub-bundle incident: a
 * delivered `(()=>{ /* stub bundle *\/ })();` was stored and only failed at mount time).
 */

import { Harness } from './harness';
import { bundleDefinesApp } from '../bundle-validity';

export async function runBundleValidityTests(h: Harness): Promise<void> {
  await h.test('a realistic bundle prefix (esbuild’s actual iife globalName shape) passes', async () => {
    h.ok(
      bundleDefinesApp('var __WHIM_APP_MODULE__ = (() => {\n  "use strict";\n  var x = 1;\n  return {default: x};\n})();'),
      'the shape build/build.mjs actually emits defines the guard is looking for',
    );
  });

  await h.test('the generation server’s stub bundle fails — the exact incident this guard exists for', async () => {
    h.ok(!bundleDefinesApp('(()=>{ /* stub bundle */ })();'), '30 bytes, no assignment, defines no app');
  });

  await h.test('an empty string fails', async () => {
    h.ok(!bundleDefinesApp(''), 'nothing to define an app with');
  });

  await h.test('a whitespace-only bundle fails', async () => {
    h.ok(!bundleDefinesApp('   \n\t  '), 'whitespace is not a bundle');
  });

  await h.test('a bundle mentioning the name only in a comment, with no real assignment, PASSES', async () => {
    // Documented tradeoff: this guard is a text match, not a parser, and distinguishing "the name
    // appears in a comment" from "the name appears in code" needs one. The stub bundle this guard
    // exists to catch mentions the name NOWHERE — in code or in a comment — so a bundle that at
    // least writes the name down, even inside a comment, is already outside the incident's shape.
    h.ok(
      bundleDefinesApp('// __WHIM_APP_MODULE__ = something\nconsole.log("hi");'),
      'a comment-only mention still passes — see the module doc comment for why',
    );
  });

  await h.test('an assignment with unusual but valid whitespace still matches', async () => {
    h.ok(bundleDefinesApp('var __WHIM_APP_MODULE__\n  =\n  (() => ({}))();'), 'whitespace around `=` does not defeat the match');
  });
}
