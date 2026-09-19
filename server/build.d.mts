/** Types for `server/build.mjs`, so TypeScript suites can import it. */
export function bundleServerEntry(options: { entry: string; outfile: string; write?: boolean }): Promise<string[]>;
export function buildRuntimeTree(options: { outDir: string }): Promise<void>;
