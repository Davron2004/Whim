# Exploration — the mini-app storage engine (seeds the v0.2 proposal)

*Captured 2026-06-10 from an explore-mode discussion. Status: **design position**, not yet a
change. This supersedes the spec §5.6 "schemaless JSON soup" sketch and is intended to be
folded into the v0.2 (capability bridge + storage syscall #1) proposal's `design.md` largely
verbatim. Canonical prior art: decision **#38** (additive-only schema, burned field IDs),
**#39** (version store, D2 isolation boundary), spec **§5.6** (syscall bridge), **§15.2**
(the v0.2 milestone).*

## The decision

Mini-app user data lives in **SQLite, one database file per mini-app** (likely
op-sqlite/JSI; device smoke required before commitment). Storage is **schema-declared, not
schemaless**: the agent declares collections + fields in `defineApp({ schema })`, and the SDK
exposes **product verbs, never SQL** — a deliberately small, structurally-safe fraction of
the engine's power.

This makes explicit what #38 already implied. "Schemaless JSON soup" was half-abandoned the
moment #38 introduced a declared schema artifact, stable field IDs, types-that-never-change,
and static checks on schema diffs. That is schema-declared storage with forgiving reads; this
exploration just gives it a real engine.

## Two disentanglings (the load-bearing reasoning)

**1. Schemaless (logical) vs JSON-blob (physical) were never the same claim.** The mess and
inefficiency of a JSON store come from *blob granularity* — read-modify-write of whole
documents, the entire ledger serialized across the string-only bridge twice per append — not
from JSON as a notation. The property the soup was actually protecting (regeneration and
rollback never lose data; unknown fields survive read-modify-write) does not need
schemalessness; it needs #38 rule 3 (unknown-field retention). Under a relational layout,
retention is **free and structural**: an `UPDATE` that sets only the columns this generation
knows about cannot strip columns it doesn't. That was the hardest engine obligation under
blobs; under columns it evaporates.

**2. Reversibility applies to schema evolution, not data mutations.** The "idempotent,
reversible fraction" of SQLite the SDK exposes splits in two:

- **DDL (across generations):** the agent never writes `ALTER TABLE`. It edits the declared
  schema; static checks enforce additive-only evolution (#38 rules 1–2); the **engine derives
  the DDL**, which under additive-only is just `ADD COLUMN` (O(1) in SQLite). Reversibility
  and idempotency here are #38 rule 4's territory — the closed catalog of invertible
  transforms + the engine's op log — system properties, not model promises.
- **DML (at runtime):** `append/update/remove` are *not* reversible in the migration sense —
  undo machinery is a separate product feature, and #38 already rejected coupling data
  time-travel to code rollback. What DML gets instead is **idempotent delivery at the
  bridge**: request IDs so a retried syscall cannot double-append. Transport-level, and worth
  having for every capability, not just storage.

## The stack

```
agent sees:   defineApp({ …, schema: {collections, fields} })
              + verbs: kv.get/set · records.append/list/update/remove
                    │
                    │  static checks: additive-only diff, burned IDs,
                    │  types never change (#38 rules 1–3)
                    ▼
host:         schema artifact (versioned by the snapshot store for free, #39 D6)
                    │ derive DDL: CREATE TABLE / ALTER TABLE ADD COLUMN only
                    │ compile verbs → parameterized SQL (host-authored;
                    │ the agent never writes a query string)
                    ▼
engine:       SQLite — ONE DATABASE FILE PER MINI-APP
              columns named by burned field ID; rename = alias metadata;
              ':memory:' DB for synthetic-run smoke tests
```

Side benefits the engine choice hands us:

- **Isolation:** one DB file per app is an even cleaner physical boundary than per-app MMKV
  instances. The dispatcher structure is unchanged from the isolation design: identity
  derived from the realm/channel, never from the message; each realm's dispatcher is
  constructed holding exactly one DB handle (the #39 D2 constructor-guard pattern).
- **Spike 3's ephemeral-test-storage requirement** ("smoke tests must never touch real user
  data") becomes nearly a one-liner: run synthetic-event smoke tests against a `:memory:`
  database.
- **Aggregation push-down exists as a future option** (the spending tracker's
  week/month/year buckets as a host-side `GROUP BY` instead of shipping the ledger over the
  bridge) — but it is *deferred*; v0.2 does in-app Layer-1 aggregation over `list` results
  until data sizes complain.

## Decision deltas (reversals on the record, per project discipline)

| Position | Status |
|---|---|
| "Storage is schemaless JSON soup" (spec §5.6) | **Revised** — schema-declared in `defineApp`, forgiving reads via defaults. #38 had already implied this. |
| "No SQL exposed" (spec §5.6) | **Unchanged** — agent sees verbs + structured filters; SQL exists only host-side, parameterized, host-authored. |
| #38 rules 1–4 (burned IDs, additive-only, retention, transform catalog) | **Unchanged, strengthened** — a relational layout makes rule 3 structural rather than an engine obligation to implement. |
| User-data engine | **New** — SQLite (likely op-sqlite) replaces the implied MMKV-KV for mini-app user data. MMKV stays as the version store's substrate, untouched (the #33 code/data split keeps these stores separate anyway). |
| v0.2 scope | **At risk of ballooning** — mitigated below. |

## v0.2 scope boundary

**Ships in v0.2** (keeps the milestone about the bridge machinery, per §15.2):

- The verb set, lean: `kv.get/set` for scalars + `records.append / list / update / remove`
  with `{where, since, limit}` — and nothing else.
- Schema declaration in `defineApp` + the additive-only static checks (#38 rules 1–3).
- Derived DDL limited to `CREATE TABLE` / `ADD COLUMN`.
- Bridge-level request-ID idempotency.
- One DB file per app; `:memory:` for test runs.

**Explicitly deferred (not v0.2):**

- The invertible transform catalog (#38 rule 4) — lands when the first real unit-change need
  appears, exactly as #38 phased it.
- Aggregation push-down (`GROUP BY`-shaped verbs).
- Sharing between apps — arrives later as a *new* syscall with its own capability + consent,
  never as a widening of `storage`.
- **Physical column deletion.** A way to actually `DROP` columns that are no longer needed
  will be wanted eventually — retired/tombstoned fields otherwise accumulate forever — but it
  is **not in v0.2**. Note the tension to resolve when it lands: #38's tombstone rule retains
  data precisely so rollback can resurrect old code that reads it. A safe physical drop
  therefore needs conditions (e.g., no generation within the retained/rollback-reachable
  history references the field ID, or an explicit user-consented purge), plus its place in
  the op log. Design it then; just don't design it *out* now — nothing in the additive-only
  machinery should make a future audited drop impossible.

## Open questions to settle before the proposal

1. **Schema artifact type set** — a small closed list (`text / number / bool / date`), plus
   possibly one `json` escape-hatch column type for genuinely amorphous bits?
2. **Soft-delete** — engine default or per-app product choice?
3. **op-sqlite under RN 0.85 / new arch / Hermes** — half-day device smoke before the
   proposal commits to it. Lower risk than isomorphic-git-under-Hermes was (mainstream JSI
   module), so acceptance-level rather than spike-level — but the D7 pattern says prove it on
   the device regardless.
4. **Schema artifact format** — exact shape of `{collections, fields: {id, name, type,
   default, since}}`, and where aliases/tombstones live.
5. **`where` filter expressiveness** — the line between "useful filter" and "reinventing a
   query language"; start with equality + range on indexed fields?
