/**
 * Parses and scans `release/whim-release.xcconfig`, the one file both native projects and the
 * release CLI read for identity, version and domain (design D1;
 * specs/native-release-config/spec.md "One native release file declares identity, version and
 * domain"). Shells out only to `git ls-files` (chains.md's suite-portability rule) — everything
 * else is pure text handling, safe to run in the Linux devcontainer gate.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Buffer as NodeBuffer } from 'buffer';

export const NATIVE_RELEASE_CONFIG_PATH = 'release/whim-release.xcconfig';

/** The five keys the file must hold, in the order design D1 lists them. */
export const NATIVE_RELEASE_CONFIG_KEYS = [
  'WHIM_APP_ID',
  'WHIM_APPLE_TEAM_ID',
  'WHIM_MARKETING_VERSION',
  'WHIM_BUILD_NUMBER',
  'WHIM_DOMAIN',
] as const;

export type NativeReleaseConfigKey = (typeof NATIVE_RELEASE_CONFIG_KEYS)[number];

/** Every value is the literal text from the file — callers that need a number parse it themselves. */
export interface NativeReleaseConfig {
  readonly WHIM_APP_ID: string;
  readonly WHIM_APPLE_TEAM_ID: string;
  readonly WHIM_MARKETING_VERSION: string;
  readonly WHIM_BUILD_NUMBER: string;
  readonly WHIM_DOMAIN: string;
}

/** A grammar or shape violation, carrying the 1-based line number the release checks name. */
export class NativeConfigError extends Error {
  readonly line: number;

  constructor(line: number, message: string) {
    super(`line ${line}: ${message}`);
    this.name = 'NativeConfigError';
    this.line = line;
  }
}

const KEY_PATTERN = /^[A-Za-z_]\w*$/;

/** Splits "KEY = VALUE" on the first "=" and trims both sides; `undefined` if there is no "=" or the key shape is wrong. */
function splitKeyValue(trimmedLine: string): { key: string; value: string } | undefined {
  const eq = trimmedLine.indexOf('=');
  if (eq === -1) return undefined;
  const key = trimmedLine.slice(0, eq).trim();
  if (!KEY_PATTERN.test(key)) return undefined;
  return { key, value: trimmedLine.slice(eq + 1).trim() };
}

interface ValueRule {
  readonly pattern: RegExp;
  readonly describe: string;
}

const VALUE_RULES: Record<NativeReleaseConfigKey, ValueRule> = {
  WHIM_APP_ID: {
    pattern: /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/,
    describe: 'a reverse-DNS app id (e.g. com.anycognition.whim)',
  },
  WHIM_APPLE_TEAM_ID: {
    pattern: /^[A-Z0-9]{10}$/,
    describe: 'a 10-character uppercase alphanumeric Apple team id',
  },
  WHIM_MARKETING_VERSION: {
    pattern: /^\d+\.\d+\.\d+$/,
    describe: 'a MAJOR.MINOR.PATCH version',
  },
  WHIM_BUILD_NUMBER: {
    pattern: /^[1-9]\d*$/,
    describe: 'a positive integer',
  },
  WHIM_DOMAIN: {
    pattern: /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/,
    describe: 'a lowercase hostname with no scheme or path',
  },
};

function isKnownKey(key: string): key is NativeReleaseConfigKey {
  return (NATIVE_RELEASE_CONFIG_KEYS as readonly string[]).includes(key);
}

/**
 * Parses `text` against design D1's strict grammar: "KEY = VALUE" lines, "//" comment lines,
 * and blank lines only, no `#include`, no `$(...)` references, all five keys present exactly
 * once, each value shaped per `VALUE_RULES`. Throws `NativeConfigError` naming the offending
 * line; a missing-key error is attributed to the line past the end of the file, since the
 * omission has no single offending line of its own.
 */
export function parseNativeReleaseConfig(text: string): NativeReleaseConfig {
  const values: Partial<Record<NativeReleaseConfigKey, string>> = {};
  const setAtLine: Partial<Record<NativeReleaseConfigKey, number>> = {};
  const lines = text.split('\n');

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const trimmed = rawLine.trim();
    if (trimmed === '' || trimmed.startsWith('//')) return;

    const split = splitKeyValue(trimmed);
    if (!split) {
      throw new NativeConfigError(lineNumber, `not a "KEY = VALUE" line, "//" comment, or blank line: ${JSON.stringify(trimmed)}`);
    }
    const { key, value } = split;

    if (value.includes('$(')) {
      throw new NativeConfigError(lineNumber, `"${key}" may not reference "$(...)" — every value in this file is a literal`);
    }
    if (!isKnownKey(key)) {
      throw new NativeConfigError(lineNumber, `unknown key "${key}" — expected one of ${NATIVE_RELEASE_CONFIG_KEYS.join(', ')}`);
    }
    const priorLine = setAtLine[key];
    if (priorLine !== undefined) {
      throw new NativeConfigError(lineNumber, `duplicate key "${key}" (already set at line ${priorLine})`);
    }
    const rule = VALUE_RULES[key];
    if (!rule.pattern.test(value)) {
      throw new NativeConfigError(lineNumber, `"${key}" must be ${rule.describe}, got ${JSON.stringify(value)}`);
    }
    values[key] = value;
    setAtLine[key] = lineNumber;
  });

  const missing = NATIVE_RELEASE_CONFIG_KEYS.filter((key) => values[key] === undefined);
  if (missing.length > 0) {
    throw new NativeConfigError(lines.length, `missing required key(s): ${missing.join(', ')}`);
  }

  return values as NativeReleaseConfig;
}

/** Reads and parses `release/whim-release.xcconfig` under `repoRoot`. */
export function loadNativeReleaseConfig(repoRoot: string): NativeReleaseConfig {
  const text = fs.readFileSync(path.join(repoRoot, NATIVE_RELEASE_CONFIG_PATH), 'utf8');
  return parseNativeReleaseConfig(text);
}

export interface NativeLiteralFinding {
  /** Repo-relative path, as `git ls-files` reports it. */
  readonly file: string;
  readonly line: number;
  readonly key: 'WHIM_APP_ID' | 'WHIM_APPLE_TEAM_ID' | 'WHIM_DOMAIN' | 'WHIM_MARKETING_VERSION';
  readonly literal: string;
}

/** The only files a marketing-version literal is checked in, beyond the identity keys' full ios/+android sweep. */
const MARKETING_VERSION_BASENAMES = new Set(['project.pbxproj', 'Info.plist']);
const MARKETING_VERSION_GRADLE_PATH = 'android/app/build.gradle';

function trackedFiles(repoRoot: string, subdir: string): string[] {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- intentional: the release checks run inside the repo's own dev/CI toolchain, which always has a trustworthy `git` on PATH (same call shape as evals/cli.mjs's isGitTracked)
  const out = execFileSync('git', ['ls-files', '--', subdir], { cwd: repoRoot, encoding: 'utf8' });
  return out.split('\n').filter((line) => line.length > 0);
}

/** Git's own binary heuristic: a NUL byte in the first 8000 bytes means "don't scan this as text". */
function looksBinary(buf: NodeBuffer): boolean {
  return buf.subarray(0, 8000).includes(0);
}

/**
 * Reports every literal of `config.WHIM_APP_ID`, `WHIM_APPLE_TEAM_ID` or `WHIM_DOMAIN` in any
 * tracked text file under `ios/` or `android/`, plus every literal of
 * `config.WHIM_MARKETING_VERSION` in `project.pbxproj`, `Info.plist` or
 * `android/app/build.gradle` (specs/native-release-config/spec.md req 1).
 */
export function scanNativeLiterals(repoRoot: string, config: NativeReleaseConfig): NativeLiteralFinding[] {
  const findings: NativeLiteralFinding[] = [];
  const files = [...trackedFiles(repoRoot, 'ios'), ...trackedFiles(repoRoot, 'android')];
  const identityChecks: [NativeLiteralFinding['key'], string][] = [
    ['WHIM_APP_ID', config.WHIM_APP_ID],
    ['WHIM_APPLE_TEAM_ID', config.WHIM_APPLE_TEAM_ID],
    ['WHIM_DOMAIN', config.WHIM_DOMAIN],
  ];

  for (const file of files) {
    let buf: NodeBuffer;
    try {
      buf = fs.readFileSync(path.join(repoRoot, file));
      // eslint-disable-next-line no-restricted-syntax -- intentional: a file git tracked but the working tree no longer has (rare, e.g. mid-rebase) has nothing to scan; skipping it is the correct behavior, not a hidden failure
    } catch {
      continue;
    }
    if (looksBinary(buf)) continue;

    const checks = [...identityChecks];
    const base = path.basename(file);
    if (MARKETING_VERSION_BASENAMES.has(base) || file === MARKETING_VERSION_GRADLE_PATH) {
      checks.push(['WHIM_MARKETING_VERSION', config.WHIM_MARKETING_VERSION]);
    }

    const lines = buf.toString('utf8').split('\n');
    lines.forEach((line, index) => {
      for (const [key, literal] of checks) {
        if (literal.length > 0 && line.includes(literal)) {
          findings.push({ file, line: index + 1, key, literal });
        }
      }
    });
  }

  return findings;
}
