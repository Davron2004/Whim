/**
 * Barrel for the `Judge` interface and its three implementations (design D7,
 * `handoff/judge.md`). No native/binary dependency sits behind any of these (unlike the
 * storage-engine's op-sqlite barrel gotcha) — importing from here is always safe.
 */
export type { Judge, JudgeInput } from './judge';
export { createScriptedJudge } from './scripted';
export type { ScriptedJudgeMap } from './scripted';
export { createReplayJudge, replayFileName } from './replay';
export { createLiveJudge, LIVE_JUDGE_CREDENTIAL_ENV_VAR } from './live';
export type { LiveJudgeOptions } from './live';
