// ─────────────────────────────────────────────────────────────────────────────
// NativeWhimRandom — codegen spec for the in-repo secure-random TurboModule
// (webview-bridge-provenance D1).
// ─────────────────────────────────────────────────────────────────────────────
// Hermes has no `crypto` global (no getRandomValues, no randomUUID), and the per-WebView-instance
// bridge token must come from the operating system's CSPRNG, never `Math.random`. One
// synchronous method: Android reads `java.security.SecureRandom`, iOS `SecRandomCopyBytes`.
// There is deliberately no JS fallback: a caller that gets `null` has no token and must fail
// closed.
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  /** `byteCount` random bytes as lowercase hex (2 × `byteCount` characters). `null` when
   *  `byteCount` is not an integer in 1–64 or the OS random source fails. */
  randomHex(byteCount: number): string | null;
}

// `get` (not `getEnforcing`): a build without the module resolves to null instead of throwing at
// import, so the caller fails closed where it asks for a token.
export default TurboModuleRegistry.get<Spec>('WhimRandom');
