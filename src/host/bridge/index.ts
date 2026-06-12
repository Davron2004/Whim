/**
 * capability-bridge — public API (Decision #41). The syscall boundary between sandboxed
 * mini-apps and host capabilities: a versioned transport envelope, an RPC dispatcher with
 * idempotent delivery + generation fences, an append-only capability registry, and a gate that
 * enforces the host-held manifest with structured fix-hint errors. Storage is wired as syscall
 * #1; `diag` is the registry-extensibility proof.
 *
 *   import { createDefaultRegistry, launchApp, Dispatcher } from './bridge';
 *   const registry = createDefaultRegistry();
 *   const launched = launchApp(appRecord, createStorageEngine);   // engine opens before bundle
 *   if (launched.ok) {
 *     const dispatcher = Dispatcher.forRealm(launched.realm, registry);
 *     // … on each inbound syscall frame: const sysret = await dispatcher.handle(frame);
 *   }
 */

export * from './contract';
export { CapabilityRegistry } from './registry';
export { runGate, ALLOW_ALL } from './gate';
export type { PermissionHook, GateResult } from './gate';
export { Dispatcher, resetRealmGeneration, tearDownRealm } from './dispatcher';
export type { DispatcherOptions } from './dispatcher';
export { launchApp } from './launch';
export type { EngineFactory, LaunchResult } from './launch';
export { registerStorageRows, registerDiagRows } from './rows';

import { CapabilityRegistry } from './registry';
import { registerStorageRows, registerDiagRows } from './rows';

/** The host's append-only capability table: storage (syscall #1) + diag (the second-row proof).
 *  A duplicate registration anywhere throws at startup (D5). */
export function createDefaultRegistry(): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  registerStorageRows(registry);
  registerDiagRows(registry);
  return registry;
}
