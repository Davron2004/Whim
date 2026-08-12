# Contract — the `containment_unobserved` diagnostic kind (chain-1)

Read this before emitting or asserting the kind. Everything a producer needs is here; do not
re-derive it from `checks/contract.ts`.

## The kind

| field | value |
| --- | --- |
| kind string | `containment_unobserved` (exact, lowercase, single underscore-separated) |
| severity | `error` — never `warning` |
| meaning | no authenticated containment verdict was observed; neither containment nor a breach was established |
| declared in | `checks/contract.ts` → `DIAGNOSTIC_KINDS` (runtime-observed block, immediately after `containment_failure`) |
| also rostered in | `synthrun/observe.ts` → `RUNTIME_OBSERVED_KINDS` (so `RuntimeObservedKind` admits it) |

`DiagnosticKind = (typeof DIAGNOSTIC_KINDS)[number]` — the union already contains the member; no
consumer needs a cast. The shared server contract package re-exports the union unchanged
(`contract/src/index.ts`: `export type { DiagnosticKind } from '../../checks/contract';`) and its
wire `Diagnostic.kind` is an open `z.string()`, so `containment_unobserved` narrows the wire kind
with no schema change and validates on the wire as-is.

## The hint (mandatory, non-empty — harness-diagnostics req 1)

`synthrun/observe.ts`'s `genericHint('containment_unobserved')` returns, verbatim:

```
no authenticated containment verdict was observed — this run proves nothing about containment; re-run it and treat the candidate as unverified, not as escaped
```

A producer that builds the diagnostic inside `synthrun/observe.ts` MUST get the hint from
`genericHint(kind)` rather than inline a second copy. A producer outside that module MUST carry a
hint with the same meaning: *the run was never verified*. The hint SHALL NOT say or imply the app
escaped, breached, or was contained — none of that was established.

## Shape

Structurally identical to every other runtime-observed diagnostic (`ObservedDiagnostic` in
`synthrun/observe.ts`):

```ts
{
  kind: 'containment_unobserved',
  severity: 'error',
  message: string,   // what the harness did/didn't see
  hint: string,      // the text above; non-empty
  line?: number,     // omitted — an unobserved verdict has no original-source anchor
}
```

## The no-substitution rule (normative)

`containment_unobserved`, `containment_failure` and `mount_timeout` are **three distinct kinds**.

- `containment_failure` — an authenticated `probes` verdict that reported a breach
  (`payload.contained === false`). Evidence of a breach.
- `containment_unobserved` — no authenticated verdict was ever observed (never arrived, malformed
  `payload.contained`, suppressed frame, or a failure after a successful paint). Absence of
  evidence, in either direction.
- `mount_timeout` — no nonce-authenticated `paint` frame within the mount budget. Names the
  never-painted cause **only**; it is not evidence about containment.

No producer SHALL emit one of the three in place of another. Concretely:

1. An unobserved verdict SHALL NOT be reported as `mount_timeout`. A verdict can go unobserved
   with no mount timeout at all (the candidate painted, then the verdict never came).
2. A mount timeout SHALL NOT be reported as `containment_unobserved` when the mount budget fired —
   emit `mount_timeout` for the never-painted cause on its own terms.
3. An unobserved verdict SHALL NOT be reported as `containment_failure`. Never heard back ≠ heard
   "breached".
4. Conversely, an authenticated breach verdict SHALL NOT be softened to `containment_unobserved`.

Both a `mount_timeout` and a `containment_unobserved` may legitimately appear on the same report
when both conditions hold independently; that is two diagnostics, never one kind standing in for
the other.

## Extending further

Any later kind is added the same way: append to `DIAGNOSTIC_KINDS` in `checks/contract.ts`
(with its one-line meaning in the module roster doc-comment), add it to `RUNTIME_OBSERVED_KINDS`
plus a `genericHint` case if a live run produces it, and extend the `expected` roster in
`checks/test/acceptance.ts`. Never mint a kind string at its producer.

## Test surface already in place (chain-1)

`checks/test/acceptance.ts` (`npm run checks:test`, fast gate) asserts:

- the closed union matches its expected roster exactly (length + membership + no duplicates),
  now including `containment_unobserved`;
- `containment_unobserved`, `containment_failure` and `mount_timeout` are three distinct members;
- every member of `synthrun`'s `RUNTIME_OBSERVED_KINDS` is declared in `DIAGNOSTIC_KINDS` — i.e.
  the producer mints nothing of its own.

Emission-site behaviour (when the kind is produced, and that it comes with no `mount_timeout`
after a successful paint) is chain-3's, not covered here.
