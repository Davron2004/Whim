/**
 * Text order as SQLite's BINARY collation and Firestore sort it: by UTF-8 bytes (code point order),
 * never by locale. JS `<` compares UTF-16 code units, which puts an astral character before
 * U+E000–U+FFFF, so every in-process sort that must match a store's order goes through here.
 */
export function byUtf8Bytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}
