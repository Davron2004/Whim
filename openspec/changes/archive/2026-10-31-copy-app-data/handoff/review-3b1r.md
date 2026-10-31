# Review 3b1r (Opus high, shift 4b): ACCEPT with findings

Diff 20d7a0f9..f18d426b. Conforms to ruling 40 REVISED + tasks.md:67; no delete path; engine.ts citation correct; memo needs no
invalidation (version ids immutable, memo dropped on repo removal :804); nothing relied on the old Node existence check; device steps OK.
1. MED store-access.ts:557 + saved-data.suite.ts: group members untested; narrowing `members` to `[entry]` passes every test. Reachable:
   continueSharingData builds the member record from its fork version (pre-storage rewind) → member answers false → copy silently fresh.
   Expected: test where only the founder declares storage (by record; separately by a version newer than the branch point) → member true; red-check by narrowing.
2. MED store-access.ts:559-563 cost: unbounded, unmeasured. First Make-a-copy tap per process on a no-storage app calls getSnapshot on
   every version (every file, bundle.js included); `timeline` re-run per tap, not memoized; all inside serial(repo) (activeLaunch/activeEdit
   of a sharer waits). Same cost class as declaredSchemas (shared memo). Expected: device timing of first/second tap, 20+ versions, threshold set before merge.
3. LOW has-saved-data.md "Known limit" is reachable: History → pre-storage version → Make a copy → Copy the data; the copy's lineage never
   declared storage → false → a copy of that copy drops data a later change could revive (buildGenerateRequest reads the copied _meta).
4. LOW saved-data.ts:19,30: 'blank' vs 'empty' split only served the removed delete path. Merge or justify.
5. LOW saved-data-device-acceptance.ts:432-463: cleanup not in try/finally (Date.now() ids leak a file per failed run); `check && check` hides later failures.
6. LOW has-saved-data.md "What 3b2 does": add one line that a fixture must declare 'storage' in its record for the question to show. chain-3b1r.md 67 lines > 60 cap.
