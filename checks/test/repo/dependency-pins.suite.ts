/**
 * The dependency pin register (spec `dependency-currency`): `dependency-pins.json` at the repo root
 * holds one entry per dependency held below its npm `latest`, and this offline check validates it
 * against every workspace `package.json` and the lockfile. The scenarios run against temp repos
 * (manifests, lockfile, register) so each spec failure is driven through the real file reading.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, assert } from '../harness';
import { pinRegisterFindings, readPinRegister, satisfies } from '../../../scripts/lib/dependency-pins.mjs';

const ROOT = process.cwd();

interface TempRepo {
  rootManifest: Record<string, unknown>;
  serverManifest: Record<string, unknown>;
  lockPackages: Record<string, { version?: string; link?: boolean }>;
  register: unknown;
}

/** A two-workspace repo where every pin holds: root pins `typescript` ^6, the server pins its own
 *  nested `esbuild` 0.25.x while the hoisted copy is newer. */
function validRepo(): TempRepo {
  return {
    rootManifest: { name: 'root', workspaces: ['server'], devDependencies: { typescript: '^6.0.3', knip: '^6.47.0' } },
    serverManifest: { name: '@x/server', dependencies: { esbuild: '0.25.12' } },
    lockPackages: {
      '': { version: '0.1.0' },
      'node_modules/typescript': { version: '6.0.3' },
      'node_modules/knip': { version: '6.47.0' },
      'node_modules/esbuild': { version: '0.28.2' },
      'server/node_modules/esbuild': { version: '0.25.12' },
    },
    register: [
      { package: 'typescript', range: '^6.0.3', reason: 'typescript 7 ships no compiler API', lift: 'A 7.x with a compiler API' },
      { package: 'esbuild', range: '~0.25.12', reason: 'server bundles pin 0.25', lift: 'The server build moves to 0.28' },
    ],
  };
}

function findingsFor(repo: TempRepo): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-pins-'));
  try {
    fs.mkdirSync(path.join(dir, 'server'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(repo.rootManifest));
    fs.writeFileSync(path.join(dir, 'server', 'package.json'), JSON.stringify(repo.serverManifest));
    fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: repo.lockPackages }));
    if (repo.register !== undefined) {
      const text = typeof repo.register === 'string' ? repo.register : JSON.stringify(repo.register);
      fs.writeFileSync(path.join(dir, 'dependency-pins.json'), text);
    }
    return pinRegisterFindings(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The repo with the register's entries replaced. */
function withRegister(register: unknown): TempRepo {
  return { ...validRepo(), register };
}

const ENTRY = { package: 'typescript', range: '^6.0.3', reason: 'typescript 7 ships no compiler API', lift: 'A 7.x with a compiler API' };

function assertOneFindingNaming(findings: string[], parts: string[], what: string): void {
  const hits = findings.filter((f) => parts.every((p) => f.includes(p)));
  assert(hits.length === 1, `${what}: expected one finding naming ${parts.join(' + ')}, got ${JSON.stringify(findings)}`);
}

export async function run(): Promise<void> {
  await test('dependency pins: the committed register holds against every workspace package.json and the lockfile', () => {
    assert(readPinRegister(ROOT).length > 0, 'dependency-pins.json has no entries: the check validated nothing');
    const findings = pinRegisterFindings(ROOT);
    assert(findings.length === 0, findings.join('; '));
  });

  await test('dependency pins: a register whose every entry holds draws no finding (the scenarios below change one thing each)', () => {
    const findings = findingsFor(validRepo());
    assert(findings.length === 0, `expected no finding, got ${JSON.stringify(findings)}`);
  });

  await test('dependency pins: an entry for a package no workspace declares is stale, naming the entry', () => {
    const stale = { package: 'left-pad', range: '^1.3.0', reason: 'held for a removed tool', lift: 'never' };
    assertOneFindingNaming(findingsFor(withRegister([ENTRY, stale])), ['left-pad', 'stale'], 'stale entry');
  });

  await test('dependency pins: a missing or empty reason, lift or range fails, naming the package and the field', () => {
    for (const field of ['reason', 'lift', 'range'] as const) {
      const missing: Record<string, string> = { ...ENTRY };
      delete missing[field];
      assertOneFindingNaming(findingsFor(withRegister([missing])), ['typescript', `"${field}"`], `missing ${field}`);
      assertOneFindingNaming(findingsFor(withRegister([{ ...ENTRY, [field]: '  ' }])), ['typescript', `"${field}"`], `blank ${field}`);
    }
  });

  await test('dependency pins: two entries naming one package fail, naming the package', () => {
    assertOneFindingNaming(findingsFor(withRegister([ENTRY, { ...ENTRY, reason: 'a second reason' }])), ['typescript', 'duplicate'], 'duplicate entry');
  });

  await test('dependency pins: a lockfile version outside the pinned range fails, naming the package and both versions', () => {
    const repo = validRepo();
    repo.register = [{ ...ENTRY, range: '^6.0.0' }];
    repo.lockPackages['node_modules/typescript'] = { version: '7.0.2' };
    assertOneFindingNaming(findingsFor(repo), ['typescript', '7.0.2', '^6.0.0'], 'lockfile drift');
  });

  await test('dependency pins: a workspace is checked against its own nested copy, falling back to the hoisted one', () => {
    const hoistedOnly = validRepo();
    delete hoistedOnly.lockPackages['server/node_modules/esbuild'];
    assertOneFindingNaming(findingsFor(hoistedOnly), ['esbuild', '0.28.2', '~0.25.12', 'server'], 'server without its nested esbuild');
  });

  await test('dependency pins: an unknown field, an unreadable range or a non-array register fails', () => {
    assertOneFindingNaming(findingsFor(withRegister([{ ...ENTRY, until: '2027' }])), ['typescript', '"until"'], 'unknown field');
    assertOneFindingNaming(findingsFor(withRegister([{ ...ENTRY, range: 'latest-ish' }])), ['typescript', 'latest-ish'], 'unreadable range');
    assertOneFindingNaming(findingsFor(withRegister({ typescript: ENTRY })), ['must be a JSON array'], 'object register');
    assertOneFindingNaming(findingsFor(withRegister('[{"package": ')), ['dependency-pins.json'], 'malformed JSON');
    assertOneFindingNaming(findingsFor(withRegister(undefined)), ['dependency-pins.json'], 'missing register');
  });

  await test('dependency pins: a range with no upper bound fails, naming the package', () => {
    for (const range of ['*', 'x', '>=0', '>=6', '^6 || >=8', '>=6 || ^5']) {
      assertOneFindingNaming(findingsFor(withRegister([{ ...ENTRY, range }])), ['typescript', `"${range}"`, 'upper bound'], `unbounded ${range}`);
    }
    for (const range of ['^6', '>=6 <7', '6.0.3', '<=6.9.0', '^5 || ^6']) {
      const findings = findingsFor(withRegister([{ ...ENTRY, range }]));
      assert(findings.every((f) => !f.includes('upper bound')), `${range} is bounded but drew ${JSON.stringify(findings)}`);
    }
  });

  await test('dependency pins: the range matcher reads the forms a register uses', () => {
    const cases: [string, string, boolean][] = [
      ['6.4.1', '^6.0.0', true],
      ['7.0.2', '^6.0.0', false],
      ['5.9.3', '^6.0.0', false],
      ['0.87.3', '^0.87.1', true],
      ['0.88.0', '^0.87.1', false],
      ['0.0.4', '^0.0.3', false],
      ['7.29.7', '^7', true],
      ['8.1.3', '^7', false],
      ['1.4.9', '~1.4.1', true],
      ['1.5.0', '~1.4.1', false],
      ['20.2.3', '20.2.x', true],
      ['20.3.0', '20.2.x', false],
      ['9.39.5', '>=9.39 <10', true],
      ['10.0.0', '>=9.39 <10', false],
      ['9.38.0', '>=9.39 <10', false],
      ['2.1.1', '^1 || ^2', true],
      ['3.0.0', '^1 || ^2', false],
      ['0.25.12', '0.25.12', true],
      ['0.25.13', '0.25.12', false],
      ['7.0.0-rc.1', '^6.0.0', false],
      ['7.0.0-rc.1', '^7.0.0', false],
      ['7.0.0-rc.2', '^7.0.0-rc.1', true],
      ['0.9.9', '^0', true],
      ['1.0.0', '^0', false],
      ['0.0.9', '^0.0', true],
      ['0.1.0', '^0.0', false],
      ['1.2.1', '>1.2', false],
      ['1.3.0', '>1.2', true],
      ['1.2.9', '<=1.2', true],
      ['1.3.0', '<=1.2', false],
    ];
    const misread = cases
      .filter(([version, range, expected]) => satisfies(version, range) !== expected)
      .map(([version, range, expected]) => (expected ? `${version} should satisfy ${range}` : `${version} should not satisfy ${range}`));
    assert(misread.length === 0, `misread: ${misread.join('; ')}`);
  });
}
