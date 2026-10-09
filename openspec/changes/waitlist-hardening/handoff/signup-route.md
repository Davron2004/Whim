# handoff: signup-route (chain-4 → chain-5, chain-7, rollout §8)

Route: `server/src/routes/beta-signup.ts` (`POST /beta/signup`, root app, outside `/v1`).
Operator command: `server/src/waitlist/cli.ts` (`node server/waitlist.mjs …` dev,
`node server/whim-waitlist.mjs …` in the image). Store rules: `handoff/waitlist-store.md`.

## Form fields (what `deploy/site/beta.html` must post)

| field | rule |
|---|---|
| `email` | trimmed; the validator is unchanged (spec "Signup route": ≤ 254 UTF-8 bytes, one `@` not first, local part chars, no `= + - @ \| %` lead, ≥ 2 dotted labels) |
| `platform` | `ios` \| `android` \| `other` |
| `updates_opt_in` | absent (no news consent) or exactly `1` (consent under the route's notice id); any other value → `invalid` |
| `updates_opt_out` | **ignored** (a stale page's box grants nothing and refuses nothing) |
| `hp_ref` (`TRAP_FIELD`) | must be empty or absent |

The box must be an unticked checkbox `name="updates_opt_in" value="1"`. Until chain-5 lands, the live
page still posts `updates_opt_out`, which the route ignores: every signup stores no consent (safe side).

## Check order and outcomes

Every answer is `303`; `thanks` = `${config.webOrigin}/beta/thanks`, `retry` = `${config.webOrigin}/beta/retry`.

| # | check | outcome (log) | redirect | stores |
|---|---|---|---|---|
| 1 | body over `WHIM_MAX_BODY_BYTES_BETA` | `limited` | retry | nothing |
| 2 | `Origin` header present and `!== config.webOrigin` (exact string; `null`, a prefix match, http vs https all refused) | `origin` | retry | nothing |
| 3 | content type not `application/x-www-form-urlencoded…` | `invalid` | retry | nothing |
| 4 | `hp_ref` non-empty | `trap` | thanks | nothing |
| 5 | form invalid (table above) | `invalid` | retry | nothing |
| 6 | limiter refuses (`x-forwarded-for`) | `limited` | retry | nothing |
| 7 | `store.upsert` → `stored` / `updated` | same | thanks | the row |
| 7 | `store.upsert` → `suppressed` (kept fingerprint) | `suppressed` | thanks | nothing |
| 7 | `store.upsert` throws/rejects | `error` | retry | nothing |

- No `Origin` header → continues to 3 (curl, older clients). The Origin check runs before the trap,
  so a cross-site trap post answers **retry** (the rollout smoke uses this; it stores nothing).
- `SignupOutcome = 'stored' | 'updated' | 'suppressed' | 'invalid' | 'origin' | 'limited' | 'trap' | 'error'`.
- The route passes `{ email, platform, updatesOptIn: form.updatesOptIn, noticeId: deps.noticeId, now }`;
  `deps.noticeId` is `CURRENT_NOTICE_ID` (app.ts). Sticky withdrawal is the store's
  `consentAfterSignup`; the route never calls `setUpdates`/`restore`.

## Log lines

`scope: 'beta-signup'`, msg `'beta signup'`, one per request, fields `outcome` + `requestId` only.
The `error` line (level error) adds `errorClass` = thrown `constructor.name` (or `typeof`) — never
the message. The body-cap line has `scope` + `outcome: 'limited'` (request id from the child logger).
Never the email, platform, client address, or `Origin` value.

## Operator command

| command | stdout | stderr | exit |
|---|---|---|---|
| `export [--platform ios\|android\|other] [--updates-ok]` | CSV (below) | — | 0 |
| `remove <email>` (row existed) | `removed <e>; its fingerprint is kept, so it cannot sign up again` | — | 0 |
| `remove <email>` (no row) | `<e> was not on the list; its fingerprint is kept, so it cannot sign up again` | — | 0 |
| `updates <email> on\|off` (row exists) | `news consent on\|off for <e>` | — | 0 |
| `updates <email> on\|off` (no row) | — | `waitlist: <e> is not on the list` | 1 |
| `restore <email>` (fingerprint kept) | `restored <e>: it can sign up again` | — | 0 |
| `restore <email>` (none kept) | — | `waitlist: <e> has no removal fingerprint` | 1 |
| bad arguments / unknown command | — | `waitlist: <problem>` + usage | 2 |
| config refused (`ServerConfigError`, e.g. `WHIM_STORE_BACKEND=firestore` without `WHIM_WAITLIST_FINGERPRINT_KEY`) | — | `waitlist: <message naming the variable>` (never the value, no stack) | 1 |

`<e>` = the argument trimmed and lowercased. `remove` always keeps the fingerprint (stamped `now`).
`updates on` = `consentAfterOperator(…, true, now)` → consent now under `written-request`, withdrawal
cleared; `off` withdraws. `updated_at` is untouched by `updates`. Signature:
`runWaitlistCli(argv, store, now: () => number = Date.now): Promise<WaitlistCliResult>`;
`waitlistMain(argv, env)` loads config and opens stores around it.

Usage text (`WAITLIST_USAGE`):
```
usage: waitlist export [--platform ios|android|other] [--updates-ok]
       waitlist remove <email>
       waitlist updates <email> on|off
       waitlist restore <email>
```

## CSV export

Header `email,platform,updates_opt_in,updates_consent_at,notice_id,created_at,updated_at`
(`CSV_COLUMNS`), rows oldest signup first.
- `updates_opt_in`: `true` | `false` (news may be sent now). `--updates-ok` = exactly the `true` rows.
- `updates_consent_at`: ISO time of the latest consent, or empty when none. **A withdrawn row keeps
  its old consent time here with `updates_opt_in=false`** (the consent record); never send news on
  this column — filter on `updates_opt_in` / `--updates-ok`.
- `notice_id`: the row's signup notice id (not the consent notice id).
- `created_at`, `updated_at`: ISO.
- Formula guard (#111): a cell starting with `=`, `+`, `-`, `@`, `|`, `%`, a tab or a CR is written
  with a leading `'`, then CSV-quoted if it holds `"`, `,`, CR or LF (`""` escapes a quote).

Breaking for operators: the third column was `updates_opt_out` (inverted); docs/deploy.md must say so.
