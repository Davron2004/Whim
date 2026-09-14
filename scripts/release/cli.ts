/**
 * The release CLI's command table (design D12 "scripts/release" paragraph). `run.mjs` bundles
 * this file and calls `runCli(process.argv.slice(2))`, propagating the returned exit code.
 * Each entry name → `{ summary, run(args) }` is chain-1's contract for every later chain that
 * adds a command (native-config --json, preflight, verify-aab, privacy-audit,
 * association-files, generate-assets, tag): add one `COMMANDS` entry, never a second table or
 * a second `runCli`.
 */

import { buildNumberAt } from './lib/build-number';

export interface CliCommand {
  readonly summary: string;
  run(args: string[]): number | Promise<number>;
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function runBuildNumber(args: string[]): number {
  const at = readFlag(args, '--at');
  const date = at !== undefined ? new Date(at) : new Date();
  if (Number.isNaN(date.getTime())) {
    process.stderr.write(`build-number: "${String(at)}" is not a valid ISO date\n`);
    return 1;
  }
  try {
    process.stdout.write(`${buildNumberAt(date)}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`build-number: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

export const COMMANDS: Record<string, CliCommand> = {
  'build-number': {
    summary: 'build-number [--at <iso>] — prints the release build number for an instant (default: now).',
    run: runBuildNumber,
  },
};

function printCommandTable(): void {
  process.stdout.write('Usage: node scripts/release/run.mjs <command> [args]\n\nCommands:\n');
  for (const { summary } of Object.values(COMMANDS)) {
    process.stdout.write(`  ${summary}\n`);
  }
}

/** Runs the named command, or prints the table and returns 2 for an unknown or missing one. */
export async function runCli(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;
  const command = name !== undefined ? COMMANDS[name] : undefined;
  if (!command) {
    printCommandTable();
    return 2;
  }
  return command.run(rest);
}
