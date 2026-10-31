/** Types for only-filter.mjs (see there): `--only <pattern>` for the Node suite runners. */
export declare function parseOnly(argv?: string[]): string[] | null;
export declare function matchesOnly(patterns: string[], name: string, fnName?: string): boolean;
export declare function requireMatched(patterns: string[], kept: string[], available: string[], unmatched?: string[]): void;
export declare function filterSource(
  source: string,
  patterns: string[],
  fileName?: string,
): Promise<{ code: string; kept: string[]; dropped: string[]; unmatched: string[] }>;
export declare function entryFilter(
  entry: string,
  patterns: string[],
): { plugin: import('esbuild').Plugin; assertMatched(): void };
