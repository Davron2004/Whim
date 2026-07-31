## 1. English test specs (§16.5 — before any implementation)

- [ ] 1.1 Spec `device-id.ts`/`generation-client.ts` tests in English: device id is generated once and persists across reads; `rewritePrompt` success and HTTP/device-id-error paths; `generateApp` parses stage/token/diagnostic/usage/result/failure frames off an injected `Response`; a malformed frame raises `GenerationClientError{kind:'stream_parse'}`; an aborted stream yields no terminal event and does not throw
- [x] 1.2 Spec `StoreAccess.update`/`history-logic.isAtTip`/extended `install` tests in English: `update` snapshots onto the same lineage and updates the index record without changing id/lineage/createdAt; `install`/`update` write `schema.json` only when supplied; `isAtTip` is true immediately after install and after every fresh update, false after a rollback to a non-tip snapshot, and uses the same fork-safe `history()`/`timeline()` split as `listVersions`
- [ ] 1.3 Spec the prompt-flow UI acceptance tests in English: create tile opens the prompt screen with no app being edited; the per-app "Prompt again" action opens it scoped to that app; approve-order is enforced (no generate request before rewrite-preview approval); stage transitions render without ever exposing `token` text or `diagnostic.kind`/`symbol`; a `failure` event or a stream error both land on the failure screen showing `reason` + hint-only diagnostics, and "rephrase" returns to the prompt screen with text preserved; delivery routes correctly for new/at-tip/behind-tip (the behind-tip case forks with `shareData:true` and asks no question); every delivered generation's tracked prompt parses as the `{v:1,text}` envelope; cancelling before a terminal event aborts the request and installs/updates nothing; every request carries the persisted `x-whim-device` header; an unconfigured server address shows the honest Settings message instead of attempting a request; every new string passes the product-verbs guard

## 2. Device identity + generation client (TDD)

- [ ] 2.1 Write the 1.1 tests red against `src/host/launcher/device-id.ts` and `src/host/launcher/generation-client.ts`
- [ ] 2.2 Implement `device-id.ts` (`getDeviceId`) per design D2
- [ ] 2.3 Implement `generation-client.ts` (`rewritePrompt`, `generateApp`, `GenerationClientError`) per design D2 — SSE frame parsing off `Response.body`, validated against `GenerationEvent` (`@whim/contract`); all 2.1 tests green, `npm run launcher:test` green

## 3. StoreAccess: update, isAtTip, schema.json

- [x] 3.1 Write the 1.2 tests red against `StoreAccess.update`, the extended `InstallSpec`, and `history-logic.isAtTip`
- [x] 3.2 Implement `StoreAccess.update` + `activeSource`, and extend `InstallSpec`/`install` to accept and write an optional `schemaJson` artifact (design D7)
- [x] 3.3 Implement `isAtTip` in `history-logic.ts` reusing `listVersions`'s existing fork/original split (design D6); all 3.1 tests green, `npm run launcher:test` green

## 4. Prompt + rewrite-preview screens

- [ ] 4.1 Add the prompt/rewrite-preview `COPY` strings (product-verbs guard applies)
- [ ] 4.2 Implement `PromptScreen.tsx`: multiline autofocus input, dictation hint copy, unconfigured-server honesty message, own `BackHandler`/`shellPalette` (design D1, app-launcher "create affordance and re-prompt" + "server address" requirements)
- [ ] 4.3 Implement `RewritePreviewScreen.tsx`: original prompt shown small/muted, rewritten text editable, approve/back (design D4)

## 5. Generating + failure screens

- [ ] 5.1 Add the progress/failure `COPY` strings
- [ ] 5.2 Implement `GeneratingScreen.tsx`: stage-only presentational props, cancel action, never accepts token/diagnostic props (design D1, prompt-flow "progress without exposing internals" requirement)
- [ ] 5.3 Implement `FailureScreen.tsx`: reason + hint-only diagnostics list, rephrase/dismiss actions (design D1, prompt-flow "failure shown honestly" requirement)

## 6. LauncherRoot wiring + delivery orchestration

- [ ] 6.1 Extend `LauncherRoot`'s `Screen` union with `prompt`/`rewrite-preview`/`generating`/`failure` variants (design D1)
- [ ] 6.2 Wire `HomeScreen`'s create tile (replacing the placeholder alert) and add the "Prompt again" action-sheet row
- [ ] 6.3 Implement the orchestration handlers in `LauncherRoot.tsx`: submit → `rewritePrompt` → preview; approve → `generateApp` loop driving the `stage` field and collecting the terminal event; on `result`, route delivery via `isAtTip` (install / update / fork-then-update per design D5), writing the `{v:1,text}` prompt envelope; on `failure` or a stream error, transition to the failure screen
- [ ] 6.4 Implement cancel-on-navigate-away (`AbortController` wired to the generating screen's back/cancel action; verify nothing is installed/updated on cancel)
- [ ] 6.5 Add the Settings screen's server-address field, persisted like the theme pref, sanitized the same tolerant way (design D3)
- [ ] 6.6 The 1.3 acceptance tests green; full `npm run launcher:test` green

## 7. Docs and closure

- [ ] 7.1 Append the decision-log entry (delivery/continuation routing as-built, device-id and server-address approach, the compiled-bundle-as-`source` limitation noted for #11) to `docs/decisions.md`; update `docs/v1-roadmap.md`'s #7 status block
- [ ] 7.2 On-device acceptance (attended, human-run): configure a server address, prompt a new app end to end, re-prompt it at tip, restore an old version via History then re-prompt (verify a new silently-shared tile appears with no question asked), trigger the `[[fail]]` failure path, and confirm the device id persists across an app restart
