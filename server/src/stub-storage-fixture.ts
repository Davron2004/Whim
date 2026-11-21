/**
 * The stub's storage fixture app (test-only; `WHIM_PIPELINE=stub`, which production refuses to boot).
 * A prompt carrying `[[fixture:storage-v1]]` or `[[fixture:storage-v2]]` (`stub-markers.ts`) makes
 * the stub pipeline deliver this app instead of its day checklist, so a device seeds real
 * storage-engine data through the path a user's app takes: an installed app with its own store,
 * written through the capability bridge. A storage upgrade check (an op-sqlite or React Native
 * upgrade, the release upgrade check) seeds it on the old build, installs the new build over it,
 * and compares the pulled database before and after (`scripts/release/run.mjs storage-dump`).
 *
 * v1 declares two collections covering every field type and writes deterministic rows, edge values
 * included, the first time it opens. v2 renames a field (same id), adds one with a default and
 * burns v1's `legacy` field id (a tombstone), so the store's `_meta` keeps a retired column whose
 * data stays on disk; it writes one more row and one update the first time it opens. Both versions
 * then read everything back and show it, with a digest of the read-back, so the same screen before
 * and after an upgrade is a second witness that the new build reads every value the old one wrote.
 *
 * The source is generated from the data below; mini-app rules apply to it (one file importing only
 * `vc-sdk`, ES2019 without polyfills: no `?.`, `??`, `.at()`).
 */
import type { JsonValue, SchemaArtifact } from '../../src/host/storage-engine/contract';
import type { StorageFixtureVersion } from './stub-markers';

export const STORAGE_FIXTURE_NAME = 'Storage Fixture';

type Row = { [field: string]: JsonValue };

/** What one version writes, once, the first time it opens (guarded by `flag` in KV). */
interface FixtureWrites {
  flag: string;
  Entries: Row[];
  Tags: Row[];
  entryUpdates: { id: number; patch: Row }[];
  kv: [string, JsonValue][];
}

const ENTRIES_V1: SchemaArtifact['collections'][string] = {
  id: 'c1',
  tombstones: [],
  fields: {
    title: { id: 'f1', type: 'text' },
    count: { id: 'f2', type: 'int' },
    amount: { id: 'f3', type: 'float' },
    done: { id: 'f4', type: 'bool' },
    when: { id: 'f5', type: 'date' },
    details: { id: 'f6', type: 'json' },
    legacy: { id: 'f7', type: 'text' },
  },
};

const TAGS: SchemaArtifact['collections'][string] = {
  id: 'c2',
  tombstones: [],
  fields: {
    label: { id: 'f1', type: 'text' },
    weight: { id: 'f2', type: 'float' },
    pinned: { id: 'f3', type: 'bool' },
    added: { id: 'f4', type: 'date' },
  },
};

/** Each version's schema. v2: `count` is renamed `quantity` (same id, no DDL), `note` is added
 *  with a default, and `legacy` (f7) is tombstoned: its id is burned and its column kept. */
export const STORAGE_FIXTURE_SCHEMAS: Readonly<Record<StorageFixtureVersion, SchemaArtifact>> = {
  v1: { schemaVersion: 1, collections: { Entries: ENTRIES_V1, Tags: TAGS } },
  v2: {
    schemaVersion: 1,
    collections: {
      Entries: {
        id: 'c1',
        tombstones: ['f7'],
        fields: {
          title: { id: 'f1', type: 'text' },
          quantity: { id: 'f2', type: 'int' },
          amount: { id: 'f3', type: 'float' },
          done: { id: 'f4', type: 'bool' },
          when: { id: 'f5', type: 'date' },
          details: { id: 'f6', type: 'json' },
          note: { id: 'f8', type: 'text', default: 'none' },
        },
      },
      Tags: TAGS,
    },
  },
};

const WRITES: Readonly<Record<StorageFixtureVersion, FixtureWrites>> = {
  v1: {
    flag: 'seededV1',
    Entries: [
      { title: 'Plain row', count: 1, amount: 0.5, done: false, when: 1767225600000, details: { tags: ['a', 'b'], n: 1 }, legacy: 'legacy one' },
      { title: '', count: 0, amount: 0, done: true, when: 0, details: [], legacy: '' },
      {
        title: 'Grüße, 世界 🌍 "quoted" \\ back\nsecond line',
        count: -42,
        amount: -1e-300,
        done: true,
        when: -86400000,
        details: { nested: { list: [1, 'two', null, true, 2.5] }, emoji: '🎉' },
        legacy: 'ünïcode legacy',
      },
      { title: 'Big numbers', count: 9007199254740991, amount: 1.7976931348623157e308, done: false, when: 8640000000000000, details: 'a json string', legacy: 'legacy four' },
      { title: 'Small numbers', count: -9007199254740991, amount: 0.30000000000000004, done: false, when: -8640000000000000, details: 0, legacy: null },
      { title: null, count: null, amount: null, done: null, when: null, details: null, legacy: null },
      { title: 'Only a title' },
    ],
    Tags: [
      { label: 'alpha', weight: 1, pinned: true, added: 1700000000000 },
      { label: 'βeta', weight: -2.25, pinned: false, added: 1 },
      { label: 'gamma', weight: 1e21 },
    ],
    entryUpdates: [],
    kv: [
      ['counter', 3],
      ['profile', { name: 'Ada', langs: ['en', 'fr'], active: true }],
      ['empty', ''],
      ['nothing', null],
      ['pi', 3.141592653589793],
    ],
  },
  v2: {
    flag: 'seededV2',
    Entries: [{ title: 'Written by v2', quantity: 7, amount: 2.5, done: true, when: 1767312000000, details: { by: 'v2' }, note: 'a v2 note' }],
    Tags: [],
    entryUpdates: [{ id: 1, patch: { note: 'updated by v2' } }],
    kv: [],
  },
};

/** Every KV key either version writes, in the order the read-back reads them. */
const KV_KEYS: readonly string[] = [...new Set([...WRITES.v1.kv, ...WRITES.v2.kv].map(([key]) => key)).add(WRITES.v1.flag).add(WRITES.v2.flag)];

/** The rows and KV entries the two versions write in total, as the read-back counts them. */
export const STORAGE_FIXTURE_TOTALS = {
  rows: WRITES.v1.Entries.length + WRITES.v1.Tags.length + WRITES.v2.Entries.length + WRITES.v2.Tags.length,
  keys: KV_KEYS.length,
};

/** The first line the fixture shows once it has written (or found) its seed and read it back: what
 *  a seed flow waits for (`scripts/release/upgrade-check/seed-storage.yaml`). */
export function storageFixtureStatus(version: StorageFixtureVersion, wrote: boolean): string {
  return wrote ? `Wrote the ${version} seed.` : `The ${version} seed was already there.`;
}

/** The fixture app's source for one version. */
export function storageFixtureSource(version: StorageFixtureVersion): string {
  return `// ${STORAGE_FIXTURE_NAME} ${version}: the stub's test-only storage fixture (server/src/stub-storage-fixture.ts).
import { defineApp, Screen, Stack, Text, useState, useEffect, storage, type SchemaArtifact } from 'vc-sdk';

const SCHEMA: SchemaArtifact = ${JSON.stringify(STORAGE_FIXTURE_SCHEMAS[version])};

const WRITES = ${JSON.stringify(WRITES[version])};

const KV_KEYS: string[] = ${JSON.stringify(KV_KEYS)};

// Writes this version's rows and keys once; the flag is set last.
async function writeOnce(): Promise<boolean> {
  if ((await storage.kv.get(WRITES.flag)) === true) return false;
  for (const row of WRITES.Entries) await storage.records.append('Entries', row);
  for (const row of WRITES.Tags) await storage.records.append('Tags', row);
  for (const update of WRITES.entryUpdates) await storage.records.update('Entries', update.id, update.patch);
  for (const pair of WRITES.kv) await storage.kv.set(pair[0], pair[1]);
  await storage.kv.set(WRITES.flag, true);
  return true;
}

// JSON with every object's keys sorted, so the digest does not depend on key order.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const record = value as { [key: string]: unknown };
    const keys = Object.keys(record).sort((a, b) => (a < b ? -1 : 1));
    return '{' + keys.map((key) => JSON.stringify(key) + ':' + canonical(record[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

// FNV-1a over the UTF-16 code units, as eight hex digits.
function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ('0000000' + (hash >>> 0).toString(16)).slice(-8);
}

interface Reading {
  status: string;
  summary: string;
  lines: string[];
}

async function readBack(wrote: boolean): Promise<Reading> {
  const entries = await storage.records.list('Entries');
  const tags = await storage.records.list('Tags');
  const kv: { [key: string]: unknown } = {};
  for (const key of KV_KEYS) {
    const value = await storage.kv.get(key);
    if (value !== undefined) kv[key] = value;
  }
  const all = { Entries: entries, Tags: tags, kv: kv };
  const lines = entries.map((row) => 'Entries ' + canonical(row))
    .concat(tags.map((row) => 'Tags ' + canonical(row)))
    .concat(Object.keys(kv).map((key) => 'kv ' + key + ' = ' + canonical(kv[key])));
  return {
    status: wrote ? ${JSON.stringify(storageFixtureStatus(version, true))} : ${JSON.stringify(storageFixtureStatus(version, false))},
    summary: 'Read back ' + digest(canonical(all)) + ': ' + (entries.length + tags.length) + ' rows, ' + Object.keys(kv).length + ' keys',
    lines: lines,
  };
}

function Home() {
  const [reading, setReading] = useState<Reading>({ status: 'Reading…', summary: '', lines: [] });

  useEffect(() => {
    let live = true;
    writeOnce()
      .then(readBack)
      .then((next) => {
        if (live) setReading(next);
      })
      .catch((err) => {
        if (live) setReading({ status: 'Storage failed: ' + String(err), summary: '', lines: [] });
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <Screen title="${STORAGE_FIXTURE_NAME}">
      <Stack gap="sm">
        <Text>{reading.status}</Text>
        <Text>{reading.summary}</Text>
        {reading.lines.map((line, i) => (
          <Text key={i} color="text-muted">{line}</Text>
        ))}
      </Stack>
    </Screen>
  );
}

export default defineApp({
  name: '${STORAGE_FIXTURE_NAME}',
  initial: 'Home',
  screens: { Home },
  capabilities: ['storage'],
  schema: SCHEMA,
  tint: 'slate',
  icon: 'folder',
});
`;
}
