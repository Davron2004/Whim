# Whim

**Vibe-code tiny personal apps on your phone, by talking. No code ever shown.**

[![invariants](https://github.com/Davron2004/Whim/actions/workflows/invariants.yml/badge.svg)](https://github.com/Davron2004/Whim/actions/workflows/invariants.yml)
![React Native 0.85](https://img.shields.io/badge/React%20Native-0.85-61dafb)
![Hermes](https://img.shields.io/badge/engine-Hermes-orange)
![Android first](https://img.shields.io/badge/platform-Android%20first-3ddc84)

You describe what you want — *"a timer with my exact pour-over recipe"*, *"a tracker for some thing only I care about"* — an AI agent builds it against a small in-house SDK, and the result appears in your launcher as a runnable app. The thesis is the **long tail of personal software**: apps too small, too niche, or too personal to ever deserve a store listing. Whim collapses the effort to a sentence.

> 🎬 **Demo video — coming soon.** The sandbox runtime and version store are running on-device (screenshots below); an end-to-end recorded demo lands here once the next milestone is in.

---

## The interesting problems

This project exists to demonstrate harness engineering — the unglamorous machinery that makes LLM code generation *reliable* rather than impressive-once. The hard parts, in order of how much they fight back:

1. **Run untrusted, LLM-generated code on a phone, safely.** Every mini-app is code nobody reviewed. It runs in a sandbox that is pen-tested, never-regress-CI-gated, and assumes the bundle is actively hostile — including assuming it will *lie about its own containment*.
2. **Govern what that code can touch.** Storage and physical feedback (haptics, sound) aren't ambient capabilities — they're syscalls over an append-only registry with a fixed-order gate, reachable only from a channel a mini-app can't forge.
3. **Design an SDK for a model, not a human.** A small, fully-documented component surface that fits in a system prompt, accepts semantic tokens instead of raw values, and makes hallucinated imports structurally impossible.
4. **Version control nobody can see.** Every generation is snapshotted with full history, rollback, pinning, and forking — backed by real git, on-device, with zero git vocabulary reaching the user (a build guard fails if a hash or ref leaks into the API surface).
5. **A self-healing generation loop** *(in progress)*: the wire contract, SSE streaming, and a stub Hono server are live; plan → generate → **static-check** → run → observe → repair still needs the static-check stage (proposed, not built) and a real model behind the harness — the quality of the structured diagnostics fed back, not the model, is what's meant to make this good.

## Architecture

The phone owns what's user-owned and must stay stable (apps, data, history, the runtime). The server owns what changes constantly (the harness, model access, checks, telemetry). The server is **stateless** — the device is the system of record.

```mermaid
flowchart LR
    subgraph Phone["📱 Phone — system of record"]
        UI["Host app<br/>(launcher · prompt UI)"]
        RT["Sandbox runtime<br/>(hardened WebView)"]
        VS[("Version store<br/>(on-device git,<br/>product verbs only)")]
    end
    subgraph Server["☁️ Server — stateless (skeleton live)"]
        H["Generation harness<br/>SSE stub pipeline today;<br/>plan → generate → check<br/>→ run → observe → repair (target)"]
    end
    M["LLM endpoint"]
    UI -- "describe an app" --> H
    H <--> M
    H -- "verified bundle (IIFE)" --> RT
    RT -- "snapshot every generation" --> VS
```

A mini-app is **one TypeScript file** that imports only from `vc-sdk` and exports a `defineApp({...})` spec. esbuild turns it into a ~4.5 KiB IIFE; `react`, `react-dom`, and `vc-sdk` stay external and resolve to host-injected globals, so the resolvable module surface at runtime is exactly those three names — everything else throws.

### The sandbox

Containment rests on three legs, and the pen-testing showed **none is sufficient alone**:

```mermaid
flowchart TB
    subgraph RN["React Native host — trusted"]
        subgraph WV["WebView outer document — trusted"]
            subgraph IF["⛔ cross-origin iframe — sandbox=allow-scripts, opaque origin"]
                direction TB
                NEU["neutralize.js — window-level value-strip<br/>fetch · XHR · WebSocket · RTCPeerConnection<br/>localStorage · indexedDB · Worker · sendBeacon"]
                LD["trusted loader — holds nothing stronger<br/>than parent.postMessage"]
                SDK["vc-sdk + one shared React instance"]
                APP["🔓 untrusted mini-app bundle"]
            end
        end
    end
    CSP["CSP: script-src without 'unsafe-eval'<br/>default-src 'none' · connect-src 'none'"] -.enforced on.-> IF
    APP -- "render via vc-sdk only" --> SDK
    IF -- "nonce-authenticated frames" --> WV
```

- The **cross-origin iframe** (no `allow-same-origin`) denies all host/native reach — `parent.document`, `top.location`, the RN bridge are all `SecurityError`.
- The **CSP without `'unsafe-eval'`** is the only thing that closes the `({}).constructor.constructor('…')` codegen hole — every object reaches the `Function` constructor through its prototype chain, so no amount of global-stripping can. Conversely, `eval`/`Function` are *not* value-replaced: React's internals need them, and CSP kills codegen at the engine level anyway. Strip the capability, not the identifier.
- The **global value-strip** covers what CSP can't — notably `RTCPeerConnection`, since WebRTC ignores `connect-src`.

The adversarial suite assumes the worst finding from pen-testing (F4): a bundle **shares the iframe scope with the loader and can forge its own "I'm contained" verdict**. So the host never trusts a self-report — the verdict comes from closure-captured probes the bundle can't overwrite, and every iframe→host control frame is authenticated with a per-realm nonce. Realms are recreated per generation, because an earlier generation can otherwise backdoor the next one through `Object.prototype` (confirmed on-device, now a regression test).

All of this is enforced by a **never-regress invariant suite** (`npm run invariants`) that runs as a blocking CI gate — including a deliberately-broken-CSP negative control, so the suite proves it isn't vacuously green.

### The version store

Every generation is committed to a real git repository on the device (`isomorphic-git` under Hermes), one repo per mini-app. The public API speaks **product verbs only** — `snapshot · history · diff · rollback · pin · fork` — and a build-time guard fails if git vocabulary (a hash, a ref, a commit key) ever reaches a return shape. Since isomorphic-git has no `gc`, compaction is a DIY pack-then-drop-loose pass, triggered by loose-object *count* (the real pressure point on a KV-backed FS, not bytes).

### The capability bridge

Mini-apps don't get ambient access to storage, haptics, or sound — they reach host capabilities only through a governed syscall layer (an append-only registry, a fixed-order gate, a generation-fenced dispatcher) between the sandboxed iframe and the RN host. The syscall channel needs no nonce: a forged `sysret` posted by a bundle to its own window arrives with `ev.source` pointing at the iframe's own window, never `window.parent` — the browser sets `source`, so it's unforgeable by construction. Storage (schema-declared, per-app SQLite) was syscall #1; physical cues (haptics, sound) are #2 and #3, gated by manifest-declared capability tokens. An undeclared capability is denied with a structured error, never silently dropped.

## On-device evidence

Everything below was measured on the real target — Android System WebView / Hermes, RN new architecture, offline release build — not desktop Chrome.

| What | Result |
|---|---|
| Containment probes (trusted vantage) | **42/42 pass**, `contained:true` |
| Mini-app mount → first paint | **~119 ms** cold · **~32 ms** warm realm |
| Mini-app bundle size | **~4.5 KiB** IIFE |
| Snapshot / rollback / fork | ~45–86 ms · ~58–183 ms · ~37–68 ms |
| Storage cost per generation | ~650 B + ~4 git objects |
| Compaction | 48 loose objects → 0; history/rollback/fork still resolve |
| Persistence across app kills | 3× kill+relaunch cycles, **0 corruption** |
| Storage-engine writes (on-device) | `update`/`remove` ~1–11 ms · `kv.set` ~1–9 ms · single `append` ~1.2 ms warm |
| Capability-bridge round-trip (on-device) | ~16–17 ms median **per syscall**, every verb — transport-bound (2 WebView↔RN crossings), not engine-bound |

<p>
  <img src="invariants/sandbox-isolation/reference/spike1-android-result.png" width="230" alt="Sandbox containment verdict on-device" />
  <img src="docs/vstore-android-mmkv-restart.png" width="230" alt="Version store surviving app restarts on-device" />
</p>

*Left: the containment verdict rendered on-device. Right: the version store verifying its own snapshots across three app restarts.*

## How this is being built

The process is as much the portfolio piece as the code:

- **Spike-driven de-risking.** Every risky unknown (can a WebView contain a hostile bundle? does isomorphic-git run under Hermes? what's the bundle delivery channel?) got a throwaway spike with explicit hypotheses and an on-device verdict. Spike scaffolds are deleted; findings outlive them in [`docs/`](docs/).
- **A numbered decision log.** [`docs/decisions.md`](docs/decisions.md) records 43+ decisions *with their rejected alternatives* — including the reversals, kept on the record.
- **Adversarial verification.** The bundle contract was pen-tested (T1–T8 + F4) before being productionized; the attacks that landed became carry-forward constraints, and the constraints became CI.
- **Spec-driven changes.** Work flows through [OpenSpec](openspec/) proposals → design → tasks → archive, with capability specs as the source of truth.
- **A raw devlog.** [`DEVLOG.md`](DEVLOG.md) captures the dead ends and "I was wrong about X" lessons before they evaporate.
- **An agentic build harness with adversarial self-checks.** Most implementation work is dispatched to subagents over isolated git worktrees, gated by a pinned-commit integrity check (never a HEAD diff — once an agent can commit, that check is foldable) and a red/green check proving each test is non-vacuous before merge. Built first as a parallel batch-fix loop, generalizing next to the full OpenSpec build loop.

## Status

| | |
|---|---|
| ✅ | **Sandbox runtime (v0.1)** — hardened WebView realm, bundle contract, nonce-authenticated verdicts, blocking-CI invariant suite |
| ✅ | **On-device version store (v0.2)** — snapshot/history/rollback/pin/fork over isomorphic-git + MMKV, accepted on-device |
| ✅ | **Per-app storage engine (v0.2)** — schema-declared SQLite, burned-ID columns, additive-only evolution, accepted on-device |
| ✅ | **Capability bridge** — governed syscalls (storage, haptics/sound) over an append-only registry, accepted on-device |
| ✅ | **Effects & cues (v0.3)** — web-resident timers + native haptic/sound feedback, accepted on-device |
| ✅ | **Launcher shell** — home grid, full-screen launch, system-back exit, fork/delete, first-run seeding |
| 🔜 | **Generation harness** — skeleton live (Hono server, SSE wire contract, durable token metering); the real plan→generate→**check**→run→repair loop and a model behind it aren't wired yet |
| 🔜 | **Static check pipeline** — proposed, not yet built; closes the one open pen-test finding (token-scan checks miss prototype-pollution) |
| 🔜 | **SDK design system** — the real component set + visual language (current SDK implements exactly what shipped apps use) |
| ⏳ | Voice input, iOS |

```mermaid
flowchart LR
    P["Plan"] --> G["Generate"] --> S["Static check"] --> R["Run in sandbox"] --> O["Observe<br/>structured diagnostics"]
    O -- "repair (≤3 attempts)" --> G
    O -- "clean" --> D["Deliver + snapshot"]
```

## Repository map

```
build/        esbuild pipeline — mini-app bundles + the runtime HTML the WebView loads
contract/     @whim/contract — zod wire schemas shared by device and server
server/       @whim/server — Hono harness server skeleton (SSE generation, token metering)
src/runtime/  the WebView sandbox runtime (neutralize · resolver · probes · loader · syscall)
src/sdk/      vc-sdk — the private SDK mini-apps are written against
src/host/     RN shell — launcher, capability bridge, storage engine, version store
invariants/   never-regress containment suites (blocking CI gate)
fixtures/     the sample mini-app + adversarial bundles that attack the sandbox
docs/         spec · numbered decision log · spike findings · build-harness design
openspec/     spec-driven change workflow (proposals → specs → archive)
```

## Running it

```sh
npm install
npm run build              # esbuild → runtime HTML + app bundles + artifacts
npm run invariants         # the containment suite vs this exact build (headless Chromium)
npm run vstore:test        # version-store acceptance suite (Node)
npm run storage:test       # storage-engine acceptance suite (Node)
npm run bridge:test        # capability-bridge acceptance suite (Node)
```

Desktop Chromium is the fast pre-check; the authoritative verdict is the real Android WebView. To run on a device/emulator (Node 22, JDK 21): `npm run android:release`.
