/**
 * Stored generated apps the synthrun suites run as candidates.
 *
 * Provenance: the 2026-10-09 flowbench run on integration/beta-2 28a9e5cb, production roster,
 * copied unmodified from that run's `sources/<case>.ts`. The files carry JSX under a `.txt` suffix
 * so that tsc, eslint and knip never see them; the suite reads them as text and hands them to the
 * builder, as it does `fixtures/navigation-demo.app.tsx`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

type FlowbenchCase =
  | 'water-counter-p1'
  | 'recipe-box-p1'
  | 'workout-log-p1'
  | 'workout-log-p2'
  | 'packing-checklist-p2'
  | 'flashcards-p1'
  | 'score-keeper-p1';

/** `process.cwd()` (the repo root), as in `acceptance.ts`: `run.mjs` bundles the suite into one module. */
const FLOWBENCH_DIR = path.join(process.cwd(), 'synthrun/test/fixtures/flowbench-2026-10-09');

/** The source text of one stored flowbench app, by case name. */
export function flowbenchApp(name: FlowbenchCase): string {
  return readFileSync(path.join(FLOWBENCH_DIR, `${name}.app.tsx.txt`), 'utf8');
}
