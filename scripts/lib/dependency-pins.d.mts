/** Types for dependency-pins.mjs (see there): the pin register and its offline check. */
export interface PinEntry {
  package: string;
  range: string;
  reason: string;
  lift: string;
}
export interface Workspace {
  dir: string;
  manifest: { name?: string; workspaces?: string[]; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
}
export interface DeclaredDependency {
  workspace: string;
  name: string;
  spec: string;
}
export declare const PIN_REGISTER_FILE: string;
export declare function compareVersions(a: string, b: string): number;
export declare function satisfies(version: string, range: string): boolean;
export declare function readWorkspaces(root: string): Workspace[];
export declare function declaredDependencies(workspaces: Workspace[]): DeclaredDependency[];
export declare function resolvedVersion(lock: { packages?: Record<string, { version?: string; link?: boolean }> }, workspace: string, name: string): string | null;
export declare function readPinRegister(root: string): PinEntry[];
export declare function pinRegisterFindings(root: string): string[];
