/**
 * Type-checks the Node acceptance suites (`tsconfig.tests.json`): the launcher, version-store,
 * storage-engine and bridge suites, `checks/test` and `evals/test`. The root `tsconfig.json`
 * excludes them because they run under Node, not React Native, so without this a stale fixture
 * only failed at run time, and only when a test went through it (#79).
 *
 * The suites import `server/` and `contract/` modules to take fixtures from the real producers.
 * Those files compile here in the device's type world (React Native's globals, the launcher's
 * `Response.body` augmentation), which is not theirs: `server:test` type-checks both workspaces
 * against their own configs. So a diagnostic located in a `server/` or `contract/` file is left to
 * that check; every diagnostic in a suite, or in any other file, fails this one.
 *
 *   node scripts/typecheck-tests.mjs   (also the second half of `npm run typecheck`)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(root, 'tsconfig.tests.json');
const OWN_PROJECTS = ['server', 'contract'].map((dir) => path.join(root, dir) + path.sep);

const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error) {
  console.error(ts.formatDiagnostic(config.error, formatHost()));
  process.exit(1);
}
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, undefined, configPath);
const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options, projectReferences: parsed.projectReferences });
const all = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];

const checkedElsewhere = (d) => d.file !== undefined && OWN_PROJECTS.some((dir) => path.resolve(d.file.fileName).startsWith(dir));
const reported = all.filter((d) => !checkedElsewhere(d));

function formatHost() {
  return { getCanonicalFileName: (f) => f, getCurrentDirectory: () => root, getNewLine: () => '\n' };
}

if (reported.length > 0) {
  console.error(ts.formatDiagnosticsWithColorAndContext(reported, formatHost()));
  console.error(`typecheck:tests FAILED: ${reported.length} error(s) in the Node acceptance suites.`);
  process.exit(1);
}
console.log(`typecheck:tests OK: ${parsed.fileNames.length} suite files; ${all.length} diagnostic(s) in server/ or contract/ files left to their own projects.`);
