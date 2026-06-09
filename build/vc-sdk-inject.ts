// Build-time entry: bundles the real SDK (src/sdk) into one IIFE that installs it as the
// host-injected global `window.__WHIM_VC_SDK__` (H1b). `react` is marked EXTERNAL for this
// build, so the SDK's `require("react")` resolves at runtime to the single shared
// `window.React` via the H1b resolver (resolver.js runs before this script). This is the one
// capability surface the bundle's `require("vc-sdk")` resolves to.
import * as VcSdk from '../src/sdk';

(globalThis as { __WHIM_VC_SDK__?: unknown }).__WHIM_VC_SDK__ = VcSdk;
