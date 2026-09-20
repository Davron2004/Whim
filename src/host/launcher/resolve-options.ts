/**
 * resolve-options (review fix N3) — the pure half of `LauncherRoot.tsx`'s `resolveClientOptions`:
 * the gated memo when it already reflects the current grant, or a fresh live read
 * (`consent-options.ts`) when it does not yet (design D2; spec ai-data-consent "After the user
 * agrees, the action they started SHALL continue as if consent had already existed"). Lifted out
 * so the fallback itself — not just `liveClientOptions`'s own live read — is exercised directly,
 * rather than only through `LauncherRoot.tsx`'s source-pinned call site. RN-free: this must load
 * under the launcher's Node acceptance suite.
 */

/** `memo` when it is non-null, otherwise `live`. Generic over the options type so it needs no
 *  dependency on `ConsentedClientOptions` itself. */
export function resolveOptions<T>(memo: T | null, live: T | null): T | null {
  return memo ?? live;
}
