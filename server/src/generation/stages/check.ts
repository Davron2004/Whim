/**
 * server/src/generation/stages/check.ts — the concrete `CheckStage` (design D12,
 * `handoff/stage-contracts.md`). Wraps `checks/index.ts`'s `runStaticChecks` — the harness's ONE
 * static-checker entry — with the request's applied schema as the diff baseline, and maps its
 * report onto the machine's minimal `CheckReport`/`CheckedManifest` shapes (design D2). The
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
import type { ExtractedManifest } from '../../../../checks/contract';
import type { AppliedSchema } from '../../../../src/host/storage-engine/schema';
import { SHELL_COLORS, STATUS_COLORS, STATUS_COLORS_ON_INK } from '../../../../src/sdk/theme';
import type { CheckContext, CheckedManifest, CheckReport, CheckStage } from '../machine';
import type { Diagnostic } from '@whim/contract';

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

/** The hues a generated app may never claim as its own — the three status meanings (on both
 *  backgrounds), the shell accent, and the `yours` brown. Read from the SDK's token module, never
 *  re-typed here, so a token edit can never leave this gate asserting a stale palette. */
const RESERVED_HUES: ReadonlySet<string> = new Set(
  [
    ...Object.values(STATUS_COLORS),
    ...Object.values(STATUS_COLORS_ON_INK),
    SHELL_COLORS.accent,
    SHELL_COLORS.yours,
    SHELL_COLORS.yoursOnDark,
  ].map((hex) => hex.toLowerCase()),
);

/**
 * The declared tile colour, or `undefined` when there is effectively no declaration. Dropped —
 * never repaired, never reported — when it is not a `#rrggbb` literal or when it collides with a
 * reserved shell hue (spec "A reserved or malformed colour is dropped": the host must not be handed
 * a colour it would only reject). A surviving value is passed through VERBATIM, casing included.
 */
function validTileColor(declared: string | undefined): string | undefined {
  if (declared === undefined) return undefined;
  if (!HEX_COLOR_RE.test(declared)) return undefined;
  return RESERVED_HUES.has(declared.toLowerCase()) ? undefined : declared;
}

/** `ExtractedManifest` (checker) → `CheckedManifest` (machine/wire): `name`/`schema` are pulled
 *  out to their own `WireAppRecord` top-level fields (design D12), so `manifest` here carries the
 *  rest (`initial`/`screens`/`capabilities`/`tileColor`) — a strict superset of the bridge gate's
 *  own `AppManifest.capabilities` read, so the cast on the device side stays sound.
 *
 *  `tileColor` rides INSIDE `manifest` (design D4, decision #41 D4's "no second source of truth"):
 *  it comes only from the one `defineApp` extraction above, and `assembleRecord` passes `manifest`
 *  through untouched — there is no top-level `WireAppRecord.tileColor` to keep in sync. */
function toCheckedManifest(m: ExtractedManifest): CheckedManifest {
  const { name, schema, tileColor, ...rest } = m;
  const validated = validTileColor(tileColor);
  return {
    name,
    manifest: { ...rest, ...(validated !== undefined ? { tileColor: validated } : {}) } as Record<string, unknown>,
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

/** The production `CheckStage`: one call into `runStaticChecks`, no state, no I/O beyond the
 *  synchronous parse/AST walk — `signal` is accepted for interface conformance (the machine
 *  checks it around every stage call) but never consulted, since there is nothing to cancel. */
export function createCheckStage(): CheckStage {
  return {
    check(source: string, ctx: CheckContext): CheckReport {
      const appliedSchema = ctx.appliedSchema as unknown as AppliedSchema | undefined;
      const report = runStaticChecks(source, { appliedSchema });
      return {
        diagnostics: report.diagnostics.map(toWireDiagnostic),
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
