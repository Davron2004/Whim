# Context chains: health-probe-path

## chain-1: server-health-route

- tasks: 1.1–1.3
- rationale: one server route and the load-test wrapper that shadows it, with the server suites that pin health behaviour.
- reads: specs/generation-server/spec.md §"Device-identity middleware"; specs/app-update-gate/spec.md §"The server refuses builds below a per-platform minimum"; design.md D1, D3; research.md "Current behavior" (Server); handoff: none
- writes-contract: handoff/health-route.md (`/health` path, body shape verbatim, load-test identity on both paths)
- files: `server/src/app.ts`, `server/src/loadtest/server.ts`, `server/test/{server-core,request-edge,loadtest}.suite.ts` (and `e2e.ts`/`prod-build.suite.ts` only if they pin the health path)

## chain-2: app-probe-fallback

- tasks: 2.1–2.3
- rationale: the app's single health URL builder and the launcher fixtures that answer by path. It touches no server or deploy file, so it runs parallel to chain-1.
- reads: specs/app-update-gate/spec.md §"The app shows an update screen that blocks AI features, not the app"; design.md D2; research.md "Current behavior" (App) and "Integration points" (app fixtures list); handoff: none
- writes-contract: none
- files: `src/host/launcher/server-probe.ts`, `src/host/launcher/**/test` fixtures and suites listed in research.md (`server-probe`, `connectivity-ux`, `settings-screen`, `diagnostics-ui`, `request-envelope-ui`, `consent-gate-ui`, `app-link-ui`, `launcher-interactions`, `rendered-launcher.tsx`)

## chain-3: deploy-and-docs

- tasks: 3.1–3.3
- rationale: operator surfaces (smoke, uptime check, runbook) move together. The smoke body fixtures are derived from the real server's producer, so this chain needs chain-1's route.
- reads: specs/app-update-gate/spec.md §"Raising a minimum is a documented operator step"; design.md D4; research.md "Integration points" (Deploy); handoff: handoff/health-route.md
- writes-contract: none
- after: chain-1
- files: `deploy/smoke.sh`, `deploy/monitoring/uptime-healthz.env`, `deploy/monitoring/policy-api-down.json`, `deploy/cloudrun/deploy.sh`, `server/test/deploy-config.suite.ts`, `docs/deploy.md`, `docs/store/review-notes.md`

## Not dispatched

- tasks 4.1–4.2: production rollout and the monitoring update (orchestrator, attended, after merge).
