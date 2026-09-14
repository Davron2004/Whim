/**
 * Ambient surface for the small slice of Node's built-in modules this library and its Node
 * acceptance suite use. Declared locally so the project needs no `@types/node` dependency
 * (mirrors `src/host/storage-engine/env.d.ts`'s identical precedent/rationale) — the
 * device/runtime bundles never import this module and are unaffected.
 */
declare module 'node:fs/promises' {
  export function readFile(path: string, encoding: 'utf8'): Promise<string>;
  export function writeFile(path: string, data: string, encoding: 'utf8'): Promise<void>;
  export function mkdtemp(prefix: string): Promise<string>;
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
}
declare module 'node:os' {
  export function tmpdir(): string;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
  export function relative(from: string, to: string): string;
}

// The egress probe (`session.ts`) and the isolation suite's loopback canaries (`test/isolation.ts`).
declare module 'node:net' {
  export interface AddressInfo {
    address: string;
    family: string;
    port: number;
  }
}
declare module 'node:http' {
  import type { AddressInfo } from 'node:net';
  export interface IncomingMessage {
    url?: string;
  }
  export interface ServerResponse {
    end(body?: string): void;
  }
  export interface Server {
    on(event: 'connection', listener: () => void): Server;
    once(event: 'error', listener: (err: Error) => void): Server;
    listen(port: number, host: string, callback: () => void): Server;
    address(): AddressInfo | string | null;
    closeAllConnections(): void;
    close(callback?: () => void): Server;
  }
  export function createServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Server;
}
declare module 'node:dgram' {
  import type { AddressInfo } from 'node:net';
  export interface Socket {
    on(event: 'message', listener: () => void): Socket;
    bind(port: number, host: string, callback: () => void): void;
    address(): AddressInfo;
    close(callback?: () => void): void;
  }
  export function createSocket(type: 'udp4'): Socket;
}
declare module 'node:fs' {
  export interface Dirent {
    name: string;
    isDirectory(): boolean;
  }
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readdirSync(path: string, options: { withFileTypes: true }): Dirent[];
}
declare module 'node:child_process' {
  export function execFileSync(file: string, args: string[], options: { encoding: 'utf8' }): string;
}

// `process.cwd()` (repo-root path resolution, `builder.ts`/`page.ts`) and `process.exit()`
// (the Node acceptance suite's non-zero-exit-on-failure idiom, `test/acceptance.ts`).
interface WhimProcess {
  cwd(): string;
  exit(code?: number): never;
}
declare const process: WhimProcess;

// Node's global WebCrypto (available since Node 19+) — used for run-id generation
// (`session.ts`), never for anything security-sensitive.
interface WhimCrypto {
  randomUUID(): string;
}
declare const crypto: WhimCrypto;
