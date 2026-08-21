# Contract: wire shapes (chain-1)

Source: `contract/src/index.ts`. All three shapes below are live on the branch tip; later chains
import them from `@whim/contract` — never re-declare them.

## 1. `GenerateRequest.app.source` is now OPTIONAL

```ts
export const GenerateRequest = z.object({
  prompt: z.string(),
  app: z
    .object({
      source: z.string().optional(),
      manifest: ManifestShape,   // required
      schema: SchemaShape,       // required
      appliedSchema: SchemaShape.optional(),
    })
    .optional(),
});
```

- Absence of `app.source` means exactly "the device has no original TypeScript for this app" —
  a pre-existing install whose snapshots predate source tracking (#52-D5 / design D14). It is
  NOT license to treat compiled bundle output as source.
- A conforming server (chain 2) MUST regenerate under the supplied `manifest`/`appliedSchema`
  when `source` is absent, never by substituting `bundle`/IIFE text as "current code."
- `manifest` and `schema` remain required within `app`; only `source` and `appliedSchema` are
  optional.

## 2. `GenerateRequest.app.appliedSchema` (new field)

- Optional record, same shape as `app.schema` (`z.record(z.string(), z.unknown())`).
- Carries the storage group's **accumulated** applied-schema union — the database's `_meta`
  monotone union (#38/#40) — NOT the app's own declared `schema` artifact. The two fields can
  legitimately differ and are validated independently.
- It is the diff baseline the harness's schema checks run against and the source of the
  burned-field-ID allocation floor.
- Absent `appliedSchema` means: treat the baseline as the empty applied schema (no prior fields
  burned).

## 3. `ApiError` (new export)

```ts
export const ApiError = z.object({
  error: z.string(),
  hint: z.string().min(1),
});
export type ApiError = z.infer<typeof ApiError>;
```

- The shape every non-SSE `4xx`/`5xx` JSON body a conforming `/v1/*` route returns MUST validate
  against. No route may invent an ad-hoc error shape (chain 7 converts existing routes to this).
- `hint` is mandatory non-empty guidance — same discipline as `Diagnostic.hint`.
- `error` is an open string here (machine-readable identifier); narrower routes should use a
  closed-enum specialization the way `DeviceIdError` does.

### `DeviceIdError` relationship (unchanged shape, now documented as a specialization)

```ts
export const DeviceIdError = z.object({
  error: z.enum(['missing_device_id', 'invalid_device_id']),
  hint: z.string().min(1),
});
```

- `DeviceIdError` is a closed-enum specialization of `ApiError`: every `DeviceIdError` value
  validates as `ApiError`, but `ApiError.safeParse` is broader (any non-empty `error` string).
- `DeviceIdError` itself is unchanged — still rejects any `error` value outside its two-member
  enum. Do not widen it to accept arbitrary `ApiError` values.

## Unchanged, confirmed by this chain's test additions

- `GenerationEvent.stage` stays closed at `plan | generate | check | run | repair` — no
  `rewrite` member (design D5). `/v1/rewrite` remains a unary, non-streamed endpoint outside the
  `GenerationEvent` union; its failure mode is a `502` `ApiError` body (chain 2/7 wiring), not a
  stream event.
- `GenerationEvent`'s closed discriminated union still rejects an unrecognized `type`.

## Tests added (`server/test/contract.suite.ts`)

- `GenerateRequest` parses with `app.source` present and with it absent (manifest+schema only).
- `app.appliedSchema` round-trips and is independently optional from `app.source`.
- `ApiError` accepts a `DeviceIdError`-shaped value; rejects empty/missing `hint`.
- `DeviceIdError` still rejects an `ApiError`-only (non-enum) `error` value.
- `GenerationEvent` rejects a `stage: 'rewrite'` value.
