/**
 * The scripted judge (design D7): returns a fixed `JudgeVerdict` per case id. Fully offline — no
 * I/O of any kind. Used by the acceptance suite, and anywhere a hand-authored verdict is useful
 * (including a deliberately malformed one, to exercise `evals/tiers/tier-c.ts`'s validation).
 */
import type { JudgeVerdict } from '../contract';
import type { Judge, JudgeInput } from './judge';

export type ScriptedJudgeMap = Readonly<Record<string, JudgeVerdict>>;

/** `map` keys exactly on `JudgeInput.caseId`. `score` throws when asked for a case id with no
 *  entry in `map` — a scripted judge missing a script for a case is a test-authoring bug, never a
 *  silent skip. */
export function createScriptedJudge(map: ScriptedJudgeMap): Judge {
  return {
    async score(input: JudgeInput): Promise<JudgeVerdict> {
      const verdict = map[input.caseId];
      if (!verdict) {
        throw new Error(`createScriptedJudge: no scripted verdict for case "${input.caseId}".`);
      }
      return verdict;
    },
  };
}
