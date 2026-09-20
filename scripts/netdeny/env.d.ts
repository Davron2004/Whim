/**
 * Ambient surface additions the network-deny canary needs beyond `synthrun/env.d.ts`'s existing
 * `node:http`/`node:net`/`node:dgram` fragments (design D17 "Reproduce first, then prove"; the
 * repo carries no `@types/node` — `scripts/release/env.d.ts` is the precedent). `declare module`
 * blocks and `WhimProcess` merge additively across every `env.d.ts` in the program, so this file
 * adds only the members no existing fragment declares yet: a raw TCP listener on `node:net` (the
 * canary's TLS-port connection counter) and `process.once('SIGINT', …)`.
 */
declare module 'node:net' {
  export interface Socket {
    destroy(): void;
  }
  export interface Server {
    listen(port: number, host: string, callback?: () => void): Server;
    close(callback?: () => void): Server;
    once(event: 'error', listener: (err: Error) => void): Server;
  }
  export function createServer(listener: (socket: Socket) => void): Server;
}

interface WhimProcess {
  once(event: 'SIGINT', listener: () => void): void;
}
