/**
 * The runtime half of `--only` (see only-filter.mjs): `parseOnly` sets `WHIM_ONLY_FILTER=1` in the
 * runner's environment, and each suite's final report asks `onlyRanNothing(ran)`. A filtered run
 * that executed no test at all is a failure whatever the filter decided: the filter works on
 * source text, so a mistake in it would otherwise look like a green run. Kept free of imports so
 * the acceptance suites can bundle it.
 */

export const ONLY_ENV = 'WHIM_ONLY_FILTER';

/** True (after saying why on stderr) when a `--only` run executed 0 tests, so the caller exits non-zero. */
export function onlyRanNothing(ran) {
  if (process.env[ONLY_ENV] !== '1' || ran > 0) return false;
  console.error('--only: the filtered run executed 0 tests. The filter kept something that runs nothing; this is a failure, not a pass.');
  return true;
}
