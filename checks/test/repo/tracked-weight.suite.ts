/**
 * Keeps run evidence and heavy files out of git. On 2026-10-09 about 120 MB of committed
 * acceptance screenshots, UI dumps, recordings and raw benchmark output were moved to the evidence
 * bucket (`docs/EVIDENCE.md`); nothing had stopped them going in. Two rules, over every file
 * `git ls-files` reports (so a staged file counts before it is committed):
 *
 * 1. Under `openspec/changes/`, no media, binary, XML, plain-text, log or stream-dump file, and no
 *    JSON over 100 KB. A change folder holds prose and specs; evidence goes to the bucket.
 * 2. Anywhere, no file over 1 MB unless it is on `LARGE_FILE_ALLOWLIST`.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test, assert } from '../harness';

const ROOT = process.cwd();

const KB = 1024;
const MB = 1024 * KB;
export const CHANGE_JSON_MAX_BYTES = 100 * KB;
export const LARGE_FILE_MAX_BYTES = MB;

/** Extensions that are evidence, never change-folder prose: media, archives, dumps, logs, streams. */
export const CHANGE_FOLDER_FORBIDDEN_EXTENSIONS: readonly string[] = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'svg', 'mp4', 'mov', 'webm', 'pdf',
  'zip', 'gz', 'tgz', 'zst', 'tar', 'xml', 'txt', 'log', 'sse', 'ndjson', 'jsonl', 'har', 'pcap',
];

/**
 * Tracked files allowed over 1 MB. On 2026-10-09 no tracked file exceeded 1 MB; the lockfile was the
 * largest at 0.78 MB and grows with the dependency tree. Add an entry only for a file the build or a
 * suite reads, never for evidence.
 */
export const LARGE_FILE_ALLOWLIST: readonly string[] = ['package-lock.json'];

export interface TrackedFile {
  /** Repo-relative path, as `git ls-files` reports it. */
  readonly path: string;
  readonly size: number;
  /** The file's first bytes (up to 8000), for Git's own binary heuristic. */
  readonly head: Uint8Array;
}

/** Git's binary heuristic: a NUL byte in the first 8000 bytes. */
function looksBinary(head: Uint8Array): boolean {
  return head.subarray(0, 8000).includes(0);
}

function extensionOf(file: string): string {
  const base = path.posix.basename(file);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

/** One finding per tracked file that breaks either rule. */
export function trackedWeightFindings(files: readonly TrackedFile[], allowlist: readonly string[] = LARGE_FILE_ALLOWLIST): string[] {
  const findings: string[] = [];
  for (const file of files) {
    if (file.path.startsWith('openspec/changes/')) {
      const ext = extensionOf(file.path);
      if (CHANGE_FOLDER_FORBIDDEN_EXTENSIONS.includes(ext) || file.path.endsWith('-hierarchy.json')) {
        findings.push(`${file.path}: .${ext} evidence under openspec/changes/ (upload it per docs/EVIDENCE.md)`);
      } else if (looksBinary(file.head)) {
        findings.push(`${file.path}: binary file under openspec/changes/ (upload it per docs/EVIDENCE.md)`);
      } else if (ext === 'json' && file.size > CHANGE_JSON_MAX_BYTES) {
        findings.push(`${file.path}: ${file.size} bytes of JSON under openspec/changes/ (over ${CHANGE_JSON_MAX_BYTES})`);
      }
    }
    if (file.size > LARGE_FILE_MAX_BYTES && !allowlist.includes(file.path)) {
      findings.push(`${file.path}: ${file.size} bytes, over ${LARGE_FILE_MAX_BYTES} and not on LARGE_FILE_ALLOWLIST`);
    }
  }
  return findings;
}

/** Every path in the index, with its size and first bytes. A path deleted from the working tree
 *  but still in the index is skipped: it has no bytes to weigh. */
function trackedFiles(): TrackedFile[] {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- intentional: the checks run inside the repo's own dev/CI toolchain, which always has a trustworthy `git` on PATH (same call shape as scripts/release/lib/native-config.ts)
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * MB });
  const files: TrackedFile[] = [];
  for (const rel of out.split('\0')) {
    if (rel.length === 0) continue;
    const full = path.join(ROOT, rel);
    const stat = fs.lstatSync(full, { throwIfNoEntry: false });
    if (stat === undefined || !stat.isFile()) continue;
    const head = new Uint8Array(Math.min(stat.size, 8000));
    const fd = fs.openSync(full, 'r');
    try {
      fs.readSync(fd, head, 0, head.length, 0);
    } finally {
      fs.closeSync(fd);
    }
    files.push({ path: rel, size: stat.size, head });
  }
  return files;
}

function textFile(file: string, size: number): TrackedFile {
  return { path: file, size, head: new TextEncoder().encode('# prose\n') };
}

export async function run(): Promise<void> {
  await test('tracked weight: no evidence under openspec/changes/ and no unlisted file over 1 MB', () => {
    const files = trackedFiles();
    assert(files.some((f) => f.path === 'package.json'), `git ls-files returned no package.json (${files.length} files): the scan saw nothing`);
    const findings = trackedWeightFindings(files);
    assert(findings.length === 0, findings.join('; '));
  });

  await test('tracked weight: every allowlisted large file is still tracked', () => {
    const tracked = new Set(trackedFiles().map((f) => f.path));
    const stale = LARGE_FILE_ALLOWLIST.filter((p) => !tracked.has(p));
    assert(stale.length === 0, `LARGE_FILE_ALLOWLIST names untracked paths: ${stale.join(', ')}`);
  });

  await test('trackedWeightFindings: evidence, binaries, heavy JSON and unlisted large files fail; prose and small JSON pass', () => {
    const binary: TrackedFile = { path: 'openspec/changes/x/notes.md', size: 10, head: Uint8Array.of(35, 0, 35) };
    const cases: { file: TrackedFile; fails: boolean }[] = [
      { file: textFile('openspec/changes/beta-1/acceptance/android/01-home.png', 2 * KB), fails: true },
      { file: textFile('openspec/changes/archive/2026-01-01-x/evidence/run.txt', 200), fails: true },
      { file: textFile('openspec/changes/beta-1/acceptance/ios/home-hierarchy.json', 2 * KB), fails: true },
      { file: textFile('openspec/changes/beta-1/flowbench/after.json', CHANGE_JSON_MAX_BYTES + 1), fails: true },
      { file: binary, fails: true },
      { file: textFile('docs/mascot/sheet.png', LARGE_FILE_MAX_BYTES + 1), fails: true },
      { file: textFile('openspec/changes/beta-1/progress.md', 106 * KB), fails: false },
      { file: textFile('openspec/changes/beta-1/limits.json', CHANGE_JSON_MAX_BYTES), fails: false },
      { file: textFile('openspec/changes/beta-1/.openspec.yaml', 200), fails: false },
      { file: textFile('docs/readme/home.png', 300 * KB), fails: false },
      { file: textFile('package-lock.json', LARGE_FILE_MAX_BYTES + 1), fails: false },
    ];
    for (const { file, fails } of cases) {
      const found = trackedWeightFindings([file]).length > 0;
      assert(found === fails, `${file.path} (${file.size} bytes) ${fails ? 'should fail but passed' : 'should pass but failed'}`);
    }
    assert(trackedWeightFindings([textFile('package-lock.json', LARGE_FILE_MAX_BYTES + 1)], []).length === 1, 'the allowlist is what lets the lockfile through');
  });
}
