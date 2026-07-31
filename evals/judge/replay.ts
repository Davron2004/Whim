/**
 * The replay judge (design D7): replays a recorded `JudgeVerdict` transcript from disk, keyed by
 * case id + the ACTIVE rubric version (`evals/rubric/index.ts`'s `RUBRIC_VERSION`) — a transcript
 * recorded against one rubric version is never silently replayed for another. Fully offline —
 * reads only the local filesystem. Fixtures live under `evals/test/fixtures/judge/`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JudgeVerdict } from '../contract';
import { RUBRIC_VERSION } from '../rubric';
import type { Judge, JudgeInput } from './judge';

/** `<caseId>__<rubricVersion>.json` — the exact filename a transcript for `caseId` at the
 *  CURRENT rubric version must have inside a replay judge's `dir`. */
export function replayFileName(caseId: string, rubricVersion: string): string {
  return `${caseId}__${rubricVersion}.json`;
}

/** `dir` is a directory of `<caseId>__<rubricVersion>.json` files, each the JSON serialization of
 *  a `JudgeVerdict`. `score` throws when no transcript exists for the case at the active
 *  `RUBRIC_VERSION`, or when the file is not valid JSON — a missing/broken transcript is never
 *  silently treated as "no judge configured". */
export function createReplayJudge(dir: string): Judge {
  return {
    async score(input: JudgeInput): Promise<JudgeVerdict> {
      const fileName = replayFileName(input.caseId, RUBRIC_VERSION);
      const filePath = join(dir, fileName);
      if (!existsSync(filePath)) {
        throw new Error(
          `createReplayJudge: no recorded transcript for case "${input.caseId}" at rubric ` +
            `version "${RUBRIC_VERSION}" (expected ${filePath}).`,
        );
      }
      const raw = readFileSync(filePath, 'utf8');
      try {
        return JSON.parse(raw) as JudgeVerdict;
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        throw new Error(`createReplayJudge: ${filePath} is not valid JSON (${detail}).`);
      }
    },
  };
}
