// ─────────────────────────────────────────────────────────────────────────────
// Whim runtime — iframe-side syscall marshaller (capability-bridge D1/D3/D6 / task 2.1).
// ─────────────────────────────────────────────────────────────────────────────
// Installs `window.__whimSyscall.call(method, params) → Promise`, the transport the vc-sdk
// `storage` facade rides. It assigns a monotonic id per generation, holds a Promise
// correlation map, times out, and — load-bearing — accepts a `sysret` ONLY from the host
// channel (`window.parent`). A `sysret` a malicious bundle posts to its OWN window has
// `ev.source === window` (not `window.parent`), so it is inert; and the map only resolves an
// id the stub itself issued (an invented id finds no pending entry).
//
// Carry-forward constraint #2: this marshaller's ONLY capability is the same one-way
// `parent.postMessage` the loader already holds — it leaves nothing stronger on `window`
// (`__whimSyscall` exposes only `.call`, which posts a string). Family separation (D1): it
// reads ONLY `sysret` frames; control + syscall frames are ignored. Mirrors `classifyFrame`
// in src/host/bridge/contract.ts by the same `whim` discriminator.
//
// Runs after the SDK inject + probes, before the loader, so its message listener is live
// before the loader posts `hello` (and the host replies with the init frame carrying the
// generation this realm stamps onto every syscall — the host is the generation authority).
(function whimSyscallMarshaller() {
  'use strict';

  let seq = 0;                 // monotonic id, per generation (a fresh iframe → a fresh seq)
  let hostGen = 1;             // the generation the host bound this realm at; set from init
  const pending = Object.create(null); // id -> { resolve, reject, timer }
  const TIMEOUT_MS = 10000;    // D8 placeholder — tune from the on-device round-trip (task 6.3)

  function err(kind, method, hint) {
    return { kind: kind, method: method, hint: hint };
  }

  function call(method, params) {
    return new Promise(function (resolve, reject) {
      const id = ++seq;
      const frame = {
        whim: 'syscall', v: 1, id: id, gen: hostGen, method: String(method),
        params: (params && typeof params === 'object') ? params : {},
      };
      const timer = window.setTimeout(function () {
        if (pending[id]) {
          delete pending[id];
          reject(decorate(err('syscall_timeout', method, 'No host response within ' + TIMEOUT_MS + 'ms.'), id));
        }
      }, TIMEOUT_MS);
      pending[id] = { resolve: resolve, reject: reject, timer: timer };
      try {
        window.parent.postMessage(JSON.stringify(frame), '*'); // NOSONAR - sandboxed srcdoc iframe posts to an opaque parent channel.
      } catch (e) {
        window.clearTimeout(timer);
        delete pending[id];
        reject(decorate(err('transport_unavailable', method, 'Could not post the syscall to the host.'), id));
      }
    });
  }

  // Surface a host-sent structured error as an Error whose `.detail` carries the machine-
  // readable {kind, hint} (the §8.1 repair-loop shape); the message IS the hint so a bare
  // `catch` still says something useful.
  function decorate(error, id) {
    const detail = (error && typeof error === 'object') ? error : { kind: 'handler_error', hint: 'syscall failed' };
    const e = new Error(detail.hint || ('syscall ' + id + ' failed'));
    e.name = 'WhimSyscallError';
    e.detail = detail;
    return e;
  }

  window.addEventListener('message', function (ev) {
    // Host-channel-only acceptance (D3): forged in-iframe frames have ev.source === window.
    if (ev.source !== window.parent) return;
    const data = ev.data;
    if (typeof data !== 'string') return;
    let msg;
    try { msg = JSON.parse(data); } catch (e) { return; }
    if (!msg || typeof msg !== 'object') return;

    // The host init frame carries the generation this realm stamps (the fence authority, D3).
    if (msg.__whimHostInit === true && typeof msg.gen === 'number') { hostGen = msg.gen; return; }

    // Family separation (D1): only `sysret` frames are ours.
    if (msg.whim !== 'sysret') return;
    const p = pending[msg.id];
    if (!p) return; // unknown / forged / already-settled id → inert
    window.clearTimeout(p.timer);
    delete pending[msg.id];
    if (msg.ok) p.resolve(msg.result);
    else p.reject(decorate(msg.error, msg.id));
  });

  // The single thing left on window: a function that posts a string. Nothing stronger. Installed
  // non-writable + non-configurable (A6 — mirrors neutralize.js's technique for security-relevant
  // globals) so a bundle sharing this realm cannot swap the marshaller for a shim that captures the
  // params/results flowing through it. A realm reset recreates the iframe (a fresh realm reinstalls
  // this cleanly), so nothing legitimately reassigns it within a generation.
  const api = { call: call };
  try {
    Object.defineProperty(window, '__whimSyscall', {
      value: api, writable: false, configurable: false, enumerable: false,
    });
  } catch (e) {
    window.__whimSyscall = api; // defensive: never leave the transport uninstalled
  }
})();
