# Tasks: linked-apps-data-model

## 1. English test specs (§16.5 — before any implementation)

- [ ] 1.1 Spec the storage-group machinery tests in English: `engineAppId` resolves `storageGroupId ?? id`; fork with `shareData: true` copies the parent's group (founder's own id when parent ungrouped) and without it copies nothing; group membership immutable after creation; `storageRefCount` counts resolvers; remove deletes the file only at refcount zero (founder-first and sharer-first orders); ungrouped delete unchanged
- [ ] 1.2 Spec the fork-question tests in English: Fork tap opens the share-vs-fresh sheet; each answer threads to `StoreAccess.fork`; rewind-continuation seam never asks; all new strings pass the product-verbs guard
- [ ] 1.3 Spec the shared-storage acceptance tests in English: sharer reads founder's records across a close-then-reopen bind cycle; conflicting artifact (same burned ID, different type) aborts launch pre-delivery with a structured error and untouched data; divergent same-named fields under distinct IDs coexist; launch failure renders honest product copy

## 2. Storage groups machinery (index + StoreAccess)

- [ ] 2.1 Write the 1.1 tests red
- [ ] 2.2 Add `InstalledApp.storageGroupId?` and `AppIndex.storageRefCount(groupId)` (the `(a.storageGroupId ?? a.id)` idiom, design D1/D3)
- [ ] 2.3 Branch `StoreAccess.engineAppId`, add `fork(entry, {shareData?})`, gate `deleteStorage` in `remove` on the post-removal refcount (design D1–D3)
- [ ] 2.4 All 1.1 tests green; `npm run launcher:test` green

## 3. Fork question UI

- [ ] 3.1 Add the share-vs-fresh sheet ("Use the same saved data" / "Start fresh") with copy through `COPY`, wired between the Fork tap and `access.fork` (design D4)
- [ ] 3.2 The 1.2 tests green, including the product-verbs guard over all new strings

## 4. Shared-storage acceptance

- [ ] 4.1 Implement the sharer-reads-founder and close-then-reopen-same-file tests (design D7)
- [ ] 4.2 Implement the collision fail-closed test pair (conflicting artifact aborts pre-delivery; divergent-IDs coexist) reusing the existing `engine.open` guard path (design D5)
- [ ] 4.3 Surface the structured launch-failure as product copy in the launcher's existing launch-error surface; 1.3 tests green

## 5. Docs and closure

- [ ] 5.1 Append the decision-log entry superseding #43b D8 (storage groups, share defaults, refcounted delete, the #11 accumulated-union `appliedSchema` allocation contract, UUID escape hatch noted)
- [ ] 5.2 On-device acceptance (attended, human-run): fork with shared data → both apps read/write the same records → delete founder → sharer intact → delete sharer → file gone
