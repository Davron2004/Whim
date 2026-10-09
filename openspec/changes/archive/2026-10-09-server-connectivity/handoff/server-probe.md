# Contract: server-probe (chain-2 → chain-3, chain-4)

Interface only; rationale is `design.md` decisions 1-2.

## `src/host/launcher/server-probe.ts`

```ts
export type ProbeResult = 'verified' | 'unverified' | 'unreachable';

export interface ProbeServerOptions {
  /** Milliseconds to wait before aborting the request. Default 4000. */
  timeoutMs?: number;
  /** Injectable `fetch`, defaulting to the global — same pattern as `generation-client.ts`'s
   *  `ClientOptions.fetchImpl`, so callers/suites can supply canned responses. */
  fetchImpl?: typeof fetch;
}

export function probeServer(baseUrl: string, opts?: ProbeServerOptions): Promise<ProbeResult>;
```

No React Native import anywhere in this module — Node-suite testable in isolation.

## Behavior

- Issues `GET ${baseUrl}/healthz` with no headers/body, aborted via `AbortController` +
  `setTimeout` at `opts?.timeoutMs ?? 4000`.
- **Never rejects.** Every failure path (non-200, thrown network error, or the timeout firing)
  resolves to `'unreachable'` — callers never need a try/catch around this call.

## Classification rules (design.md decision 1)

| condition | result |
| --- | --- |
| response status `!== 200` (non-200), a thrown/network error, or the request timed out | `'unreachable'` |
| status `200`, body parses as JSON, and the parsed body's `service` field `=== 'whim-server'` | `'verified'` |
| status `200`, and any other case (parses but wrong/missing `service`, or fails to parse as JSON) | `'unverified'` |

The `'verified'` check is against the `generation-server` healthz identity stamp
(`{ ok: true, service: 'whim-server' }`, chain-1's `server/src/app.ts` change) — only the
`service` field is checked, not `ok`.

## Callers (both count the same 200 either classification as "reachable" for retry purposes —
that distinction is chain-3/chain-4's to make, not this module's)

- Settings save-time verification (chain-4): calls `probeServer` directly, debounced, renders the
  three-way result inline. Does not route through shell state.
- Startup/retry loop (chain-3): calls `probeServer` on a timer; `'verified'` and `'unverified'`
  both count as a successful probe (retry-loop success), `'unreachable'` schedules the next
  backoff attempt.

## Error surface

None — see "Never rejects" above. `baseUrl` is passed through unvalidated (already sanitized by
`server-address.ts`'s `loadServerUrl`/`saveServerUrl` before it reaches this module).
