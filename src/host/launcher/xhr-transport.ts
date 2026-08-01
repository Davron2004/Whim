/**
 * xhr-transport — the `XMLHttpRequest`-backed `ResponseBodyReader` producer for
 * `POST /v1/generate`, for runtimes whose `fetch` cannot stream a response body (RN 0.85's
 * `whatwg-fetch` polyfill; spec "generation-stream-transport", §"The device consumes the
 * generation stream incrementally"). RN's own `XMLHttpRequest` streams progressively:
 * `XMLHttpRequest.js:370`'s `__didReceiveIncrementalData` fires repeated `LOADING` readyState
 * events with growing `responseText`, and incremental delivery is enabled once
 * `onreadystatechange` or `onprogress` is set (`XMLHttpRequest.js:557`).
 *
 * `openXhrGenerateStream` is a drop-in alternative to `generation-client.ts`'s private
 * `openGenerateStream`: same parameter shape (minus the injectable `createXhr`), the same
 * `Promise<ResponseBodyReader | 'aborted'>` return type, and the same thrown-error contract.
 * Wiring it behind a capability probe is chain-3's job (`design.md` D1/D2) — this module only
 * produces the reader.
 *
 * Design D3: RN's XHR exposes progressively-growing DECODED TEXT (`responseText`), while
 * `ResponseBodyReader.read()` yields bytes. This transport tracks a character offset into
 * `responseText` and slices the new suffix on each delivery, `TextEncoder.encode()`-ing it —
 * accumulation on the decoded string heals any multi-byte UTF-8 character RN's native layer
 * splits across two incremental deliveries. `generateApp`'s byte-buffering loop
 * (`generation-client.ts`) is untouched.
 */

import type { GenerateRequest } from '@whim/contract';
import { GenerationClientError, httpErrorFrom, requestHeaders, type ClientOptions } from './transport-shared';

/** One queued outcome for the reader's pull-based `read()`, produced by XHR's push-based
 *  events. Delivered strictly in arrival order and never dropped, even if several XHR events
 *  fire before a `read()` call drains the previous one. */
type QueuedOutcome =
  | { kind: 'value'; value: { done: boolean; value?: Uint8Array } }
  | { kind: 'error'; error: unknown };

/** Named `AbortError`, matching `generation-client.ts`'s `isAbortError` / `readNext`, which
 *  maps it to the `'aborted'` sentinel rather than a thrown `GenerationClientError`. */
function abortError(): Error {
  const err = new Error('The generate request was aborted');
  err.name = 'AbortError';
  return err;
}

/**
 * Open `POST /v1/generate` over `XMLHttpRequest` and resolve a `ResponseBodyReader` once the
 * response status is known to be 2xx, or `'aborted'` if `signal` fired before that point.
 *
 * A non-2xx response rejects with the `httpErrorFrom`-classified `GenerationClientError`
 * (`device_id` or `http`) once the full error body has arrived. A transport-level failure
 * (`onerror`/`ontimeout`) before the reader is handed back rejects with `kind: 'network'`.
 *
 * A failure or abort that lands AFTER the reader has already been handed back instead
 * surfaces through that reader's next `read()` call: an `AbortError`-named `Error` for abort
 * (mapped to the `'aborted'` sentinel by `generation-client.ts`'s existing `readNext`), or any
 * other `Error` for a transport failure (`readNext` wraps it into
 * `GenerationClientError{kind:'network'}` unchanged — no re-classification needed here).
 *
 * `createXhr` defaults to the global `XMLHttpRequest` constructor and exists solely so tests
 * can supply a fake without mutating global state.
 */
export async function openXhrGenerateStream(
  opts: ClientOptions,
  request: GenerateRequest,
  signal: AbortSignal | undefined,
  createXhr: () => XMLHttpRequest = () => new XMLHttpRequest(),
): Promise<ResponseBodyReader | 'aborted'> {
  if (signal?.aborted) {
    return 'aborted';
  }

  return new Promise<ResponseBodyReader | 'aborted'>((resolveOpen, rejectOpen) => {
    const xhr = createXhr();
    const encoder = new TextEncoder();

    const onSignalAbort = () => xhr.abort();
    signal?.addEventListener('abort', onSignalAbort, { once: true });
    function cleanupSignal(): void {
      signal?.removeEventListener('abort', onSignalAbort);
    }

    let offset = 0;
    let decided = false;
    let ok = false;
    let opened = false; // the outer promise has settled with a reader (never true on a non-2xx path)
    let finished = false; // the stream has reached a terminal state (done/error/abort)

    const queue: QueuedOutcome[] = [];
    let waiter: { resolve(v: { done: boolean; value?: Uint8Array }): void; reject(e: unknown): void } | undefined;

    function deliver(outcome: QueuedOutcome): void {
      if (waiter) {
        const w = waiter;
        waiter = undefined;
        if (outcome.kind === 'error') {
          w.reject(outcome.error);
        } else {
          w.resolve(outcome.value);
        }
        return;
      }
      queue.push(outcome);
    }

    const reader: ResponseBodyReader = {
      read(): Promise<{ done: boolean; value?: Uint8Array }> {
        const next = queue.shift();
        if (next) {
          return next.kind === 'error' ? Promise.reject(next.error) : Promise.resolve(next.value);
        }
        return new Promise((resolve, reject) => {
          waiter = { resolve, reject };
        });
      },
    };

    /** Slice the not-yet-seen suffix of `responseText` by character offset (never per-chunk
     *  deltas — design D3) and encode it. Returns a valueless chunk when there is nothing new.
     *
     * Accumulation on the decoded string only heals splits at the BYTE level — it cannot heal a
     * split introduced by encoding a lone UTF-16 surrogate half on its own, which is exactly what
     * `TextEncoder.encode()` does (WHATWG Encoding spec: a lone surrogate encodes to the
     * replacement sequence). Only the LAST code unit of a slice can be an unpaired high surrogate
     * (`\uD800`-`\uDBFF`): `responseText` is contiguous, so any high surrogate earlier in the
     * slice necessarily has its low surrogate right after it in the same slice. So mid-stream
     * (`!done`) we hold back a trailing unpaired high surrogate rather than encode it, and do NOT
     * advance `offset` past it — it is picked up as the first code unit of the next slice, where
     * it will be paired with its now-arrived low surrogate (a low surrogate can never itself be
     * left unpaired: it only ever appears as the second half of a pair already completed in the
     * same contiguous string). At true stream end (`done`), there is no "next slice" to complete
     * the pair — a lone trailing high surrogate there means the body was genuinely truncated /
     * malformed, and we encode it as-is (`TextEncoder` emits its replacement sequence) so the
     * stream still terminates with a final chunk instead of stranding a held-back code unit and
     * never resolving `done`. */
    function newTextChunk(done: boolean): { done: boolean; value?: Uint8Array } {
      const text = xhr.responseText;
      let slice = text.length > offset ? text.slice(offset) : '';
      let consumedThrough = text.length;

      if (!done && slice.length > 0) {
        // charCodeAt is intentional here, not codePointAt: this reads a single UTF-16 code
        // UNIT to detect an unpaired trailing surrogate, the opposite of codePointAt's
        // code-POINT decoding (see the function doc above).
        const lastUnit = slice.charCodeAt(slice.length - 1); // NOSONAR - see comment above
        if (lastUnit >= 0xd800 && lastUnit <= 0xdbff) {
          slice = slice.slice(0, -1);
          consumedThrough -= 1;
        }
      }

      offset = consumedThrough;
      return slice.length > 0 ? { done, value: encoder.encode(slice) } : { done };
    }

    /** Decide ok/not-ok exactly once, as soon as `status` is known. On a 2xx status, hands the
     *  reader back immediately — before any body bytes arrive. */
    function decide(): void {
      if (decided || xhr.status === 0) {
        return;
      }
      decided = true;
      ok = xhr.status >= 200 && xhr.status < 300;
      if (ok) {
        opened = true;
        resolveOpen(reader);
      }
    }

    function finishOk(): void {
      if (finished) {
        return;
      }
      finished = true;
      cleanupSignal();
      deliver({ kind: 'value', value: newTextChunk(true) });
    }

    function finishAbort(): void {
      if (finished) {
        return;
      }
      finished = true;
      cleanupSignal();
      if (opened) {
        deliver({ kind: 'error', error: abortError() });
      } else {
        opened = true;
        resolveOpen('aborted');
      }
    }

    function finishTransportError(hint: string): void {
      if (finished) {
        return;
      }
      finished = true;
      cleanupSignal();
      if (opened) {
        deliver({ kind: 'error', error: new Error(hint) });
      } else {
        opened = true;
        rejectOpen(new GenerationClientError('network', { hint }));
      }
    }

    /** Non-2xx completion: classify the full accumulated body through the shared
     *  `httpErrorFrom` (never reimplemented here) via a minimal `Response`-shaped adapter.
     *
     *  Classification is asynchronous even though the response is already fully known, so a
     *  `signal` abort can land in the window between `finished = true` (above) and this
     *  classification resolving -- by then `cleanupSignal()` has already removed the abort
     *  listener, so nothing else observes it. Re-checking `signal?.aborted` once the
     *  classification settles lets that late abort still win: `'aborted'` rather than the
     *  classified HTTP error, matching the "abort ends iteration silently" contract. */
    function finishHttpError(): void {
      if (finished) {
        return;
      }
      finished = true;
      cleanupSignal();
      const fakeResponse = {
        status: xhr.status,
        json: async () => JSON.parse(xhr.responseText) as unknown,
      } as unknown as Response;
      httpErrorFrom(fakeResponse).then((err) => {
        opened = true;
        if (signal?.aborted) {
          resolveOpen('aborted');
        } else {
          rejectOpen(err);
        }
      });
    }

    xhr.open('POST', `${opts.baseUrl}/v1/generate`, true);
    for (const [name, value] of Object.entries(requestHeaders(opts))) {
      xhr.setRequestHeader(name, value);
    }

    xhr.onreadystatechange = () => {
      if (xhr.readyState === xhr.HEADERS_RECEIVED) {
        decide();
      }
    };

    xhr.onprogress = () => {
      if (finished) {
        return;
      }
      decide();
      if (ok) {
        const chunk = newTextChunk(false);
        if (chunk.value) {
          deliver({ kind: 'value', value: chunk });
        }
      }
    };

    xhr.onload = () => {
      decide();
      if (ok) {
        finishOk();
      } else {
        finishHttpError();
      }
    };

    xhr.onerror = () => finishTransportError('The generate request failed');
    xhr.ontimeout = () => finishTransportError('The generate request timed out');
    xhr.onabort = () => finishAbort();

    xhr.send(JSON.stringify(request));
  });
}
