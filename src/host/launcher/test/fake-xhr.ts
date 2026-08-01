/**
 * fake-xhr — a Node test double for `XMLHttpRequest`, modeled on the OBSERVABLE contract in
 * `node_modules/react-native/Libraries/Network/XMLHttpRequest.js` (fix-generate-stream-transport
 * chain-4, task 3.1), not on a from-memory idea of "how XHR generally works" (design §Risks:
 * "Testing against a fake `XMLHttpRequest` re-creates the original trap").
 *
 * Behaviors modeled directly from that source (line numbers as read):
 *   - readyState constants `UNSENT/OPENED/HEADERS_RECEIVED/LOADING/DONE` = `0..4`
 *     (`XMLHttpRequest.js:66-70`), exposed as BOTH static and instance properties
 *     (`XMLHttpRequest.js:130-142`) — `xhr-transport.ts` reads `HEADERS_RECEIVED` as an instance
 *     property (handoff `xhr-transport.md` §5).
 *   - `__didReceiveResponse` (`XMLHttpRequest.js:330-356`): sets `status` FIRST, then advances
 *     `readyState` to `HEADERS_RECEIVED`, firing exactly one `readystatechange`.
 *   - `__didReceiveIncrementalData` (`XMLHttpRequest.js:370-391`): `_response` (→
 *     `responseText`) is ACCUMULATED (`+=`), never replaced; advances `readyState` to `LOADING`
 *     and fires `readystatechange`, THEN fires `progress` (`setReadyState` runs before
 *     `__didReceiveDataProgress` in that method's body) — that exact order is reproduced here.
 *   - `__didCompleteResponse` (`XMLHttpRequest.js:411-442`) via `setReadyState`
 *     (`XMLHttpRequest.js:670-687`): advances to `DONE`, fires `readystatechange`, THEN exactly
 *     one of `abort`/`timeout`/`error`/`load` depending on how the terminal state was reached.
 *   - `abort()` (`XMLHttpRequest.js:637-656`): a documented no-op once `readyState` is already
 *     `DONE` (or was never sent) — abort after completion does not re-fire any event.
 *   - `dispatchEvent`/`dispatch` (`EventTarget.js:192-210`) is a synchronous call with no
 *     microtask hop — every handler above fires synchronously within the call that triggers it,
 *     matching this fake's synchronous callback invocation.
 *
 * Deliberately NOT modeled (per `xhr-transport.md` §5, this module's tests place no requirement
 * on them): `getResponseHeader`, `getAllResponseHeaders`, `responseURL`, `response` (non-text),
 * `timeout` (value), `withCredentials`, `upload`, `addEventListener`/`removeEventListener`, and
 * `onloadstart`/`onloadend`.
 *
 * Residual risk (explicitly out of scope — design §Risks: "only the device proves the
 * transport"): whether Android's native decoder can ever expose a `responseText` growth that
 * ends mid-multi-byte-character (e.g. a lone UTF-16 surrogate) is a native runtime fact this fake
 * cannot settle either way; see the chain-4 report's multi-byte findings.
 */

const READY_STATE = { UNSENT: 0, OPENED: 1, HEADERS_RECEIVED: 2, LOADING: 3, DONE: 4 } as const;

export class FakeXMLHttpRequest {
  static readonly UNSENT = READY_STATE.UNSENT;
  static readonly OPENED = READY_STATE.OPENED;
  static readonly HEADERS_RECEIVED = READY_STATE.HEADERS_RECEIVED;
  static readonly LOADING = READY_STATE.LOADING;
  static readonly DONE = READY_STATE.DONE;

  readonly UNSENT = READY_STATE.UNSENT;
  readonly OPENED = READY_STATE.OPENED;
  readonly HEADERS_RECEIVED = READY_STATE.HEADERS_RECEIVED;
  readonly LOADING = READY_STATE.LOADING;
  readonly DONE = READY_STATE.DONE;

  readyState: number = READY_STATE.UNSENT;
  status = 0;
  responseText = '';

  onreadystatechange: (() => void) | null = null;
  onprogress: (() => void) | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  // Test-observable call record. `xhr-transport.ts` never reads these back — only the tests do.
  openedMethod: string | undefined;
  openedUrl: string | undefined;
  openedAsync: boolean | undefined;
  readonly requestHeaders: Record<string, string> = {};
  sentBody: string | undefined;
  sendCount = 0;
  abortCount = 0;

  open(method: string, url: string, async: boolean): void {
    this.openedMethod = method;
    this.openedUrl = url;
    this.openedAsync = async;
    this.readyState = READY_STATE.OPENED;
  }

  setRequestHeader(name: string, value: string): void {
    this.requestHeaders[name] = value;
  }

  send(body: string): void {
    this.sentBody = body;
    this.sendCount += 1;
  }

  /** `XMLHttpRequest.js:637-656`: a no-op (no state change, no event) once the request already
   *  reached `DONE` or was never sent — matching `xhr-transport.ts`'s reliance on "abort after
   *  completion is a documented no-op" (handoff §4) needing no defensive guard on its side. */
  abort(): void {
    this.abortCount += 1;
    if (this.readyState === READY_STATE.DONE || this.readyState === READY_STATE.UNSENT) {
      return;
    }
    this.readyState = READY_STATE.DONE;
    this.onreadystatechange?.();
    this.onabort?.();
  }

  /** Simulate `__didReceiveResponse` (`XMLHttpRequest.js:330-356`): `status` becomes known and
   *  `readyState` advances to `HEADERS_RECEIVED`, firing one `readystatechange`. */
  respondHeaders(status: number): void {
    this.status = status;
    this.readyState = READY_STATE.HEADERS_RECEIVED;
    this.onreadystatechange?.();
  }

  /** Simulate `__didReceiveIncrementalData` (`XMLHttpRequest.js:370-391`): `responseText` grows
   *  by `text` (accumulated, never a delta view — `_response += responseText`), `readyState`
   *  becomes `LOADING`, firing `readystatechange` then `progress`, in that order. */
  respondIncremental(text: string): void {
    this.responseText += text;
    this.readyState = READY_STATE.LOADING;
    this.onreadystatechange?.();
    this.onprogress?.();
  }

  /** Simulate `__didCompleteResponse` (`XMLHttpRequest.js:411-442`) with no error: `readyState`
   *  becomes `DONE`, firing `readystatechange` then `load`. */
  respondComplete(): void {
    this.readyState = READY_STATE.DONE;
    this.onreadystatechange?.();
    this.onload?.();
  }

  /** Simulate `__didCompleteResponse` with a transport error (not a timeout): `readystatechange`
   *  then `error`. */
  respondError(): void {
    this.readyState = READY_STATE.DONE;
    this.onreadystatechange?.();
    this.onerror?.();
  }

  /** Simulate `__didCompleteResponse` with `timeOutError: true`: `readystatechange` then
   *  `timeout`. */
  respondTimeout(): void {
    this.readyState = READY_STATE.DONE;
    this.onreadystatechange?.();
    this.ontimeout?.();
  }
}
