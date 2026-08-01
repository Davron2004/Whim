/**
 * The `Judge` interface (design D7, `handoff/judge.md`). Three implementations exist —
 * `createScriptedJudge` and `createReplayJudge` (`./scripted.ts`, `./replay.ts`; both fully
 * offline, the only ones the gate ever constructs) plus `createLiveJudge` (`./live.ts`; network,
 * opt-in only). A `Judge` may return a MALFORMED `JudgeVerdict` — validating it is
 * `evals/tiers/tier-c.ts`'s job, never the judge's (design D7).
 */
import type { JudgeVerdict, RunObservation } from '../contract';

/** Everything a judge needs to score one case. */
export interface JudgeInput {
  readonly caseId: string;
  readonly prompt: string;
  readonly expectation?: string;
  readonly candidateSource?: string;
  readonly observation: RunObservation;
}

export interface Judge {
  score(input: JudgeInput): Promise<JudgeVerdict>;
}
