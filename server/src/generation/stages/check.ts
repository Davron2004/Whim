/**
 * server/src/generation/stages/check.ts — the concrete `CheckStage` (design D12,
 * `handoff/stage-contracts.md`). Wraps `checks/index.ts`'s `runStaticChecks` — the harness's ONE
 * static-checker entry — with the request's applied schema as the diff baseline and the machine's
 * per-run storage-surface scan as the drift baseline, and maps its report onto the machine's
 * minimal `CheckReport`/`CheckedManifest` shapes (design D2). The
 * machine alone decides errors-block/warnings-pursued from `diagnostics[].severity` (design D6) —
 * this stage never filters or ranks by severity.
 *
 * Also exports `preflightSource` (spec "An edit without original source regenerates honestly"):
 * a supplied `app.source` is treated as absent unless it parses AND declares a default-exported
 * `defineApp({...})` call — the two guarantees compiled bundle text can never satisfy (an esbuild
 * IIFE has no top-level `export` at all). Not wired into prompt assembly here — this stage only
 * exports the predicate the composition root applies to `GenerateRequest.app.source` before any
 * prompt is built.
 */
import { runStaticChecks } from '../../../../checks/index';
import { TILE_DIAGNOSTIC_KINDS, type ExtractedManifest } from '../../../../checks/contract';
import type { AppliedSchema } from '../../../../src/host/storage-engine/schema';
import { log } from '../../logger';
import type { CheckContext, CheckedManifest, CheckReport, CheckStage } from '../machine';
import type { Diagnostic } from '@whim/contract';

const checkLog = log.child({ scope: 'check' });

/** `ExtractedManifest` (checker) → `CheckedManifest` (machine/wire): `name`/`schema` are pulled
 *  out to their own `WireAppRecord` top-level fields (design D12), so `manifest` here carries the
 *  rest (`initial`/`screens`/`capabilities`, and the tile identity) — a strict superset of the
 *  bridge gate's own `AppManifest.capabilities` read, so the cast on the device side stays sound.
 *
 *  `tint`/`icon` (already resolved to the closed sets by the checker) and a legacy `tileColor`
 *  (unvalidated: the host maps it) ride INSIDE `manifest` (decision #41's "no second source of
 *  truth"): they come only from the one `defineApp` extraction, and `assembleRecord` passes
 *  `manifest` through untouched — there is no top-level `WireAppRecord` field to keep in sync. */
function toCheckedManifest(m: ExtractedManifest): CheckedManifest {
  const { name, schema, ...rest } = m;
  return {
    name,
    manifest: rest as Record<string, unknown>,
    schema: (schema as Record<string, unknown> | undefined) ?? {},
  };
}

function toWireDiagnostic(d: {
  kind: string;
  severity: 'error' | 'warning';
  line: number;
  symbol?: string;
  message: string;
  hint: string;
}): Diagnostic {
  return { kind: d.kind, severity: d.severity, line: d.line, symbol: d.symbol, message: d.message, hint: d.hint };
}

const TILE_KINDS: ReadonlySet<string> = new Set(TILE_DIAGNOSTIC_KINDS);

/** The production `CheckStage`: one call into `runStaticChecks`, no state, no I/O beyond the
 *  synchronous parse/AST walk — `signal` is accepted for interface conformance (the machine
 *  checks it around every stage call) but never consulted, since there is nothing to cancel. */
export function createCheckStage(): CheckStage {
  return {
    check(source: string, ctx: CheckContext): CheckReport {
      const appliedSchema = ctx.appliedSchema as unknown as AppliedSchema | undefined;
      // Both edit-turn inputs are opt-in by input: `undefined` means "unconstrained" (a new app),
      // never a bug — passing them through untouched is this stage's whole job here.
      const report = runStaticChecks(source, { appliedSchema, previousSurface: ctx.previousSurface });
      // A tint or icon name is never an error and never costs a repair turn (generation-pipeline
      // "The delivered app record is harness-validated"): its warnings are recorded here, by kind,
      // and kept out of the diagnostics the machine's repair policy reads.
      const tile = report.diagnostics.filter((d) => TILE_KINDS.has(d.kind));
      if (tile.length > 0) checkLog.info({ kinds: tile.map((d) => d.kind) }, 'tile names resolved');
      return {
        diagnostics: report.diagnostics.filter((d) => !TILE_KINDS.has(d.kind)).map(toWireDiagnostic),
        manifest: report.manifest ? toCheckedManifest(report.manifest) : undefined,
      };
    },
  };
}

/**
 * Treats a supplied `app.source` as absent unless it (1) parses with no `parse_error` and (2)
 * declares a default-exported `defineApp({...})` call — approximated, without a second checker
 * entry point, as: no `parse_error`, AND (`manifest` extracted OR a `manifest_not_static`
 * diagnostic was raised — the manifest-extraction pass's only two outcomes once a `defineApp`
 * default export was found at all; a source with NO such export produces neither, by design —
 * `checks/passes/manifest-extraction.ts`'s documented "missing ⇒ silently skipped" case, which is
 * exactly a compiled bundle's shape). Returns `source` unchanged on success, `undefined` — never
 * a throw — on failure, so a caller can drop it in place of `GenerateRequest.app.source`.
 */
export function preflightSource(source: string | undefined): string | undefined {
  if (source === undefined) return undefined;
  const report = runStaticChecks(source);
  if (report.diagnostics.some((d) => d.kind === 'parse_error')) return undefined;
  const hasDefineApp = report.manifest !== undefined || report.diagnostics.some((d) => d.kind === 'manifest_not_static');
  return hasDefineApp ? source : undefined;
}
