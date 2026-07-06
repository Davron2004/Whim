// ─────────────────────────────────────────────────────────────────────────────
// THROWAWAY ADVERSARIAL FIXTURE — the SQL INJECTOR (capability-bridge task 4.5).
//
// Unlike evil/poison (sandbox-escape) and cap-intruder (gate evasion), this app plays BY the
// rules: it DECLARES storage and drives the legitimate verbs — but with adversarial input. It
// proves the engine's parameterization/identifier-mapping (the #40 D5a injection invariant)
// holds end-to-end through a genuinely hostile bundle over the real sandbox→syscall→engine
// path, not just at the engine API. The authoritative engine-direct proof lives in
// `storage:test`; this is the through-the-bridge complement (design D8).
//
// It asserts, on-screen and in a machine-readable summary line:
//   • SQL metacharacters in record VALUES / kv keys+values / where VALUES round-trip
//     byte-identical (bound, never interpolated) → zero injections land.
//   • crafted COLLECTION / FIELD / orderBy identifiers are rejected as structured
//     unknown_collection / unknown_field errors (mapped through the schema or refused, never
//     concatenated) → no DROP/forged read.
// ─────────────────────────────────────────────────────────────────────────────
import { defineApp, Screen, Stack, Heading, Text, useState, useEffect, storage } from 'vc-sdk';

const SCHEMA: any = {
  schemaVersion: 1,
  collections: {
    Notes: { id: 'c1', tombstones: [], fields: { body: { id: 'f1', type: 'text' }, n: { id: 'f2', type: 'int' } } },
  },
};

const ADVERSARIAL: string[] = [
  `'); DROP TABLE c1;--`,
  `" OR "1"="1`,
  `'; DELETE FROM kv; --`,
  `; ATTACH DATABASE 'x' AS y; --`,
  `Robert'); DROP TABLE students;--`,
];

interface Line { label: string; ok: boolean; detail: string; }

function Home() {
  const [lines, setLines] = useState<Line[]>([]);
  const [summary, setSummary] = useState('running…');

  useEffect(() => {
    const out: Line[] = [];
    let landed = 0;
    const add = (label: string, ok: boolean, detail: string) => {
      if (!ok) landed++;
      out.push({ label, ok, detail });
    };

    (async () => {
      // (a) metacharacter VALUES round-trip byte-identical (bound parameters).
      for (const evil of ADVERSARIAL) {
        try {
          const { id } = await storage.records.append('Notes', { body: evil, n: 1 });
          const back = await storage.records.list('Notes', { where: { body: evil } });
          const exact = back.length === 1 && back[0].body === evil;
          add('value round-trip ' + JSON.stringify(evil).slice(0, 18), exact, exact ? 'inert literal' : 'MUTATED/!=');
          await storage.records.remove('Notes', id);
        } catch (e: any) {
          add('value round-trip', false, 'threw ' + (e && e.detail && e.detail.kind));
        }
      }

      // (b) adversarial kv key+value round-trip.
      for (const evil of ADVERSARIAL) {
        try {
          await storage.kv.set(evil, evil);
          const got = await storage.kv.get(evil);
          add('kv round-trip ' + JSON.stringify(evil).slice(0, 14), got === evil, got === evil ? 'inert' : 'MUTATED');
          await storage.kv.remove(evil);
        } catch (e: any) {
          add('kv round-trip', false, 'threw ' + (e && e.detail && e.detail.kind));
        }
      }

      // (c) crafted COLLECTION name → structured unknown_collection (no SQL built).
      try {
        await storage.records.append(ADVERSARIAL[0], { body: 'x' });
        add('crafted collection', false, '⚠ NOT rejected');
      } catch (e: any) {
        const k = e && e.detail && e.detail.kind;
        add('crafted collection', k === 'unknown_collection', 'rejected: ' + k);
      }

      // (d) crafted FIELD names (append + where + orderBy) → structured unknown_field.
      try {
        await storage.records.append('Notes', { [ADVERSARIAL[1]]: 1 } as any);
        add('crafted append field', false, '⚠ NOT rejected');
      } catch (e: any) {
        const k = e && e.detail && e.detail.kind;
        add('crafted append field', k === 'unknown_field', 'rejected: ' + k);
      }
      try {
        await storage.records.list('Notes', { where: { [ADVERSARIAL[2]]: 1 } as any });
        add('crafted where field', false, '⚠ NOT rejected');
      } catch (e: any) {
        const k = e && e.detail && e.detail.kind;
        add('crafted where field', k === 'unknown_field', 'rejected: ' + k);
      }
      try {
        await storage.records.list('Notes', { orderBy: { field: ADVERSARIAL[3], direction: 'asc' } });
        add('crafted orderBy field', false, '⚠ NOT rejected');
      } catch (e: any) {
        const k = e && e.detail && e.detail.kind;
        add('crafted orderBy field', k === 'unknown_field', 'rejected: ' + k);
      }

      setLines(out);
      setSummary(landed === 0 ? 'INJECTIONS LANDED: 0 ✓ (values inert, identifiers rejected)' : 'INJECTIONS LANDED: ' + landed + ' ✗');
    })();
  }, []);

  return (
    <Screen padding="lg">
      <Stack gap="sm">
        <Heading size="title">SQL INJECTOR — through-bridge pen test</Heading>
        <Text size="caption" color={summary.indexOf('0 ✓') !== -1 ? 'primary' : 'text-muted'}>{summary}</Text>
        {lines.map((l, i) => (
          <Text key={i} size="caption">{(l.ok ? '✓ ' : '✗ ') + l.label + ': ' + l.detail}</Text>
        ))}
      </Stack>
    </Screen>
  );
}

export default defineApp({ name: 'SQL Injector', initial: 'Home', screens: { Home }, capabilities: ['storage'], schema: SCHEMA });
