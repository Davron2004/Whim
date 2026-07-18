# Tasks: version-history-ux

## 1. English test specs (§16.5 — before any implementation)

- [x] 1.1 Spec the `timeline` verb tests in English in the vstore suite area: descendants listed after rollback; other lineages excluded; cap respected; shape parity with `history`; empty/unborn repo; round-trip (rollback → timeline → roll-forward → timeline) stability
- [x] 1.2 Spec the `StoreAccess` wrapper tests in English: each wrapper ensures lineage first (fork entry lists its own line); fork with explicit version id; `activeId` reflects restores; prompt-envelope parse (valid v1, invalid JSON, wrong shape → raw fallback)
- [x] 1.3 Spec the history-UI acceptance tests in English: rows render envelope/raw prompts + timestamps; install row has no restore; tap restores previous version and undo returns; current marker moves; pin label appears and re-pin moves it; fork-from-version creates a new entry; data annotation on schema-adding row; restore reassurance when fields leave view; every new string passes the product-verbs guard

## 2. Version store: `timeline` verb (TDD)

- [x] 2.1 Write the 1.1 tests red against `VersionStore.timeline(appId, {limit?})`
- [x] 2.2 Implement `timeline` in `src/host/version-store/engine.ts` per design D2 (snap-tag enumeration filtered by `isSameLine` against the branch tip, newest-first, `historyLimit` cap) and export via `index.ts`; all 2.1 tests green, `npm run vstore:test` green

## 3. Launcher store surface: wrappers + prompt envelope

- [x] 3.1 Add `src/host/launcher/prompt-envelope.ts` (`parsePromptEnvelope` per design D4) with the 1.2 envelope tests
- [x] 3.2 Add `StoreAccess` wrappers `history`/`timeline`/`rollback`/`pin`/`listPins`/`diff`/`activeId` and the optional version-id parameter on `fork`, each under `ensureLineage` (design D6); verify engine re-pin behavior and normalize to move semantics if needed (design D8); 1.2 tests green, `npm run launcher:test` green

## 4. History screen UI

- [x] 4.1 Add the `{kind: 'history', app}` variant to `LauncherRoot`'s `Screen` union, the History row to `HomeScreen`'s long-press sheet, and all new strings to `copy.ts` (product-verbs guard green)
- [x] 4.2 Implement `HistoryScreen.tsx` per design D7: `FlatList` over `timeline()`, envelope-rendered prompt + timestamp rows, current marker from `activeId()`, install row without restore affordance, own `BackHandler`, `shellPalette` styling
- [x] 4.3 Implement instant restore-before-prompt with the undo toast (design D1/D3), refreshing the current marker after every restore/undo
- [x] 4.4 Implement the per-row overflow sheet: "Pin this version…" with label input, "Make this version its own app" through the existing fork→install flow
- [x] 4.5 Implement lazy memoized data annotations and the restore reassurance line (design D5)
- [x] 4.6 The 1.3 acceptance tests green; full `npm run launcher:test` green

## 5. Docs and closure

- [x] 5.1 Append the decision-log entry (restore-before-prompt semantics, timeline verb, prompt envelope contract for #7/#11) to `docs/decisions.md`
- [ ] 5.2 On-device acceptance (attended, human-run): seeded app → History → restore back and forward → pin → fork-from-old-version → annotations render; record latency observations against #39's numbers
