/**
 * Acceptance for `src/host/platform/{hermes-polyfills,install-entry-polyfills}.ts` and
 * `index.js`'s entry ordering (chain-2, platform-release-readiness). specs/
 * hermes-runtime-prerequisites/spec.md, all three requirements; task 3.4.
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { test, assert } from '../harness';
import { installHermesPolyfills, HermesGlobal } from '../../../src/host/platform/hermes-polyfills';

const REPO_ROOT = process.cwd();
const ENTRY_IMPORT_SPECIFIER = './src/host/platform/install-entry-polyfills';

interface EntryCheckResult {
  ok: boolean;
  reason?: string;
}

/**
 * Parses `fileName`'s `source` (JS, not TS) and checks its very first statement — no
 * statement of any kind before it, comments don't count — is a bare side-effect import
 * of the entry prerequisites installer. Syntactic-only, mirrors `checks/internal/parse.ts`'s
 * single `ts.createSourceFile` idiom (no `ts.createProgram`).
 */
function checkEntryFirstImport(fileName: string, source: string): EntryCheckResult {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const [first] = sourceFile.statements;
  if (first === undefined) {
    return { ok: false, reason: `${fileName}: the file has no statements` };
  }
  if (!ts.isImportDeclaration(first)) {
    return { ok: false, reason: `${fileName}: the first statement is not an import (got ${ts.SyntaxKind[first.kind]})` };
  }
  if (first.importClause !== undefined) {
    return {
      ok: false,
      reason: `${fileName}: the first statement is ${first.getText(sourceFile)} — it must be a bare side-effect import of "${ENTRY_IMPORT_SPECIFIER}"`,
    };
  }
  if (!ts.isStringLiteral(first.moduleSpecifier) || first.moduleSpecifier.text !== ENTRY_IMPORT_SPECIFIER) {
    return {
      ok: false,
      reason: `${fileName}: the first import's specifier is "${first.moduleSpecifier.getText(sourceFile)}", expected "${ENTRY_IMPORT_SPECIFIER}"`,
    };
  }
  return { ok: true };
}

export async function run(): Promise<void> {
  await test('hermes-entry: index.js begins with the bare side-effect import of the entry installer, nothing before it', () => {
    const source = fs.readFileSync(path.join(REPO_ROOT, 'index.js'), 'utf8');
    const result = checkEntryFirstImport('index.js', source);
    assert(result.ok, result.reason ?? 'index.js failed the entry-import check for an unknown reason');
  });

  await test('hermes-entry: a late prerequisites import fails the check, naming index.js and the statement that comes first (spec scenario)', () => {
    const source = [
      "import { AppRegistry } from 'react-native';",
      `import '${ENTRY_IMPORT_SPECIFIER}';`,
      "import App from './App';",
    ].join('\n');
    const result = checkEntryFirstImport('index.js', source);
    assert(result.ok === false, 'an index.js that imports react-native before the installer must fail the check');
    assert(!!result.reason && result.reason.startsWith('index.js:'), `expected the failure to name index.js, got: ${String(result.reason)}`);
    assert(
      !!result.reason && result.reason.includes('react-native'),
      `expected the failure to name the statement that comes first ("react-native"), got: ${String(result.reason)}`,
    );
  });

  await test('hermes-entry: a comment before the bare import is fine (comments are not statements)', () => {
    const source = ['/**', ' * @format', ' */', '', `import '${ENTRY_IMPORT_SPECIFIER}';`, ''].join('\n');
    const result = checkEntryFirstImport('index.js', source);
    assert(result.ok, `a leading comment must not fail the check, got: ${String(result.reason)}`);
  });

  await test('hermes-entry: a bare global gets every polyfill and a working UTF-8 round trip (spec scenario)', () => {
    const target: HermesGlobal = {};
    installHermesPolyfills(target);
    assert(target.Buffer !== undefined, 'Buffer must be installed');
    assert(target.TextEncoder !== undefined, 'TextEncoder must be installed');
    assert(target.TextDecoder !== undefined, 'TextDecoder must be installed');
    assert(target.process?.env !== undefined, 'process.env must be installed');
    const Encoder = target.TextEncoder as new () => { encode(input: string): Uint8Array };
    const Decoder = target.TextDecoder as new () => { decode(input: Uint8Array): string };
    const roundTripped = new Decoder().decode(new Encoder().encode('héllo ✓'));
    assert(roundTripped === 'héllo ✓', `expected the UTF-8 round trip to return the original string, got "${roundTripped}"`);
  });

  await test('hermes-entry: an existing TextDecoder is kept by identity, never replaced (spec scenario)', () => {
    const existing = function ExistingTextDecoder(): void {};
    const target: HermesGlobal = { TextDecoder: existing };
    installHermesPolyfills(target);
    assert(target.TextDecoder === existing, 'an existing TextDecoder must be kept by identity, not replaced');
  });

  await test('hermes-entry: a second call is a no-op for already-installed globals — no module-level "installed" flag', () => {
    const target: HermesGlobal = {};
    installHermesPolyfills(target);
    const bufferRef = target.Buffer;
    const decoderRef = target.TextDecoder;
    installHermesPolyfills(target);
    assert(target.Buffer === bufferRef, 'a second call must not replace an already-installed Buffer');
    assert(target.TextDecoder === decoderRef, 'a second call must not replace an already-installed TextDecoder');
  });

  await test('hermes-entry: iOS reports ios (spec scenario, simulated Platform.OS mapping)', () => {
    const target: HermesGlobal = {};
    installHermesPolyfills(target, 'ios');
    assert(target.process?.platform === 'ios', `expected process.platform "ios", got ${String(target.process?.platform)}`);
  });

  await test('hermes-entry: a call without a platform leaves process.platform missing; a later call with android sets it (spec scenario)', () => {
    const target: HermesGlobal = {};
    installHermesPolyfills(target);
    assert(target.process?.platform === undefined, 'process.platform must stay missing when no platform is passed');
    installHermesPolyfills(target, 'android');
    assert(target.process?.platform === 'android', `expected process.platform "android", got ${String(target.process?.platform)}`);
  });

  await test('hermes-entry: an existing process.platform is never overwritten by a later call (spec scenario)', () => {
    const target: HermesGlobal = { process: { platform: 'ios' } };
    installHermesPolyfills(target, 'android');
    assert(target.process?.platform === 'ios', 'an existing process.platform must never be overwritten');
  });
}
