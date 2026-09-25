## Why

People who signed up at the 2026-09-24 demo are waiting for a beta invite, and the build they'd get
today (382511) predates the legal update and traps the core iOS flow behind an undismissable
keyboard. `main` fixes the legal side but hangs forever on iOS at the age check. Before anyone outside
the team installs Whim, the first session has to work on both platforms, and the server has to take
the burst the invite email causes. Ranking and evidence: `docs/beta-readiness-2026-09-24.md`.

## What Changes

**Tier 0: the first session works (app build)**
- The age check ends within a fixed deadline and counts a missing answer as `unavailable`, so AI
  features never sit on a blank screen (#100).
- Keyboard handling across the host shell: content and the primary action stay reachable above the
  keyboard, and the keyboard can be dismissed on both platforms. Compose doesn't autofocus. Inputs inside
  a running mini-app stay visible (#50, #49).
- Apple's significant-change acknowledgment is requested from a supervised minor's guardian when the
  terms they accepted are older than the current terms (#86).
- A render error after first paint shows the failure screen instead of a blank mini-app (#88).
- Mini-app content is never permanently under the orb: the host passes the orb's footprint into the
  realm and the SDK's `Screen` pads for it (#82).
- Settings → "Turn on AI features" shows each legal screen at most once (#104). The 8.2(a) task wording in
  `developer-observability` says an *up-to-date* grant isn't re-asked.
- Diagnostic stacks carry file names, not install-specific paths (#101).

**Tier 0: the server takes the invite burst**
- Caps set from a load test of the production machine type. A generation that finds every slot busy
  waits briefly, first come first served, before it's refused. The wait stays inside the device's
  first-chunk window, so shipped builds are unaffected (#118).

**Tier 1: fewer bad builds (server, deploys without an app build)**
- Clarify and plan writing know what a mini-app can't do (network, live data, notifications while
  closed, other people's devices). They steer impossible asks to the nearest buildable version, and the
  plan says so (#62, the plan-time half of #70).
- An engineer turn whose provider fails before it has streamed anything is retried once (#57).
- A containment/unverified verdict logs its kind and which check tripped, never content (#58).
- An optional quantization floor for OpenRouter routing, set from the operator config (#68).
- A "No changes" summary is given only when the source didn't change (#106).

**Tier 1: first-impression polish (app build)**
- Tile watermark stays inside the rounded corners and never truncates (#48, if it still reproduces).
  The built-in examples have distinct tile colours (#52's collision).
- The orb scrim covers the status bar; no stray grey disc on Android (#105).
- Counts in English copy use an explicit English locale (#89).

**Release step**
- Every beta build passes an upgrade check (previous build → new build keeps apps, versions,
  per-app data, consent and device id) on both platforms before it ships (#72's first half).

## Capabilities

### New Capabilities
- `release-upgrade-check`: the scripted upgrade-over-install check a beta build must pass before
  release, with its recorded evidence.

### Modified Capabilities
- `store-age-signals`: a deadline on the age check; the significant-change acknowledgment for
  supervised minors.
- `terms-acceptance`: each legal screen shown at most once per pass through the legal flow.
- `app-launcher`: keyboard handling in the shell; orb footprint handed to the realm; orb scrim and
  disc; tile watermark and example colours; locale-explicit counts; post-paint render failure routed to
  the failure screen.
- `sandbox-rendering`: the realm reports a post-paint render failure as fatal. `Screen` pads for the
  host-supplied bottom inset. Focused mini-app inputs stay visible.
- `device-diagnostics`: stack frames are reduced to file names before upload.
- `server-admission-control`: a bounded first-come-first-served wait for a generation slot, and caps
  from a load test.
- `generation-pipeline`: capability limits in clarify/plan prompts; the one-time pre-stream retry of
  an engineer turn; verdict-kind logging; the no-change summary rule; the quantization floor.

(`store-age-signals`, `terms-acceptance`, `device-diagnostics` and `server-admission-control`
still live only as deltas in unarchived changes (#69). This change only ADDs requirements to them.)

## Impact

- App: `src/host/launcher/*` (age check, legal flow, Compose/Plan, MiniAppView, Orb, tiles, copy,
  useMiniAppHost), `src/host/logging/crash-capture.ts`, `ios/Whim/WhimAgeSignal*`, `src/runtime/web/loader.js`
  and `src/sdk/index.tsx` (regenerated artifacts via `npm run build`).
- No new dependency: keyboard handling uses React Native's built-ins (design D3).
- Server: `server/src/admission/*`, `routes/generate.ts`, `generation/{machine,prompts,summarise}.ts`,
  `generation/stages/run.ts`, `openrouter.ts`, `config.ts`, `deploy/profiles/standard.env`,
  `docs/deploy.md`.
- Release: `docs/release/mobile.md` and a new upgrade-check script under `scripts/release/`.
- No wire-contract change: no new `GenerationEvent` type or stage value, and no clarify schema change.
  TestFlight 381237/382511 keep working.
- After merge: a server deploy (independent of the app), then new iOS and Android builds → simulator,
  emulator and upgrade check → demo phone → `Public beta` and the Play closed track → invites.
