# Contract: the dependency pin register (chain-1)

Spec: `specs/dependency-currency/spec.md`. Consumers: every later chain that holds a package below
its npm `latest` (chains 3 and 6 add entries).

## File

`dependency-pins.json` at the repo root: a JSON **array** of entries, nothing else.

```json
[
  {
    "package": "@babel/core",
    "range": "^7",
    "reason": "@react-native/babel-preset and Metro (metro-transform-worker) depend on @babel/core ^7.25.2; ...",
    "lift": "A React Native release whose babel preset and Metro support Babel 8"
  }
]
```

| Field | Type | Meaning |
|---|---|---|
| `package` | non-empty string | The npm name, exactly as a workspace `package.json` declares it. |
| `range` | non-empty semver range | What the lockfile may resolve. Supported: `^`, `~`, exact `1.2.3`, x-ranges (`1`, `1.2`, `1.2.x`, `*`), `>= > <= <` comparators joined by spaces (AND), `\|\|` (OR). Anything else is a finding. |
| `reason` | non-empty string | The blocker that rules out `latest`: a peer range, a missing API, a needed migration. Name it. |
| `lift` | non-empty string | The event that lifts the pin. |

No other keys. One entry per package, even when several workspaces declare it (the range applies to
every workspace's resolved copy).

Entries today: `@fission-ai/openspec` (`^1`), `@babel/core` (`^7`), `@babel/runtime` (`^7`).

## Invariants the offline check enforces

Each failure is one message, prefixed `dependency-pins.json:` and naming the package:

1. The file exists, parses, and is an array; each entry is an object.
2. `package`, `range`, `reason`, `lift` are present and non-blank (`missing or empty "<field>"`).
3. No unknown field (`unknown field "<key>"`).
4. No two entries name one package (`duplicate entry (N entries name it)`).
5. Some workspace (`.`, `contract`, `server`) declares the package in `dependencies` or
   `devDependencies` (`stale entry, no workspace package.json declares it`).
6. `range` is readable by the matcher (`range "<r>" is not one this check reads (...)`).
7. For every workspace that declares it, the lockfile's resolved version satisfies `range`
   (`the lockfile resolves <version> (workspace <ws>), outside the pinned range <range>`). The
   workspace's own nested copy (`server/node_modules/x`) is read first, then the hoisted one.
   A prerelease version satisfies a range only via a comparator naming a prerelease of the same
   major.minor.patch (semver rule).

Not checked offline: whether an unpinned package is at `latest` (that needs the registry; see
`deps:audit`). Workspace packages (`@whim/contract`, ...) are never dependencies here.

## Entry points

- Library: `scripts/lib/dependency-pins.mjs` (types `scripts/lib/dependency-pins.d.mts`):
  `pinRegisterFindings(root): string[]` (empty = valid), `readPinRegister(root): PinEntry[]`,
  `satisfies(version, range): boolean`, `compareVersions(a, b): number`,
  `readWorkspaces(root)`, `declaredDependencies(workspaces)`, `resolvedVersion(lock, workspace, name)`,
  `PIN_REGISTER_FILE`.
- Gate check: suite `checks/test/repo/dependency-pins.suite.ts`, wired from
  `checks/test/acceptance.ts` (`runDependencyPins`), so `scripts/gate.sh` runs it via
  `npm run checks:test`. Offline.
- Run it alone: `npm run checks:test -- --only dependency-pins`.

A chain that adds a pin: add the entry, `npm install`, then run the command above. A chain that
lifts a pin (moves to `latest`): delete the entry in the same commit, or the range check fails.

## `npm run deps:audit`

`node scripts/deps-audit.mjs [--root <dir>] [--registry <url>]`. Networked; informational; **never**
called by `scripts/gate.sh` or `scripts/gate-full.sh` (a checks test asserts that).

For every declared dependency of every workspace it reads `<registry>/-/package/<name>/dist-tags`
and compares `latest` (never `next`/`beta`/...) with the lockfile's resolved version. Registry
defaults to `npm_config_registry` (set by `npm run`), else `https://registry.npmjs.org/`.

Output: a summary line; `Undeclared lag (N)` listing `<name>  <resolved> -> <latest>  [<workspace>]`;
`Pins (N)` listing `<name>  range <r>  resolved <v> [<ws>]  latest <l>` then `lift: <lift>`.

| Exit | Meaning |
|---|---|
| 0 | Every dependency resolves to `latest` or has a pin entry. |
| 1 | Undeclared lag: some dependency is not on `latest` and has no entry. |
| 2 | Could not run: unreadable manifest/lockfile/register, a declared dependency the lockfile does not resolve, a registry error (non-2xx, no `latest`, timeout 15 s). |

Tests: `checks/test/repo/deps-audit.suite.ts` (`--only deps-audit`) runs the real script against a
temp repo and a loopback stub registry.
