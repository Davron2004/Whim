## Why

People who signed up at the 2026-09-24 demo are waiting for a beta invite. The build they would get
today (382511) predates the legal update and traps the core iOS flow behind a keyboard that can't be
dismissed. `main` fixes the legal side but hangs forever on iOS at the age check. Before anyone
outside the team installs Whim, the first session has to work on both platforms, and the server has to
take the burst the invite email causes. Ranking and evidence: `docs/beta-readiness-2026-09-24.md`.

The first build testers install is also the oldest reader of the wire that every later server must
still work with. Anything that makes the protocol able to grow has to be in that build, because it
can't be added afterwards. The builds installed today (the owner's and his mom's) are not a constraint:
nobody else has one, and this change breaks them on purpose, then retires them with the minimum-build
gate.

## What Changes

**A wire protocol that can grow (lands first; everything below uses it)**
- **BREAKING** Every `/v1` request declares the protocol level the app understands
  (`x-whim-protocol`). The server never sends a client something above its level; it sends a
  lower-level form or a fallback instead. A request with no level gets `426 update_required`.
- **BREAKING** Every SSE event and unary body can carry a `compat` envelope: the minimum level
  needed to use it, plus a fallback from a closed, frozen set: `skip`, `fail` (with a plain-text
  notice), `update` (the update screen with a notice). The app decodes the envelope first and applies the
  fallback to anything it can't use. Known messages ignore unknown fields. Old apps then degrade
  honestly instead of throwing, which is the "closure" idea, made declarative.

**Tier 0: the first session works (app build)**
- The age check ends within a fixed deadline, and a missing answer counts as `unavailable` (#100).
- Keyboard handling across the host shell: content and the primary action stay reachable, the
  keyboard can be dismissed on both platforms, Compose doesn't autofocus, and inputs inside a running
  mini-app stay visible (#50, #49).
- Apple's significant-change acknowledgment is asked of a supervised minor's guardian when the terms
  they accepted are older than the current terms (#86).
- A render error after first paint shows the failure screen, not a blank mini-app (#88).
- Mini-app content is never stuck under the orb: the host passes its footprint into the realm, and
  the SDK's `Screen` pads for it (#82).
- Settings → "Turn on AI features" shows each legal screen at most once (#104). The 8.2(a) wording
  is updated.
- Diagnostic stacks carry file names, not install-specific paths (#101).

**Tier 0: the server takes the invite burst**
- **BREAKING** A real line: when every generation slot is busy, the stream opens and the app shows
  "You're in line, N ahead" until the generation's turn. There are caps on line length and wait time,
  and no daily unit is spent until the generation gets a slot (#118).
- Concurrency caps come from a load test of the production machine type (#118).

**Tier 1: fewer bad or wasted builds**
- **BREAKING** Clarify can answer "Whim can't build this, here's the nearest thing it can": a new
  `limit` arm with a reason and an alternative. The app offers to build the alternative or change the
  idea (#70). Clarify and plan writing share one list of what mini-apps can't do, so they never offer
  those things (#62).
- **BREAKING** A model turn that loses its provider is retried once, including mid-stream. A new
  `restart` event tells the app to discard that turn's partial activity (#57).
- **BREAKING** Clarify questions say how they're answered: pick one or pick several, optionally a
  typed "Other", and every question offers "Decide for me", which delegates it to Whim. The plan
  then states what Whim decided. Typed answers go through the content check like the prompt.
- A containment/unverified verdict logs its kind and which check tripped, never content (#58).
- An optional quantization floor for OpenRouter routing (#68).
- "No changes" only when the source really didn't change (#106).

**Tier 1: first-impression polish (app build)**
- The tile watermark stays inside the rounded corners (#48, if it still reproduces). The examples have
  distinct tile colours (#52's collision).
- The orb scrim covers the status bar, and there's no stray grey disc on Android (#105). Counts in
  English copy use an explicit English locale (#89).

**Release**
- Every beta build passes a scripted upgrade check (previous build → new build keeps apps, versions,
  data, consent, device id) before it ships (#72, first half). For beta-1 the "previous build" is
  382511.
- After beta-1's builds are in TestFlight and Play, raise `WHIM_MIN_BUILD_IOS`/`_ANDROID` to them,
  so older installs see the update screen.

## Capabilities

### New Capabilities
- `release-upgrade-check`: the scripted upgrade-over-install check a beta build must pass before
  release, with recorded evidence.

### Modified Capabilities
- `generation-contract`: the protocol level header; the `compat` envelope and its frozen fallback
  set; `queued` and `restart` events; the clarify `limit` arm and answer modes (`select`, `other`);
  clarification answers as `choices`/`other`/`decide`; `compat` on `ApiError`.
- `prompt-flow`: the in-line build screen; the "can't build this" answer; multi-select, "Other"
  and "Decide for me" on clarify questions; restart handling;
  fallbacks for unusable messages; the stall heartbeat counts `queued`/`restart`.
- `server-admission-control`: the line (queue) on the stream; caps from a load test.
- `generation-pipeline`: capability limits in clarify/plan, including the `limit` arm; answer modes
  chosen by clarify and delegated questions decided in the plan; the single
  retry with `restart`; verdict logging; the no-change rule; the quantization floor.
- `content-policy`: typed clarify answers are classified with the prompt.
- `store-age-signals`: the age-check deadline; the significant-change acknowledgment.
- `terms-acceptance`: each legal screen at most once per pass.
- `app-launcher`: shell keyboard handling; the orb footprint; orb scrim/disc; tiles; locale; post-paint
  render failure → failure screen.
- `sandbox-rendering`: the root error boundary's `render` frame; `Screen` pads for the host inset;
  focused inputs scroll into view.
- `device-diagnostics`: stack frames reduced to file names.

(`content-policy`, `store-age-signals`, `terms-acceptance`, `device-diagnostics` and `server-admission-control`
still exist only as deltas in unarchived changes (#69); here they only get ADDED requirements.)

## Impact

- Contract: `contract/src/index.ts` (envelope, events, clarify arm, protocol constant), plus the
  device decoder (`generation-client.ts`, the unary clients, `service-refusal.ts`) and a server
  emitter helper.
- App: `src/host/launcher/*` (age check, legal flow, Compose/Plan/Build/Clarify screens, MiniAppView,
  Orb, tiles, copy, useMiniAppHost), `src/host/logging/crash-capture.ts`, `ios/Whim/WhimAgeSignal*`,
  `src/runtime/web/loader.js`, `src/sdk/index.tsx` (artifacts regenerated with `npm run build`).
- Server: `server/src/admission/*`, `routes/{generate,clarify}.ts`, `generation/{machine,prompts,summarise}.ts`,
  `generation/stages/run.ts`, `openrouter.ts`, `config.ts`, request-edge middleware (protocol header),
  `deploy/profiles/standard.env`, `docs/deploy.md`.
- Release: `docs/release/mobile.md`, `scripts/release/upgrade-check.sh`, Maestro flows.
- No new dependency. Builds 381237/382511 stop working against the new server by design. Their
  data survives the upgrade to beta-1 (the upgrade check proves it).
- Rollout: the server and app ship together. The server deploy lands just before the beta-1 builds
  go to testers, and the owner's two phones update from TestFlight.
