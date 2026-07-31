/**
 * synthetic-run-harness — capability wiring (design D3, `handoff/capability-trace.md`). Wires
 * the REAL production capability gate/dispatcher/registry against an ephemeral, per-run Node
 * `:memory:` storage engine — the bridge-invariants recipe transplanted verbatim: `launchApp` →
 * `Dispatcher.forRealm` → `context.exposeFunction('whimHostDispatch', …)`. Nothing here
 * reimplements or approximates authorization; every verdict is the production gate's own.
 *
 * Denials are collected HOST-SIDE at the dispatch function (the only vantage that sees them even
 * when the candidate `.catch`es and swallows the rejected promise). `cues.*`/`diag.*` have no
 * server-side effect in this harness: they validate through the real gate and then RECORD their
 * invocation into `trace` instead of acting (no device, no hardware).
 *
 * Composes into `RunOptions.beforeNavigate` (`contract.ts`) alongside chain 2's
 * `attachObserversEarly` (`handoff/observe-api.md`) — this module never calls `page.goto` or
 * owns navigation itself; `beforeNavigate` below is the ENTIRE seam.
 */
import type { BrowserContext, Page } from 'playwright';
import {
  AppRecord,
  CueBackend,
  Dispatcher,
  EngineFactory,
  RealmRecord,
  createDefaultRegistry,
  launchApp,
} from '../src/host/bridge';
import { createEngine } from '../src/host/storage-engine/engine';
import { createNodeSqlExecutor } from '../src/host/storage-engine/bindings/node-sqlite';

/** One host-side-recorded trace entry. `kind` mirrors `contract.ts`'s `TraceEntry` base union
 *  (`'syscall' | 'cue' | 'denial'`) verbatim — structurally assignable into `RunReport.trace`
 *  the moment chain 5 wires it in, exactly like chain 2's `ObservedDiagnostic`. */
export type CapabilityTraceEntry =
  | { kind: 'syscall'; method: string; atMs: number }
  | { kind: 'cue'; method: string; atMs: number; params: Record<string, unknown> }
  | { kind: 'denial'; method: string; atMs: number; errorKind: string; capability?: string; hint: string };

export interface CapabilityWiringOptions {
  /** Overrides the ephemeral engine factory (default: a fresh Node `:memory:` engine per call —
   *  D3, no candidate state survives into another run; the default ignores `appId`, since a
   *  fresh `:memory:` database is isolated by construction). */
  engineFactory?: EngineFactory;
}

export interface CapabilityWiring {
  /** The bound realm, or `null` when launch was refused — see `launchError`. */
  realm: RealmRecord | null;
  /** Set iff `launchApp` refused (e.g. `missing_schema`, or a storage-engine `open` failure).
   *  The caller (chain 5) surfaces this as a diagnostic (task 3.2: "failure-as-diagnostic"); no
   *  live dispatch is ever exposed in this case. */
  launchError: { kind: string; hint: string } | null;
  /** Every denial and recorded effector invocation, host-side, in arrival order. */
  trace: CapabilityTraceEntry[];
  /** The exposed dispatch: a syscall-frame string in, a sysret string (or `null` when dropped)
   *  out — directly callable (no browser needed) for tests that don't need a real page. */
  dispatch: (frameString: string) => Promise<string | null>;
  /** `RunOptions.beforeNavigate`-compatible: binds `context.exposeFunction('whimHostDispatch',
   *  dispatch)`. A no-op when launch failed — nothing to expose; the runtime's fallback relay
   *  then silently drops any syscall the candidate attempts, and `launchError` is what actually
   *  surfaces the failure to the caller. */
  beforeNavigate: (page: Page, context: BrowserContext) => Promise<void>;
}

/**
 * Build the capability wiring for one run against one `AppRecord`. Call once per run (each call
 * launches its own realm over its own fresh engine — never share a `CapabilityWiring` across
 * runs). Pass `beforeNavigate` into `SynthRunSession.openRun`'s `RunOptions.beforeNavigate`,
 * composing with any other hook (chain 2's observers) by wrapping both.
 */
export function wireCapabilityBridge(appRecord: AppRecord, opts: CapabilityWiringOptions = {}): CapabilityWiring {
  const trace: CapabilityTraceEntry[] = [];
  const startedAt = Date.now();
  const elapsed = (): number => Date.now() - startedAt;

  // cues.* have no device wired here (D3, "no hardware server-side"): record instead of firing.
  const cueBackend: CueBackend = {
    haptic(kind) {
      trace.push({ kind: 'cue', method: 'cues.haptic', atMs: elapsed(), params: { kind } });
    },
    sound(name) {
      trace.push({ kind: 'cue', method: 'cues.sound', atMs: elapsed(), params: { name } });
    },
  };
  const registry = createDefaultRegistry({ cueBackend });

  const engineFactory: EngineFactory = opts.engineFactory ?? (() => createEngine(createNodeSqlExecutor(':memory:')));
  const launched = launchApp(appRecord, engineFactory);

  if (!launched.ok) {
    return {
      realm: null,
      launchError: launched.error,
      trace,
      dispatch: async () => null,
      beforeNavigate: async () => {
        /* nothing to expose — no realm was bound (see `launchError` on the returned wiring). */
      },
    };
  }

  const realm = launched.realm;
  const dispatcher = Dispatcher.forRealm(realm, registry);

  const dispatch = async (raw: string): Promise<string | null> => {
    const method = methodOf(raw);
    const sysret = await dispatcher.handle(raw);
    if (sysret && !sysret.ok && sysret.error) {
      const err = sysret.error;
      trace.push({
        kind: 'denial',
        method: method ?? ('method' in err && err.method ? err.method : 'unknown'),
        atMs: elapsed(),
        errorKind: err.kind,
        capability: 'capability' in err ? err.capability : undefined,
        hint: err.hint,
      });
    } else if (sysret && sysret.ok && method) {
      if (method.startsWith('cues.')) {
        // already recorded above by the recording cue backend — avoid a duplicate entry.
      } else if (method.startsWith('diag.')) {
        // diag.echo has no server-side effect either — record like a cue, not a real syscall.
        trace.push({ kind: 'cue', method, atMs: elapsed(), params: {} });
      } else {
        trace.push({ kind: 'syscall', method, atMs: elapsed() });
      }
    }
    return sysret ? JSON.stringify(sysret) : null;
  };

  return {
    realm,
    launchError: null,
    trace,
    dispatch,
    beforeNavigate: async (_page, context) => {
      await context.exposeFunction('whimHostDispatch', dispatch);
    },
  };
}

function methodOf(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw) as { method?: unknown };
    return typeof parsed.method === 'string' ? parsed.method : undefined;
  } catch {
    return undefined;
  }
}
