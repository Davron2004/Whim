#!/usr/bin/env node
// Mocked-HTTP suite for the SonarCloud PR ingestion script (openspec: sonar-issue-ingestion, 4.3).
// Framework-free, house idiom: assert + a pass counter, exit non-zero on the first failure.
import assert from 'node:assert/strict';
import {
  ingest, assertVisible, fetchOpenIssues, formatFindings, normalizeIssue, AuthVisibilityError,
} from '../sonar-pr-issues.mjs';

let pass = 0;
async function test(name, fn) {
  try { await fn(); pass += 1; console.log('PASS:', name); }
  catch (e) { console.error('FAIL:', name, '\n', (e && e.stack) || e); process.exit(1); }
}

// A fetch mock: routes match by a substring of the URL; each yields {status, ok, data}. A route's
// data may be a function of the parsed URL (for pagination). Unmatched URLs throw (spec-by-example).
function mockFetch(routes) {
  return async (urlStr) => {
    const url = new URL(urlStr);
    for (const r of routes) {
      if (url.pathname.endsWith(r.path)) {
        const data = typeof r.data === 'function' ? r.data(url) : r.data;
        return { status: r.status ?? 200, ok: r.ok ?? (r.status ?? 200) < 400, json: async () => data };
      }
    }
    throw new Error(`unexpected fetch: ${urlStr}`);
  };
}

const base = 'https://sonarcloud.io/api';
const project = 'Davron2004_Whim';
const token = 't';

// --- auth-visibility guard ---------------------------------------------------------------------
await test('guard: components/show 404 throws AuthVisibilityError', async () => {
  const fetchImpl = mockFetch([{ path: '/components/show', status: 404, ok: false, data: { errors: [{ msg: 'not found' }] } }]);
  await assert.rejects(() => assertVisible({ fetchImpl, base, token, project }), AuthVisibilityError);
});

await test('guard: components/show 200 passes', async () => {
  const fetchImpl = mockFetch([{ path: '/components/show', status: 200, data: { component: { key: project } } }]);
  await assert.doesNotReject(() => assertVisible({ fetchImpl, base, token, project }));
});

await test('guard: invisible project (issues 200/total:0) does NOT report clean — it throws', async () => {
  // The masquerade: issues/search would 200 with total:0, but components/show 404s. ingest must
  // throw on the guard, never emit an empty-but-clean result.
  const fetchImpl = mockFetch([
    { path: '/components/show', status: 404, ok: false, data: {} },
    { path: '/issues/search', status: 200, data: { total: 0, issues: [] } },
    { path: '/qualitygates/project_status', status: 200, data: { projectStatus: { status: 'OK' } } },
  ]);
  await assert.rejects(() => ingest({ fetchImpl, base, token, project, pr: '7' }), AuthVisibilityError);
});

// --- pagination --------------------------------------------------------------------------------
await test('pagination: pages to exhaustion (600 issues over 2 pages of 500)', async () => {
  const mk = (n, start) => Array.from({ length: n }, (_, k) => ({
    rule: 'sonarjs:x', message: `m${start + k}`, component: `${project}:src/f${start + k}.ts`, line: start + k, severity: 'MAJOR',
  }));
  const fetchImpl = mockFetch([{
    path: '/issues/search',
    data: (url) => {
      const p = Number(url.searchParams.get('p'));
      if (p === 1) return { total: 600, p, ps: 500, issues: mk(500, 0) };
      if (p === 2) return { total: 600, p, ps: 500, issues: mk(100, 500) };
      return { total: 600, p, ps: 500, issues: [] };
    },
  }]);
  const issues = await fetchOpenIssues({ fetchImpl, base, token, project, pr: '7' });
  assert.equal(issues.length, 600);
  assert.equal(issues[599].message, 'm599');
});

await test('pagination: single short page stops immediately', async () => {
  const fetchImpl = mockFetch([{ path: '/issues/search', data: { total: 2, p: 1, ps: 500, issues: [
    { rule: 'r', message: 'a', component: `${project}:src/a.ts`, line: 1, severity: 'MINOR' },
    { rule: 'r', message: 'b', component: `${project}:src/b.ts`, line: 2, severity: 'MINOR' },
  ] } }]);
  const issues = await fetchOpenIssues({ fetchImpl, base, token, project, pr: '7' });
  assert.equal(issues.length, 2);
});

// --- normalization + findings-file shape -------------------------------------------------------
await test('normalizeIssue strips the projectKey: prefix from component', () => {
  const n = normalizeIssue({ rule: 'sonarjs:no-x', message: '  a   b ', component: `${project}:server/src/p.ts`, line: 53, severity: 'CRITICAL' });
  assert.equal(n.file, 'server/src/p.ts');
  assert.equal(n.message, 'a b');
  assert.equal(n.rule, 'sonarjs:no-x');
  assert.equal(n.line, 53);
  assert.equal(n.severity, 'CRITICAL');
});

await test('formatFindings shape: header verdict line + one section per issue', () => {
  const findings = formatFindings({ pr: '7', project, gate: 'ERROR', issues: [
    { rule: 'sonarjs:cognitive-complexity', message: 'too complex', component: `${project}:src/x.ts`, line: 12, severity: 'MAJOR' },
  ] });
  assert.match(findings, /^# Sonar findings — PR #7/m);
  assert.match(findings, /- gate: ERROR/);
  assert.match(findings, /- issues: 1/);
  assert.match(findings, /## S1 — src\/x\.ts:12 — sonarjs:cognitive-complexity \(MAJOR\)/);
  assert.match(findings, /too complex/);
});

await test('formatFindings: missing line renders as ?', () => {
  const findings = formatFindings({ pr: '7', project, gate: 'OK', issues: [
    { rule: 'r', message: 'file-level', component: `${project}:src/x.ts`, severity: 'INFO' },
  ] });
  assert.match(findings, /## S1 — src\/x\.ts:\? — r \(INFO\)/);
});

// --- clean gate + red gate end-to-end ----------------------------------------------------------
await test('clean gate: visible, gate OK, zero issues -> empty findings list, gate OK', async () => {
  const fetchImpl = mockFetch([
    { path: '/components/show', data: { component: { key: project } } },
    { path: '/issues/search', data: { total: 0, p: 1, ps: 500, issues: [] } },
    { path: '/qualitygates/project_status', data: { projectStatus: { status: 'OK' } } },
  ]);
  const { gate, issues, findings } = await ingest({ fetchImpl, base, token, project, pr: '7' });
  assert.equal(gate, 'OK');
  assert.equal(issues.length, 0);
  assert.match(findings, /- issues: 0/);
  assert.doesNotMatch(findings, /## S1/);
});

await test('red gate: visible, gate ERROR, issues present -> findings carry them, gate ERROR', async () => {
  const fetchImpl = mockFetch([
    { path: '/components/show', data: { component: { key: project } } },
    { path: '/issues/search', data: { total: 1, p: 1, ps: 500, issues: [
      { rule: 'sonarjs:no-nested', message: 'nested ternary', component: `${project}:src/y.ts`, line: 9, severity: 'MAJOR' },
    ] } },
    { path: '/qualitygates/project_status', data: { projectStatus: { status: 'ERROR' } } },
  ]);
  const { gate, findings } = await ingest({ fetchImpl, base, token, project, pr: '7' });
  assert.equal(gate, 'ERROR');
  assert.match(findings, /## S1 — src\/y\.ts:9 — sonarjs:no-nested \(MAJOR\)/);
});

console.log(`\nsonar-pr-issues tests: ${pass} passed`);
