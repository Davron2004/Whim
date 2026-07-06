/**
 * Ambient declarations for the runtime globals the version store relies on. These are
 * native or polyfilled on Hermes (Buffer via the `buffer` package, TextEncoder/Decoder
 * via text-encoding-polyfill — see ./polyfills) and native in Node, but the app's
 * tsconfig pins `types: ["jest"]`, which omits them. Declared here, scoped to the app
 * build; only ADDS the missing names, changing nothing else.
 */

import type { Buffer as NodeBuffer } from 'buffer';

declare global {
  var Buffer: typeof NodeBuffer;

  class TextEncoder {
    encode(input?: string): Uint8Array;
  }
  class TextDecoder {
    constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
    decode(input?: Uint8Array | ArrayBuffer): string;
  }

  namespace NodeJS {
    interface ErrnoException extends Error {
      code?: string;
      errno?: number;
    }
  }
}

export {};
