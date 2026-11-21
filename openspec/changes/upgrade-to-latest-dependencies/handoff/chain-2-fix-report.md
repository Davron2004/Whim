# chain-2-fix: builder report (deploy attempt 1 boot failure)

NODE: v26.13.1 for every node/npm/npx command below, all under the RSS watchdog.

## Cause (reproduced from the evidence, not re-derived)

`package-lock.json` (after chain-1's bumps) nests part of the server's production closure under
`server/node_modules/` (pino, @google-cloud/firestore, firestore-api, google-gax,
google-auth-library, gaxios, gcp-metadata, google-logging-utils, proto3-json-serializer,
real-require, retry-request). The deps stage's `npm ci --omit=dev --workspace server` installs
those into `/deps/server/node_modules`, but the runtime stage copied only `/deps/node_modules`, so
`/app/server/main.mjs` could not resolve `pino` (`ERR_MODULE_NOT_FOUND`, deploy-2.4-attempt-1.md).

## What changed

- `deploy/Dockerfile`
  - deps stage: `mkdir -p node_modules server/node_modules` after `npm ci`, so both copy sources
    exist whatever npm hoists. The `rm -rf …/@whim` and `test ! -e …/react(-native)` guards now
    cover `server/node_modules` as well as `node_modules`.
  - runtime stage: `COPY --from=deps /deps/server/node_modules ./server/node_modules`, next to the
    existing root copy, before the runtime tree. Digest pins, the non-root user, the Playwright pin,
    no secrets and the CMD are unchanged.
- `server/test/deploy-config.suite.ts`: new section "Deploy artifacts: the image carries the
  production dependency closure where Node resolves it" (`imageClosureTests`, model functions
  `productionClosure`, `imageModel`, `placeInImage`, `resolutionProblems`, `copySourceProblems`).
  `declaredRuntimePackages` imported from `server/build.mjs`.
- The lockfile is unchanged.

### Why the fix works for any layout

`npm ci --workspace server --include-workspace-root=false` places each installed package either
in the root `node_modules` or in a workspace folder's `node_modules` (`server/`, or `contract/` for
the linked contract's own deps), with conflicting copies nested as `…/node_modules/<pkg>/node_modules/…`
under either. Node, resolving from `/deps/server` (mirrored as `/app/server`), only searches
`server/node_modules` and then `node_modules`. So every package the server can load at runtime sits
somewhere under one of those two trees. Both trees are copied whole, to the same relative paths
around the entry, which keeps Node's lookup identical to npm's layout: root-hoisted, nested, or
mixed. Anything npm puts under `contract/node_modules` is unreachable from the server by
construction, and `@whim/contract` and its zod are bundled into `main.mjs` anyway. The `mkdir -p`
covers the layout where nothing nests: without it, the `COPY` of a missing directory fails the build.

## The test's model of the image (offline, reached by gate.sh through server:test)

Everything it uses comes from the real producers:
1. **Roots:** `declaredRuntimePackages()` (server/package.json dependencies minus `@whim/*`). The
   existing prod-build suite already holds that every bare import of the built `main.mjs`,
   `whim-admin.mjs` and `whim-waitlist.mjs` is a Node built-in or one of these. That makes them a
   superset of the built entry's bare imports without building anything in this suite.
2. **Closure and placement:** walks `package-lock.json` from the workspace location (`server`)
   using Node's lookup (`<dir>/node_modules/<name>` up the ancestors, skipping `node_modules`
   dirs). It follows dependencies, optionalDependencies and non-optional peers, and skips
   `dev: true` entries (what `--omit=dev` drops) and workspace links. Output: every lockfile
   location installed, plus every import edge (importer location, name, resolved location).
3. **Image:** parses deploy/Dockerfile into stages. It finds the deps stage (the `npm ci
   --omit=dev` RUN), its WORKDIR, its `--workspace` and its `mkdir -p` dirs. In the runtime stage it
   reads every `COPY --from=<deps>` (source, and destination resolved against the WORKDIR in force)
   and the CMD script's directory (`/app/server`, the entry dir).
4. **Assertions:** each closure location maps through the last COPY whose source holds it.
   Failures it reports: "X (loc) is not copied", "A and B are both copied to P" (a collision),
   "X, imported from <importer>, resolves to nothing in the image", or "resolves to P (other
   copy), not to npm's loc" (simulated in image space from the importer's image path; the server's
   own imports are resolved from the entry dir). Also: every COPY source must exist in the deps
   stage (something installed under it, or `mkdir -p`), and must have the `rm -rf <src>/@whim`
   and `test ! -e <src>/react(-native)` guards.
5. **Layouts checked against the real Dockerfile, all clean:** the real lockfile; a *conflicting*
   variant (real lock plus a root `node_modules/pino` that `node_modules/hono` imports, the
   version conflict npm resolves by nesting); a *hoisted* variant (every `server/node_modules/*`
   moved to the root).

In-suite reds, each planted on the real Dockerfile with `plant()`, which throws if the plant does
not apply: only the root COPY (BASE) names `pino (server/node_modules/pino) is not copied` and
`pino, imported from the server entry (/app/server), resolves to nothing`; a COPY to
`./node_modules/server` fails; flattening to `/app/node_modules` fails on the conflicting layout
(`node_modules/pino and server/node_modules/pino are both copied to /app/node_modules/pino`); a
runtime package the lockfile does not install names `left-pad`; dropping `mkdir -p` fails the
hoisted layout; dropping the `server/node_modules/react-native` guard fails.

Honest limit: on **today's** lockfile, flattening `server/node_modules` into `/app/node_modules`
would boot, because no package name sits at both levels inside the production closure. The suite
still rejects that Dockerfile, through the conflicting-layout check. That is the layout a later
re-resolution can produce, and the reason npm nests at all.

## Red-check evidence: mutations of the real deploy/Dockerfile, suite run on each

| mutation | applied (proof) | verdict |
|---|---|---|
| (a) `git checkout e03d6a70 -- deploy/Dockerfile` (BASE) | `git diff --stat HEAD -- deploy/Dockerfile` empty (file = BASE) | exit 1. The first check fails, its problems listing all 11 nested packages incl. `pino (server/node_modules/pino) is not copied into the runtime image` and `pino, imported from the server entry (/app/server), resolves to nothing in the image`. (The planted reds then throw `planted weakening did not apply`, as designed.) |
| (b1) dest `./node_modules/server` | `git diff` shows `+COPY --from=deps /deps/server/node_modules ./node_modules/server` | exit 1. Real-lock check fails: `@google-cloud/firestore, …` and `pino, imported from the server entry (/app/server), resolves to nothing in the image`. Conflicting-layout check: `pino … resolves to /app/node_modules/pino (node_modules/pino), not to npm's server/node_modules/pino` |
| (b2) dest `/app/node_modules` | `git diff` shows `+COPY --from=deps /deps/server/node_modules /app/node_modules` | exit 1. Real-lock check passes (see the honest limit above). Conflicting-layout check fails: `node_modules/pino and server/node_modules/pino are both copied to /app/node_modules/pino` |

The fixed Dockerfile was restored after each mutation (from a scratch copy). The final diff holds
only the fix.

## Commands (Node 26, worktree)

| command | exit |
|---|---|
| `npm run server:test -- --only deploy-config` (final code) | 0 (804 passed) |
| `npm run server:test` (full, final code after the lint refactor) | 0 (5594 passed, 0 failed) |
| `npm run typecheck` | 0 |
| `npm run lint` | 0. The first run failed with 3 sonarjs/cognitive-complexity errors in the new code; refactored into smaller helpers. |
| `npx knip` | 0 |
| gate.sh / gate-full.sh | not run (runner's job) |

## Docker evidence (required by the PO steer)

`docker build --platform linux/amd64 -f deploy/Dockerfile -t whim-server:fix-local .` exited 0
(all deps-stage guards passed). From `/app/server` inside the image, a mounted script dynamically
imported every runtime dependency named in server/package.json:

```
ok   @google-cloud/firestore -> file:///app/server/node_modules/@google-cloud/firestore/build/src/index.js
ok   @hono/node-server -> file:///app/node_modules/@hono/node-server/dist/index.mjs
ok   esbuild -> file:///app/node_modules/esbuild/lib/main.js
ok   hono -> file:///app/node_modules/hono/dist/index.js
ok   pino -> file:///app/server/node_modules/pino/pino.js
ok   playwright -> file:///app/node_modules/playwright/index.mjs
ok   typescript -> file:///app/node_modules/typescript/lib/typescript.js
resolve-ok
```

`ls -A /app/server/node_modules` in the image: `.bin @google-cloud gaxios gcp-metadata
google-auth-library google-gax google-logging-utils pino proto3-json-serializer real-require
retry-request`. That is exactly the model's nested non-dev set (the dev-flagged colorette,
pino-pretty and strip-json-comments are absent). `docker rmi whim-server:fix-local` done. The image
was not booted with a production config, and nothing was deployed.

## HARNESS FEEDBACK

- CAUGHT-REAL-MISTAKE: the brief's "would have caught it" requirement plus the steer's
  layout-independence point surfaced that the obvious faithful model passes the flattened
  `/app/node_modules` variant on today's lockfile. The fix was to test the Dockerfile against
  lockfile layouts npm can write (conflicting, hoisted), not only today's. Cost: one extra
  iteration. Evidence: mutation (b2) row.
- DRAWBACK: the existing image checks were string and instruction checks. Nothing modelled the
  production tree's contents, so a lockfile re-resolution with a Dockerfile that never changed
  shipped a non-booting image. The prod-build suite symlinks the declared packages flat into
  `node_modules`, so it can't see npm's layout either. Proposed: any change that touches
  package-lock.json should require this deploy-config section to pass (it does now, via
  server:test in gate.sh).
- ENV: Node 26 PATH prefix and the watchdog worked without friction. The docker build finished
  inside the 1800 s / 6144 MB cap.
- NEUTRAL: sonarjs cognitive-complexity caught 3 over-long functions in new test code on the
  first lint run. Cheap to fix.
- What helped: the deploy report's exact error and the brief's pointer to the
  `server/node_modules/` lockfile keys made the cause immediately checkable.
