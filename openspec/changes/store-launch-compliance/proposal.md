## Why

Whim can't pass App Store or Google Play review as it stands. Apple 5.1.2(i) requires explicit permission before personal data goes to third-party AI, and today the first prompt leaves the device with no disclosure at all. Guideline 4.7, Whim's defense against 2.5.2, asks for content reporting and universal links to every mini-app. Google Play's AI-generated content policy asks for in-app reporting too. None of that exists (research.md A "Settings", A "Links/clipboard"). The public server that `public-generation-server` stands up adds content-policy and admission refusals, and today the launcher would render every one of them as a generic failure screen (research.md B "Failure mapping"). A reviewer can't type a server address either, so a release build needs a default.

## What Changes

- **AI data consent.** The first action that would send anything to the server (making or changing an app, a Retry) opens a full-screen disclosure first. It says what is sent (the request text, answers and plan; on edits, the app's code, description and data layout; an anonymous phone ID), what is never sent (anything saved inside apps), and who receives it (AnyCognition's server and the AI model providers it reaches through OpenRouter), with a privacy policy link. Then the user agrees or declines. The grant is versioned, so a policy change asks again. Until consent exists the launcher sends no request of any kind, connectivity probes included, with one exception: a report the user sends by hand. Declining keeps every installed app working. Settings shows the state and can review or turn it off.
- **Content reports.** A report sheet opens from the orb inside a running mini-app, from the done step, and from the history screen header. The user picks a reason, can add a note, and sees a preview of exactly what will be sent, built from the same request body that Send posts. The prompt and the app's code can each be left out. The sheet posts `POST /v1/report` and never leaves the app.
- **Service refusal UX.** The client matches refusals on the contract's closed `ServiceRefusalCode` enum. A refusal shows the server's hint as an inline notice on the step where the user can act, with that step's state kept. Refusals about the text itself land where the text is edited. Limits and availability refusals land on the step whose action sent the request. While a `Retry-After` window is open, the retry action stays disabled and says when it's usable. A refusal never opens the failure screen from compose, clarify, or plan, and a refused fresh build leaves no ghost tile. **BREAKING** for pending-builds: a new deletion cause joins delivery, cancel and dismiss.
- **Release configuration.** One domain constant derives the production server URL, web origin, privacy policy URL, support URL and app-link base. When the user has set no override, the launcher uses the compiled-in server. Settings is reorganised into AI features, Highlighting, About (privacy policy, support) and a collapsed Advanced section that holds the server address.
- **Universal links.** `https://whim.<domain>/a/<appId>` opens that mini-app when it's on this phone, reattaches to its build if it's still pending, and otherwise shows a "this app lives on another phone" screen. The tile long-press sheet gets an "App link" row that reveals the link as selectable text. The change also writes down exactly what the native projects and the web host must provide (entitlement, intent filter, AASA, assetlinks, AppDelegate forwarding) as a contract for the platform change and ops.
- **Store review notes.** A docs chain drafts `docs/store/review-notes.md`: App Review notes arguing 4.7 and the Play Console declarations that follow from it, plus a pre-submission checklist.

Non-goals: server implementation, native project config, signing, icons, iOS back handling, the age gate, accounts, BYOK, sharing between users.

## Capabilities

### New Capabilities
- `ai-data-consent`: disclosure content, explicit versioned permission, the no-request-before-consent rule, decline behaviour, review and revoke from Settings.
- `content-reporting`: report entry points, the sheet (reason, note, include toggles, exact-body preview), submission outcomes, logging rules.
- `service-refusals`: classification on `ServiceRefusalCode`, where each refusal lands, `Retry-After` gating, and the notice presentation.
- `release-config`: the single domain constant, derived URLs, default-server fallback, and the rule that no other launcher source spells those URLs.
- `app-links`: link grammar, cold and warm handling, open/reattach/missing resolution, leaving the current screen, the App link sheet, and the platform/ops contract.

### Modified Capabilities
- `app-launcher`: the server address becomes an optional override under a collapsed Advanced section; Settings gains titled sections with privacy and support links.
- `prompt-flow`: the failure screen requirement excludes service refusals of compose, clarify and plan requests.
- `pending-builds`: a fresh attempt refused while its build screen is showing is deleted like a cancel; every other refusal settles `failed` with the hint as its reason.
- `generation-stream-transport`: `GenerationClientError` carries the `ApiError` identifier and a parsed `Retry-After` on both transports.
- `server-connectivity` (from the unarchived `server-connectivity` change, treated as applied): probing waits for consent, a structured refusal counts as a successful response, the save-time probe is skipped without consent, and the "no address configured" requirement is removed because a default always exists.
- `mini-app-back-navigation`: while a host sheet is open over a mini-app, system back closes the sheet before any forwarding or exit.
- `host-observability`: report note text joins the structurally unloggable fields.

## Impact

- `src/host/launcher/`: new `release-config.ts`, `ai-consent.ts`, `consent-flow.ts`, `app-link.ts`, `link-routing.ts`, `service-refusal.ts`, `refusal-landing.ts`, `report-payload.ts`, `ConsentScreen.tsx`, `ServiceNotice.tsx`, `SheetModal.tsx`, `ReportSheet.tsx`, `AppLinkSheet.tsx`, `AppLinkMissingScreen.tsx`. Edits to `LauncherRoot.tsx`, `SettingsScreen.tsx`, `server-address.ts`, `generation-client.ts`, `transport-shared.ts`, `xhr-transport.ts`, `build-lifecycle.ts`, `ComposeStep.tsx`, `ClarifyStep.tsx`, `PlanStep.tsx`, `FailureScreen.tsx`, `DoneStep.tsx`, `HistoryScreen.tsx`, `HomeScreen.tsx`, `MiniAppView.tsx`, `Orb.tsx`, `orb-actions.ts`, `back-policy.ts`, `useMiniAppHost.ts`, `copy.ts`, and `test/acceptance.ts` plus new suites.
- `src/host/logging/redact.ts` and its suite: report note text becomes a redacted key.
- Wire: consumes `ServiceRefusalCode`, `ReportRequest`, `ReportResponse` from `@whim/contract` as landed by `public-generation-server` on `integration/store-launch` (type-only imports). No contract or server edits.
- No new dependencies. RN core `Linking` only; no clipboard module.
- Docs: `docs/store/review-notes.md` (new) and one appended entry in `docs/decisions.md`.
- Sequencing: applies onto `integration/store-launch` after `server-connectivity` and after `public-generation-server`'s contract work. External follow-ups this change specifies but does not do: the platform change (Associated Domains entitlement, Android App Links intent filter, AppDelegate link forwarding) and ops (AASA, assetlinks, privacy, support and link fallback pages on `whim.<domain>`).
