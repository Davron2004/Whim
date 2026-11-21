/**
 * The dependency pin register (`dependency-pins.json`, spec `dependency-currency`) and what reads
 * it: the offline check the fast gate runs (`checks/test/repo/dependency-pins.suite.ts`) and the
 * networked `npm run deps:audit` (`scripts/deps-audit.mjs`).
 *
 * Every direct dependency of every workspace resolves to its npm `latest` dist-tag, or the register
 * holds an entry for it. An entry is one flat object:
 *
 *   { "package": "@babel/core", "range": "^7", "reason": "<the blocker>", "lift": "<the event>" }
 *
 * `range` is a semver range the lockfile's resolved version must satisfy. The matcher below covers
 * what a register needs (`^`, `~`, exact, x-ranges, `>= <` comparators, `||`) and refuses anything
 * else rather than guessing. As in semver, a prerelease version satisfies a range only through a
 * comparator that names a prerelease of the same major.minor.patch.
 */
import fs from 'node:fs';
import path from 'node:path';

export const PIN_REGISTER_FILE = 'dependency-pins.json';

const ENTRY_FIELDS = ['package', 'range', 'reason', 'lift'];
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const OPERATOR = /^(\^|~|>=|<=|>|<|=)?v?/;
const NUMBER = /^\d+$/;
const WILDCARD = /^[xX*]$/;

/** `{ major, minor, patch, pre }` for a full version, or null when `text` is not one. */
function parseVersion(text) {
  const m = VERSION.exec(String(text).trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split('.') : [] };
}

/** semver's prerelease identifier order: numbers numerically and before words, words in ASCII order. */
function compareIdentifier(a, b) {
  const numeric = [NUMBER.test(a), NUMBER.test(b)];
  if (numeric[0] && numeric[1]) return Number(a) - Number(b);
  if (numeric[0] !== numeric[1]) return numeric[0] ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function comparePre(a, b) {
  if (a.length === 0 || b.length === 0) return b.length - a.length; // a release sorts after its prereleases
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const order = compareIdentifier(a[i], b[i]);
    if (order !== 0) return order;
  }
  return a.length - b.length;
}

function compareParsed(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch || comparePre(a.pre, b.pre);
}

/** Negative, zero or positive as version `a` sorts before, with or after `b`. Throws on a non-version. */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) throw new Error(`not a version: ${pa ? b : a}`);
  return compareParsed(pa, pb);
}

const v = (major, minor, patch, pre = []) => ({ major, minor, patch, pre });
const at = (op, version) => ({ op, version });
const unsupported = (term) => new Error(`unsupported range term "${term}"`);

/** A range term split into its operator and its (possibly partial) version: `major`, `minor` and
 *  `patch` are null where omitted or wild. `1.x.3` and a prerelease on a partial are refused. */
function parsePartial(term) {
  const [prefix, op = ''] = OPERATOR.exec(term);
  const [core, ...preParts] = term.slice(prefix.length).split('+')[0].split('-');
  const parts = core.split('.');
  if (parts.length > 3 || parts.some((p) => !NUMBER.test(p) && !WILDCARD.test(p))) throw unsupported(term);
  const [major, minor, patch] = [0, 1, 2].map((i) => (parts[i] === undefined || WILDCARD.test(parts[i]) ? null : Number(parts[i])));
  const pre = preParts.length > 0 ? preParts.join('-').split('.') : [];
  if ((major === null && minor !== null) || (minor === null && patch !== null) || (pre.length > 0 && patch === null)) throw unsupported(term);
  return { op, major, minor, patch, pre };
}

/** The exclusive top of a partial version: the next major for `1`, the next minor for `1.2`. */
const partialCeiling = ({ major, minor }) => (minor === null ? v(major + 1, 0, 0) : v(major, minor + 1, 0));

/** `^`: the next major, except that below 1.0.0 the first non-zero part is the one that may not change. */
function caretCeiling({ major, minor, patch }) {
  if (major !== 0 || minor === null) return v(major + 1, 0, 0);
  if (minor !== 0 || patch === null) return v(0, minor + 1, 0);
  return v(0, 0, patch + 1);
}

/** Per operator: the primitive comparators for a partial `p` whose missing parts read as 0 (`floor`). */
const TERM_COMPARATORS = {
  '^': (p, floor) => [at('>=', floor), at('<', caretCeiling(p))],
  '~': (p, floor) => [at('>=', floor), at('<', partialCeiling(p))],
  '>=': (p, floor) => [at('>=', floor)],
  '<': (p, floor) => [at('<', floor)],
  '>': (p, floor) => [p.patch === null ? at('>=', partialCeiling(p)) : at('>', floor)],
  '<=': (p, floor) => [p.patch === null ? at('<', partialCeiling(p)) : at('<=', floor)],
  '=': (p, floor) => (p.patch === null ? [at('>=', floor), at('<', partialCeiling(p))] : [at('=', floor)]),
};

/** One range term (`^1.2`, `>=1.4.1`, `1.x`, `*`, …) as primitive `{ op, version }` comparators. */
function termComparators(term) {
  const p = parsePartial(term);
  const op = p.op === '' ? '=' : p.op;
  if (p.major !== null) return TERM_COMPARATORS[op](p, v(p.major, p.minor ?? 0, p.patch ?? 0, p.pre));
  if (['=', '>=', '<='].includes(op)) return []; // `*`, `x`, `>=*`: any version
  throw unsupported(term);
}

/** The range as alternatives (`||`), each a list of primitive comparators. Throws on a range this
 *  matcher does not understand. */
function parseRange(range) {
  const text = String(range).trim();
  if (text === '') throw new Error('empty range');
  return text.split('||').map((alt) => {
    const terms = alt.trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) throw new Error(`empty alternative in range "${text}"`);
    return terms.flatMap(termComparators);
  });
}

const HOLDS = {
  '=': (c) => c === 0,
  '>': (c) => c > 0,
  '>=': (c) => c >= 0,
  '<': (c) => c < 0,
  '<=': (c) => c <= 0,
};

const sameTriple = (a, b) => a.major === b.major && a.minor === b.minor && a.patch === b.patch;

/** Whether `version` satisfies `range`. Throws when either is not something this matcher reads. */
export function satisfies(version, range) {
  const parsed = parseVersion(version);
  if (!parsed) throw new Error(`not a version: ${version}`);
  return parseRange(range).some(
    (comparators) =>
      comparators.every((c) => HOLDS[c.op](compareParsed(parsed, c.version))) &&
      (parsed.pre.length === 0 || comparators.some((c) => c.version.pre.length > 0 && sameTriple(c.version, parsed))),
  );
}

/** Why this matcher cannot read `range`, or null when it can. */
function rangeProblem(range) {
  try {
    parseRange(range);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Whether every `||` alternative of a readable `range` has an upper bound (`<`, `<=` or an exact
 *  version). A pin is held below a `latest`, so a range without a ceiling holds nothing back. */
function hasUpperBound(range) {
  return parseRange(range).every((comparators) => comparators.some((c) => ['<', '<=', '='].includes(c.op)));
}

/** The finding for a range this check cannot read or that has no ceiling, or null when it is usable. */
function rangeFindingFor(name, range) {
  const problem = rangeProblem(range);
  if (problem !== null) return `${PIN_REGISTER_FILE}: ${name}: range "${range}" is not one this check reads (${problem})`;
  if (!hasUpperBound(range)) return `${PIN_REGISTER_FILE}: ${name}: range "${range}" has no upper bound, so it holds nothing below the latest`;
  return null;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Every workspace (root first, as `.`), with its manifest. Workspace globs are refused: this repo
 *  lists its workspaces by name. */
export function readWorkspaces(root) {
  const rootManifest = readJson(path.join(root, 'package.json'));
  const dirs = Array.isArray(rootManifest.workspaces) ? rootManifest.workspaces : [];
  for (const dir of dirs) if (/[*?{]/.test(dir)) throw new Error(`workspace glob "${dir}" is not supported`);
  return [{ dir: '.', manifest: rootManifest }, ...dirs.map((dir) => ({ dir, manifest: readJson(path.join(root, dir, 'package.json')) }))];
}

/** One row per declared dependency/devDependency of every workspace, workspace packages excluded. */
export function declaredDependencies(workspaces) {
  const internal = new Set(workspaces.map((w) => w.manifest.name));
  const rows = [];
  for (const { dir, manifest } of workspaces) {
    for (const field of ['dependencies', 'devDependencies']) {
      for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
        if (!internal.has(name)) rows.push({ workspace: dir, name, spec });
      }
    }
  }
  return rows;
}

/** The version the lockfile resolves `name` to for `workspace` (its own nested copy first, then the
 *  hoisted one), or null. */
export function resolvedVersion(lock, workspace, name) {
  const packages = lock.packages ?? {};
  const keys = workspace === '.' ? [`node_modules/${name}`] : [`${workspace}/node_modules/${name}`, `node_modules/${name}`];
  for (const key of keys) {
    const entry = packages[key];
    if (entry && typeof entry.version === 'string' && !entry.link) return entry.version;
  }
  return null;
}

/** The register's entries. Throws when the file is missing, is not JSON, or is not an array. */
export function readPinRegister(root) {
  const file = path.join(root, PIN_REGISTER_FILE);
  const register = readJson(file);
  if (!Array.isArray(register)) throw new Error(`${PIN_REGISTER_FILE} must be a JSON array of entries`);
  return register;
}

const filled = (value) => typeof value === 'string' && value.trim() !== '';

/**
 * Every way the register at `root` breaks the spec, one message per finding, each naming the
 * package: missing/empty fields, unknown fields, an unreadable or unbounded range, duplicates, stale entries (no
 * workspace declares the package), and a lockfile version outside the entry's range.
 */
export function pinRegisterFindings(root) {
  let register;
  try {
    register = readPinRegister(root);
  } catch (err) {
    return [`${PIN_REGISTER_FILE}: ${err instanceof Error ? err.message : String(err)}`];
  }
  const workspaces = readWorkspaces(root);
  const declared = declaredDependencies(workspaces);
  const lock = readJson(path.join(root, 'package-lock.json'));
  const findings = [];
  const seen = new Map();

  register.forEach((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      findings.push(`${PIN_REGISTER_FILE}: entry #${index + 1} is not an object`);
      return;
    }
    if (!filled(entry.package)) {
      findings.push(`${PIN_REGISTER_FILE}: entry #${index + 1} has a missing or empty "package"`);
      return;
    }
    const name = entry.package;
    seen.set(name, (seen.get(name) ?? 0) + 1);
    for (const key of Object.keys(entry)) {
      if (!ENTRY_FIELDS.includes(key)) findings.push(`${PIN_REGISTER_FILE}: ${name}: unknown field "${key}"`);
    }
    for (const key of ['range', 'reason', 'lift']) {
      if (!filled(entry[key])) findings.push(`${PIN_REGISTER_FILE}: ${name}: missing or empty "${key}"`);
    }
    const users = declared.filter((d) => d.name === name);
    if (users.length === 0) {
      findings.push(`${PIN_REGISTER_FILE}: ${name}: stale entry, no workspace package.json declares it`);
      return;
    }
    if (!filled(entry.range)) return;
    const rangeFinding = rangeFindingFor(name, entry.range);
    if (rangeFinding !== null) {
      findings.push(rangeFinding);
      return;
    }
    for (const { workspace } of users) {
      const resolved = resolvedVersion(lock, workspace, name);
      if (resolved === null) findings.push(`${PIN_REGISTER_FILE}: ${name}: the lockfile resolves no version for workspace ${workspace}`);
      else if (!satisfies(resolved, entry.range)) {
        findings.push(`${PIN_REGISTER_FILE}: ${name}: the lockfile resolves ${resolved} (workspace ${workspace}), outside the pinned range ${entry.range}`);
      }
    }
  });
  for (const [name, count] of seen) {
    if (count > 1) findings.push(`${PIN_REGISTER_FILE}: ${name}: duplicate entry (${count} entries name it)`);
  }
  return findings;
}
