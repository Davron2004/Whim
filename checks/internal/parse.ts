/**
 * static-check-pipeline — parse gate (design D2, task 3.2).
 *
 * Syntactic-only: a single `ts.createSourceFile` call, no `ts.createProgram`, no semantic
 * pass (rationale: `docs/...design.md` D2 — deterministic, fast, immune to the
 * moving-SDK-types problem). The bundle contract (spike2/#37) is one TS file with classic
 * JSX, so the source is always parsed as TSX.
 */

import ts from 'typescript';
import { Diagnostic } from '../contract';

export interface ParseResult {
  sourceFile: ts.SourceFile;
  /** `parse_error` diagnostics, original-source line/column, empty when the source parses. */
  diagnostics: Diagnostic[];
}

/** Internal shape of the field the TS parser stashes syntax errors on (not in the public
 *  `.d.ts` surface, but stable across the TS versions this repo targets — see task 3.2). */
interface SourceFileWithParseDiagnostics extends ts.SourceFile {
  parseDiagnostics?: readonly ts.DiagnosticWithLocation[];
}

function toDiagnostic(sourceFile: ts.SourceFile, d: ts.DiagnosticWithLocation): Diagnostic {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(d.start);
  return {
    kind: 'parse_error',
    severity: 'error',
    line: line + 1,
    column: character + 1,
    message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
    hint: 'Fix the TypeScript syntax error on this line before the checker can analyze the file.',
  };
}

export function parseSource(source: string, filename = 'app.tsx'): ParseResult {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  ) as SourceFileWithParseDiagnostics;
  const raw = sourceFile.parseDiagnostics ?? [];
  const diagnostics = raw.map((d) => toDiagnostic(sourceFile, d));
  return { sourceFile, diagnostics };
}
