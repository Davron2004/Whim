## Why

The launcher's "make your first app" tile already exists (`HomeScreen.tsx`) with a comment naming this change as its destination, but today it just pops a placeholder alert — there is no way to actually get a prompt to the (already-built, #8) generation server. Whim's core pitch — "describe an app out loud and get one" — has no working path end to end. Decision #52 additionally left a concrete, unfulfilled obligation on this change: the "rewind + new prompt" continuation flow must silently share storage with the app it continues from (`linked-apps` spec, "Rewind continuations share by default," explicitly "wired by prompt-flow"), and decision #48 left the prompt envelope's writer unimplemented ("#7/#11 MUST write this envelope"). Now that #6 (history) and #8 (server skeleton) are both built, this is the next unblocked step toward a working v1 loop.

## What Changes

- **Prompt screen**: a text input (multiline, autofocus) with an OS-dictation hint (no in-app STT — the platform keyboard's mic button is the dictation surface). Reachable from the home "make your first app" tile (replacing the placeholder alert) and from a new "Prompt again" row in the per-app long-press action sheet (the edit flow).
- **Two-stage flow**: submitting a prompt calls `POST /v1/rewrite` (already built, canned today) and shows a **rewrite-preview screen** — the rewritten text, editable, approve/back — before anything is generated. SDK/engineering internals never surface here; the user reviews intent in their own words.
- **SSE progress UI**: approving calls `POST /v1/generate` and streams `GenerationEvent`s over a POST+fetch body (not `EventSource`), rendering stage transitions (`plan`/`generate`/`check`/`run`/`repair`) as a staged progress screen. Raw `token` text (generated source) and raw diagnostic `kind`/`symbol` are never rendered to the user — only `diagnostic.hint` strings, and only on the failure path.
- **Honest failure screen**: on the `failure` terminal event (or a client-side stream error), show the reason plus hint-only "what I tried," with "rephrase" (back to the prompt screen, text preserved) and dismiss actions. No confirmation-dialog friction anywhere in the flow, matching the rest of the launcher's instant-action ethos.
- **Delivery**: on the `result` terminal event, the generated `WireAppRecord` is installed (brand-new app), applied in place (editing an app that is at the tip of its own history), or landed on a **new, silently storage-shared** launcher entry (editing an app that has been rewound to a past version — decision #52 D2, no question asked). Every delivered generation's prompt is tracked as the `{v:1,text}` envelope (decision #48 D4) — its first real writer.
- **Device identity**: a persisted, anonymous device UUID (generated on first use, no new dependency — Hermes has no `crypto.getRandomValues` and none is installed) is attached as `x-whim-device` on every request.
- **Server address**: a manually-entered LAN server address, persisted like the existing theme preference, added to the Settings screen (the server is LAN-dev-only in v1; no discovery mechanism exists or is being built here).
- **`StoreAccess` grows**: an `update()` wrapper (snapshot onto an existing entry's own lineage — the edit-in-place path) and the `schema.json` artifact write (both `install` and `update`) that closes the dormant #6 data-annotation gap.

**Out of scope** (owned by #11 `generation-loop` or already settled elsewhere): the real rewrite/engineer models, planning/static-check/synthetic-run/repair logic, any change to the server's routes or wire schemas, the History screen and rollback UX (#6, built), the explicit-Fork share/fresh question sheet (already built), an in-app floating "start prompting" menu (not built anywhere today — `FloatingExit` is a single-tap exit; reopening that is a separate, unrelated design question), control-modes selector, examples-library UI, and any built-in speech-to-text.

## Capabilities

### New Capabilities
- `prompt-flow`: the two-stage prompt UX (prompt screen → rewrite preview → approve), the SSE client and staged progress/failure UI against the existing stub server contract, delivery semantics (install / edit-in-place / silent-fork-continuation), the prompt-envelope write, and device identity.

### Modified Capabilities
- `app-launcher`: the home create tile and a new per-app "Prompt again" action route into the prompt flow instead of a placeholder; `StoreAccess` grows `update`/tip-detection; the Settings screen gains a persisted server-address field.

## Impact

- **Launcher** (`src/host/launcher/`): new `PromptScreen.tsx`, `RewritePreviewScreen.tsx`, `GeneratingScreen.tsx`, `FailureScreen.tsx`; new `generation-client.ts` (SSE fetch client) and `device-id.ts`; `store-access.ts` gains `update()`; `history-logic.ts` gains an `isAtTip()` helper; `LauncherRoot.tsx` `Screen` union + orchestration; `HomeScreen.tsx` wiring; `SettingsScreen.tsx` server-address field; `copy.ts` additions (product-verbs guard applies); `npm run launcher:test` coverage for all of the above.
- **Server / contract**: untouched — this change is a pure client against the existing `@whim/contract` + `@whim/server` stub (#8). `npm run server:test` is unaffected.
- **Version store / storage engine**: untouched at the API level — consumed via existing/new `StoreAccess` wrappers only, per the #43b "never touch raw `VersionStore`" contract.
- **Runtime/sandbox/CSP/bridge**: untouched — no runtime surface in this change.
- **Docs**: `docs/v1-roadmap.md` ledger update (#7 → proposed) and a decision-log entry recording the delivery/continuation semantics as-built, at implementation time.
