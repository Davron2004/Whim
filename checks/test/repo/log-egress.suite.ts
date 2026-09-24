/**
 * No third path out of the logging seam (developer-observability; spec host-observability "No
 * third path out of the seam"). The dev sink and the diagnostics upload are the only two ways a
 * log record leaves the device, and each is a transport of the seam, so each sees records only
 * after redaction. This scan fails when any other device module both handles log records and
 * makes a network call — the shape a third path would have.
 *
 * Device source is everything under `src/` plus the app entry files, minus test directories,
 * generated output, and `src/runtime/web/` (the sandbox realm's own scripts, which run inside
 * the WebView with no network and no access to the seam).
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, assert } from '../harness';

const ROOT = process.cwd();

/** The two transports allowed to send records, relative to the repo root. */
const LOG_TRANSPORTS: readonly string[] = ['src/host/logging/sink.ts', 'src/host/logging/diagnostics.ts'];

/** A network call a device module can make. */
const NETWORK_CALL = /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bsendBeacon\b|\bEventSource\b/;

/** Handling log records: naming the record or batch types, projecting a record, or reading the
 *  seam's buffer. */
const LOG_RECORDS = /\bDevLog(?:Record|Batch)\b|\bDiagnostic(?:Record|sBatch)\b|\btoDiagnostic\b|\bLogRing\b|\.buffer\b|\.snapshot\s*\(/;

const EXCLUDED_DIRS = ['src/runtime/web', 'src/runtime/generated'];

interface SourceFile {
  /** Repo-relative, `/`-separated. */
  readonly path: string;
  readonly text: string;
}

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** The modules that both handle log records and make a network call, allowed or not. */
function recordSenders(files: readonly SourceFile[]): string[] {
  return files
    .filter(file => {
      const code = withoutComments(file.text);
      return NETWORK_CALL.test(code) && LOG_RECORDS.test(code);
    })
    .map(file => file.path);
}

/** Every device source file, read from disk. */
function deviceSources(): SourceFile[] {
  const files: SourceFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(ROOT, full).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (entry.name !== 'test' && !EXCLUDED_DIRS.includes(rel)) walk(full);
      } else if (/\.[jt]sx?$/.test(entry.name)) {
        files.push({ path: rel, text: fs.readFileSync(full, 'utf8') });
      }
    }
  };
  walk(path.join(ROOT, 'src'));
  for (const entry of ['App.tsx', 'index.js']) {
    files.push({ path: entry, text: fs.readFileSync(path.join(ROOT, entry), 'utf8') });
  }
  return files;
}

export async function run(): Promise<void> {
  await test('log egress: a planted third path is caught, and neither half alone is', () => {
    const planted: SourceFile[] = [
      {
        path: 'src/host/launcher/crash-reporter.ts',
        text: "import { log } from '../logging';\nexport function report(): void {\n  void fetch('https://collector.example/logs', { method: 'POST', body: JSON.stringify(log.buffer.snapshot()) });\n}\n",
      },
      {
        path: 'src/host/launcher/typed-reporter.ts',
        text: "import type { DevLogRecord } from '@whim/contract';\nexport const send = (r: DevLogRecord) => new XMLHttpRequest().send(JSON.stringify(r));\n",
      },
      { path: 'src/host/launcher/client.ts', text: "export const ping = () => fetch('https://server.example/healthz');\n" },
      { path: 'src/host/launcher/overlay.ts', text: "import { log } from '../logging';\nexport const rows = () => log.buffer.snapshot();\n" },
      { path: 'src/host/launcher/prose.ts', text: '// fetch() the log.buffer.snapshot() — a comment, not a call\nexport const x = 1;\n' },
    ];
    assert(
      JSON.stringify(recordSenders(planted)) === JSON.stringify(['src/host/launcher/crash-reporter.ts', 'src/host/launcher/typed-reporter.ts']),
      `only the two planted third paths are record senders, got ${JSON.stringify(recordSenders(planted))}`,
    );
  });

  await test('log egress: only the dev sink and the diagnostics transport send log records over the network', () => {
    const sources = deviceSources();
    for (const transport of LOG_TRANSPORTS) {
      assert(sources.some(file => file.path === transport), `the scan reaches ${transport}`);
    }
    const senders = recordSenders(sources);
    const thirdPaths = senders.filter(file => !LOG_TRANSPORTS.includes(file));
    assert(
      thirdPaths.length === 0,
      `a log record may leave the device only through the dev sink or the diagnostics transport (both seam transports): ${thirdPaths.join(', ')}`,
    );
    assert(
      LOG_TRANSPORTS.every(transport => senders.includes(transport)),
      `the scan still recognizes both transports as record senders (got ${senders.join(', ')}), so its patterns have not gone stale`,
    );
  });
}
