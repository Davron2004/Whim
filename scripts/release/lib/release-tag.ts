/**
 * Tags a successful upload (design D12 "Tags"; specs/store-release-pipeline/spec.md "A
 * successful upload is tagged"). `ensureReleaseTag` talks to git only through an injected
 * `GitRunner` — never shells out itself — so `checks/test/release/release-cli.suite.ts` can
 * exercise it with a fake runner instead of a real `git` process (chains.md's suite-portability
 * rule: a suite never shells to `git tag`/`git rev-parse`). `realGitRunner` below is the one
 * production wiring the CLI command uses; it is never called from a suite.
 */

import { execFileSync } from 'node:child_process';

/** Runs a git subcommand and returns its stdout; throws (with git's own stderr) on a non-zero exit. */
export type GitRunner = (args: string[]) => string;

/** `release/<marketing version>+<build number>` (design D12). */
export function releaseTagName(marketingVersion: string, buildNumber: number): string {
  return `release/${marketingVersion}+${buildNumber}`;
}

/**
 * Creates the annotated tag on HEAD, or reuses it if it already points at HEAD. Throws if the
 * tag exists and points anywhere else.
 */
export function ensureReleaseTag(run: GitRunner, marketingVersion: string, buildNumber: number): string {
  const tag = releaseTagName(marketingVersion, buildNumber);
  const head = run(['rev-parse', 'HEAD']).trim();

  let existingCommit: string | undefined;
  try {
    existingCommit = run(['rev-parse', `${tag}^{commit}`]).trim();
    // eslint-disable-next-line no-restricted-syntax -- intentional: "the tag doesn't exist yet" is a normal, expected outcome of the rev-parse probe below, not a hidden failure
  } catch {
    existingCommit = undefined;
  }

  if (existingCommit === undefined) {
    run(['tag', '-a', tag, '-m', tag, head]);
    return tag;
  }
  if (existingCommit !== head) {
    throw new Error(`release-tag: "${tag}" already points at ${existingCommit}, not HEAD (${head})`);
  }
  return tag;
}

/** The real git runner the CLI command wires in production; a suite never calls this. */
export function realGitRunner(cwd: string): GitRunner {
  return (args: string[]): string =>
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- intentional: the release CLI runs inside the repo's own dev/release toolchain, which always has a trustworthy `git` on PATH (same call shape as native-config.ts's trackedFiles)
    execFileSync('git', args, { cwd, encoding: 'utf8' });
}
