## MODIFIED Requirements

### Requirement: Server workspace and runtime
The repo SHALL provide an npm workspace `server/` (package `@whim/server`): a Node 26 HTTP service whose runtime dependencies are exactly `hono`, `@hono/node-server`, `pino`, `@whim/contract` (+`zod` via the contract), and the three packages the generation harness executes at run time: `esbuild` (candidate builds), `playwright` (the synthetic run's browser), and `typescript` (the static checker).

Those three SHALL be pinned to exactly the versions the lockfile resolves for the repo's root development dependencies, so the workspace and the root never carry two versions of any of them. `pino-pretty` SHALL be a dev dependency only, and the service SHALL run with structured JSON output when it is absent. The workspace MUST NOT depend on `react`, `react-dom`, or anything React-Native-adjacent (the workspace-hoist safety rule).

Dev/test execution SHALL follow the repo's esbuild-bundle-then-run idiom (`npm run server:dev`, `npm run server:test`) with no new test framework. Production execution SHALL use the prebuilt runtime tree defined by `server-deployment`, never the dev runner. The server SHALL bind `WHIM_SERVER_HOST` (default `0.0.0.0`) on `WHIM_SERVER_PORT` (default 8787), so LAN devices can reach the dev server. TLS is terminated by the deployment's front proxy, not by the service.

#### Scenario: LAN-reachable dev server
- **WHEN** `npm run server:dev` starts on the dev machine
- **THEN** a client on the same LAN can `GET /healthz` over plain HTTP and receive `200`

#### Scenario: Dependency budget enforced
- **WHEN** the suite inspects `server/package.json` and the lockfile
- **THEN** runtime deps are exactly the allowed set, `esbuild`, `playwright`, and `typescript` are pinned to the lockfile-resolved root versions, `pino-pretty` appears only under dev dependencies, and anything React-adjacent fails the test

#### Scenario: The service runs without the pretty printer
- **WHEN** the server starts in an environment where `pino-pretty` is not installed
- **THEN** it starts normally and emits structured JSON log lines
