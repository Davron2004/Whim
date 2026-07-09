/**
 * static-check-pipeline — public entry (design D8, `handoff/contract.md`).
 *
 * Chain C wires the parse gate + import allowlist + forbidden-global walk (tasks 3.2–4.3).
 * The parse gate runs FIRST and ALONE (req "Parse gate runs first and alone") — on a syntax
 * error the report carries only `parse_error` diagnostics, no later pass runs. Chain D adds
 * the remaining table-driven passes (manifest/capabilities/screens/SDK-lint/schema) to the
 * `PASSES` array below; Chain E is responsible for the final ordering/purity/determinism
 * review (tasks 7.x) — this file stays a straight composition, no pass-internal state leaks
 * across `runStaticChecks` calls (every call parses fresh and starts a new diagnostics array).
 */

import type { AppliedSchema } from '../src/host/storage-engine/schema';
import { CheckReport, Diagnostic } from './contract';
import { parseSource } from './internal/parse';
import { buildContext, Pass } from './internal/scope';
import { importAllowlistPass } from './passes/import-allowlist';
import { forbiddenGlobalsPass } from './passes/forbidden-globals';
import { manifestExtractionPass } from './passes/manifest-extraction';
import { capabilityDirectionsPass } from './passes/capabilities';
import { screenGraphPass } from './passes/screens';
import { sdkLintPass } from './passes/sdk-lint';
import { schemaCheckPass } from './passes/schema-check';

/** Passes that run once the source parses, in order. Manifest extraction runs before the
 *  passes that consume `ctx.manifest` (capabilities/screens/schema). */
const PASSES: readonly Pass[] = [
  importAllowlistPass,
  forbiddenGlobalsPass,
  manifestExtractionPass,
  capabilityDirectionsPass,
  screenGraphPass,
  sdkLintPass,
  schemaCheckPass,
];

export function runStaticChecks(source: string, opts?: { appliedSchema?: AppliedSchema; filename?: string }): CheckReport {
  const { sourceFile, diagnostics: parseDiagnostics } = parseSource(source, opts?.filename);
  if (parseDiagnostics.length > 0) {
    return { ok: false, diagnostics: parseDiagnostics };
  }

  const diagnostics: Diagnostic[] = [];
  const ctx = buildContext(source, sourceFile, (d) => diagnostics.push(d), opts?.appliedSchema);
  for (const pass of PASSES) pass(ctx);

  return { ok: diagnostics.length === 0, diagnostics, manifest: ctx.manifest };
}
