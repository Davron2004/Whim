# Contract: consent-surface (chain-1)

Interface only. Source: `contract/src/disclosure-manifest.ts`, `scripts/release/lib/disclosure-check.ts`,
`server/src/consent-practices.ts`. Design D6; spec ai-data-consent.

## Types (verbatim)

```ts
// contract/src/disclosure-manifest.ts
export type CategorySurface = 'app' | 'website';

export interface DisclosureCategory<C extends string = string> {
  readonly id: C;
  /** Required, with no default: every category says which side collects it. */
  readonly surface: CategorySurface;
  // ...rows, excludes, keep, consent, toggle, onScreen, savedData, store (unchanged)
}
```

Live surfaces: every category of versions 1 and 2 is `app`, except `waitlist` (version 2 only),
which is `website`. A category literal without `surface` does not typecheck.

## The waitlist category's description (verbatim, `MANIFESTS[2]`, row name `Beta waitlist`)

```
The email address, phone type, news consent and its record given on Whim’s website to join the beta, the sign-up wording seen, and the fingerprint of an address removed from the list
```

(The apostrophe in `Whim’s` is U+2019.) The waitlist's `keep` (730 days after collection),
`consent: 'user-act'`, uses and roles are unchanged. The `beta` purpose description is unchanged
and still reads "Invite people to test Whim and, unless they opt out, email them about Whim".

## Release-check finding (verbatim template, `disclosureReleaseFindings`)

```
version ${N}'s category ${id} changed surface since release: contract/disclosure/released/v${N}.json has ${was}, the manifest has ${now}
```

Emitted once per category present in both a released version's snapshot and its live manifest
whose surface differs, in either direction. Reached by the gate suite, the release preflight and
`deploy/deploy.sh` through `checkDisclosureRelease`. A category absent from the snapshot is not
compared (it is the widening diff's business).

## Snapshot reader

`loadReleasedSnapshots(repoRoot)` returns manifests whose every category has a `surface`: a
snapshot category without one reads as `app`. Frozen snapshots (`contract/disclosure/released/*.json`)
are not edited and carry no `surface`.

## Server practices

`practicesFrom(manifests)` (and so `PRACTICES` / `permits`) keeps only `surface === 'app'`
categories. Live result: no consent version permits `waitlist`; version 2 permits
`request-material, phone-id, app-integrity, usage-records, error-details, connection-logs, reports`.

## Route static check (server/test/request-edge.suite.ts)

A route file under `server/src/routes/` whose comment-stripped code calls
`consentPractice('<id>', …)` with a category that any manifest lists as `website` fails, reported
as `<file>: <id>` (e.g. `signups.ts: waitlist`).

## Invariants

- `AI_CONSENT_VERSION` stays 2; the waitlist change does not widen released version 2.
- Website data is never a `/v1` practice; `/beta/signup` declares no `consentPractice`.
