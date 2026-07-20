#!/usr/bin/env node
// SonarCloud PR issue ingestion (openspec: sonar-issue-ingestion).
//
// Retrieves, for a pull request: every OPEN issue (api/issues/search, resolved=false, paged to
// completion) plus the quality-gate status (api/qualitygates/project_status), authenticating with
// `Authorization: Bearer $SONAR_TOKEN`, and emits the issues in the fix-loop findings-file format
// (rule key, message, file, line, severity per finding) on stdout so the output feeds the existing
// findings.md -> plan.md -> dispositions.md flow and the sonar-ledger transcription unchanged.
// `curl` stays policy-denied; this uses Node's global fetch.
//
// AUTH-VISIBILITY GUARD (mandatory): api/issues/search returns HTTP 200 with total:0 for a project
// the token cannot see, so a revoked/absent token masquerades as a clean gate. api/components/show
// honestly 404s when unauthorized, so it runs FIRST — an empty findings list is trustworthy only
// after that check passes.
//
// The GitHub check-run side is NOT the issue source (it is lossy: new-code-only, annotation caps,
// no rule keys) — it is used elsewhere only as the poll trigger and pass/fail verdict.
//
// This script is NOT part of the protected gate surface: the PR's server-side SonarCloud quality
// gate remains the merge-blocking enforcement, so a tampered result wastes a round, never merges.
//
//   node scripts/sonar-pr-issues.mjs --pr <number> [--project <key>]   > findings.md
//   node scripts/sonar-pr-issues.mjs --verify [--project <key>]        # auth-visibility check only
//
// Exit: 0 visible + gate OK/WARN/NONE (or --verify visible) · 10 visible + gate ERROR (red — run a
//       fix round) · 3 auth-visibility failure (NO stdout — check this before reading findings.md) ·
//       2 usage · 1 other error.
import { pathToFileURL } from 'node:url';

const SONAR_BASE = 'https://sonarcloud.io/api';
const DEFAULT_PROJECT = 'Davron2004_Whim';

export class AuthVisibilityError extends Error {
  constructor(message) { super(message); this.name = 'AuthVisibilityError'; }
}

async function sonarGet(fetchImpl, base, token, apiPath, params) {
  const url = new URL(base + apiPath);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, String(v));
  const res = await fetchImpl(url.toString(), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, ok: res.ok, json };
}

// Verify the token can SEE the project. components/show 404s when unauthorized/invisible — unlike
// issues/search, which lies with 200/total:0 for an invisible project.
export async function assertVisible({ fetchImpl, base, token, project }) {
  const r = await sonarGet(fetchImpl, base, token, '/components/show', { component: project });
  if (!r.ok) {
    throw new AuthVisibilityError(
      `SonarCloud project '${project}' is not visible with the provided token ` +
      `(api/components/show -> HTTP ${r.status}). Set SONAR_TOKEN to a token with access; ` +
      `an empty issue list is NOT trustworthy without this check.`,
    );
  }
}

// Page api/issues/search to exhaustion (resolved=false, scoped to the PR).
export async function fetchOpenIssues({ fetchImpl, base, token, project, pr }) {
  const issues = [];
  const ps = 500;
  for (let p = 1; ; p += 1) {
    const r = await sonarGet(fetchImpl, base, token, '/issues/search', {
      componentKeys: project, pullRequest: pr, resolved: 'false', ps, p,
    });
    if (!r.ok || !r.json) throw new Error(`api/issues/search failed (HTTP ${r.status}) on page ${p}`);
    const batch = r.json.issues || [];
    issues.push(...batch);
    const total = r.json.total ?? (r.json.paging && r.json.paging.total) ?? issues.length;
    if (batch.length === 0 || issues.length >= total) break;
    if (p >= 200) break; // hard stop (~100k issues) — never spin on a malformed total
  }
  return issues;
}

export async function fetchGateStatus({ fetchImpl, base, token, project, pr }) {
  const r = await sonarGet(fetchImpl, base, token, '/qualitygates/project_status', {
    projectKey: project, pullRequest: pr,
  });
  if (!r.ok || !r.json || !r.json.projectStatus) {
    throw new Error(`api/qualitygates/project_status failed (HTTP ${r.status})`);
  }
  return r.json.projectStatus.status || 'NONE'; // OK | WARN | ERROR | NONE
}

// A Sonar issue's `component` is `<projectKey>:<path>`; keep the repo-relative path.
export function normalizeIssue(issue) {
  const comp = issue.component || '';
  const idx = comp.indexOf(':');
  const file = idx >= 0 ? comp.slice(idx + 1) : comp;
  return {
    rule: issue.rule || 'unknown',
    message: (issue.message || '').replace(/\s+/g, ' ').trim(),
    file,
    line: issue.line ?? null,
    severity: issue.severity || 'UNKNOWN',
  };
}

// Emit the fix-loop findings-file format. The header carries a machine-readable `- gate:` /
// `- issues:` line; each finding is one Sonar issue with its rule, location and message.
export function formatFindings({ pr, project, gate, issues }) {
  const norm = issues.map(normalizeIssue);
  const lines = [
    `# Sonar findings — PR #${pr} (${project})`,
    '',
    `- source: SonarCloud Web API (api/issues/search) for pull request #${pr}`,
    `- gate: ${gate}`,
    `- issues: ${norm.length}`,
    '',
    '<!-- Mechanical lane: each finding is one open SonarCloud issue. Red check per finding: the',
    '     PR SonarCloud quality gate; the fix must clear its cited rule at the cited location. -->',
  ];
  norm.forEach((f, i) => {
    lines.push('', `## S${i + 1} — ${f.file}:${f.line ?? '?'} — ${f.rule} (${f.severity})`, f.message || '(no message)');
  });
  lines.push('');
  return lines.join('\n');
}

// Guard -> gate + issues -> findings text. Returns { gate, issues, findings }.
export async function ingest({ fetchImpl = globalThis.fetch, base = SONAR_BASE, token, project = DEFAULT_PROJECT, pr }) {
  await assertVisible({ fetchImpl, base, token, project });
  const [gate, issues] = await Promise.all([
    fetchGateStatus({ fetchImpl, base, token, project, pr }),
    fetchOpenIssues({ fetchImpl, base, token, project, pr }),
  ]);
  return { gate, issues, findings: formatFindings({ pr, project, gate, issues }) };
}

function parseArgs(argv) {
  const out = { pr: null, project: process.env.SONAR_PROJECT || DEFAULT_PROJECT, verify: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--pr') { out.pr = argv[i + 1]; i += 1; }
    else if (argv[i] === '--project') { out.project = argv[i + 1]; i += 1; }
    else if (argv[i] === '--verify') { out.verify = true; }
  }
  return out;
}

// Map a thrown error to an exit code, writing the reason to stderr. Shared by both run paths.
function errorExitCode(e) {
  if (e instanceof AuthVisibilityError) {
    process.stderr.write(`AUTH-VISIBILITY: ${e.message}\n`);
    return 3;
  }
  process.stderr.write(`ERROR: ${e && e.message ? e.message : e}\n`);
  return 1;
}

// --verify: auth-visibility check only (no PR needed) — the standing way to confirm SONAR_TOKEN can
// see the project (openspec task 1.3). Exit: 0 visible, 3 not visible, 1 other error.
async function runVerify({ token, project }) {
  try {
    await assertVisible({ fetchImpl: globalThis.fetch, base: SONAR_BASE, token, project });
    process.stdout.write(`VISIBLE: SONAR_TOKEN can see project ${project} (api/components/show 200).\n`);
    return 0;
  } catch (e) {
    return errorExitCode(e);
  }
}

async function runIngest({ token, project, pr }) {
  try {
    const { gate, findings } = await ingest({ token, project, pr });
    process.stdout.write(findings.endsWith('\n') ? findings : `${findings}\n`);
    process.stderr.write(`GATE: ${gate}\n`);
    return gate === 'ERROR' ? 10 : 0;
  } catch (e) {
    return errorExitCode(e);
  }
}

async function main() {
  const { pr, project, verify } = parseArgs(process.argv.slice(2));
  const token = process.env.SONAR_TOKEN;
  if (verify) { process.exit(await runVerify({ token, project })); }
  if (!pr) {
    process.stderr.write('usage: node scripts/sonar-pr-issues.mjs (--pr <number> [--project <key>] | --verify [--project <key>])\n');
    process.exit(2);
  }
  process.exit(await runIngest({ token, project, pr }));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
