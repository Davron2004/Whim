// ─────────────────────────────────────────────────────────────────────────────
// latency-probe — on-device syscall round-trip measurement (capability-bridge tasks 1.3/6.3).
// ─────────────────────────────────────────────────────────────────────────────
// A real mini-app (not adversarial) that declares `diag` + `storage` and, on mount, times the
// syscall round-trip over the REAL transport: `diag.echo` is the pure pipe round-trip (the
// task-1.3 "no-op echo" baseline, gate + relay only, no engine), and the storage verbs are the
// per-verb numbers. It renders min/median/max on-screen (logcat truncates ~4 KB), so the
// on-device run reads the timing directly and the syscall timeout default (D8) is set from it.
import {
  defineApp,
  Screen,
  Stack,
  Heading,
  Text,
  useState,
  useEffect,
  storage,
  type SchemaArtifact,
} from 'vc-sdk';

const SCHEMA: SchemaArtifact = {
  schemaVersion: 1,
  collections: { Pings: { id: 'c1', tombstones: [], fields: { at: { id: 'f1', type: 'date' } } } },
};

const now = (): number => {
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  return perf && typeof perf.now === 'function' ? perf.now() : Date.now();
};

function stats(xs: number[]): string {
  if (!xs.length) return 'n/a';
  const sorted = xs.slice().sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const r1 = (n: number) => Math.round(n * 100) / 100;
  return `min ${r1(sorted[0])} · med ${r1(med)} · max ${r1(sorted[sorted.length - 1])} ms (n=${xs.length})`;
}

// The diag transport is on `vc-sdk` only via the same syscall pipe; call it directly through
// the global the marshaller installs (the SDK exposes storage; diag is the bare round-trip).
function echo(payload: unknown): Promise<unknown> {
  const t = (globalThis as { __whimSyscall?: { call(m: string, p: Record<string, unknown>): Promise<unknown> } }).__whimSyscall;
  return t ? t.call('diag.echo', { payload }) : Promise.reject(new Error('no transport'));
}

async function timeN(n: number, fn: () => Promise<unknown>): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = now();
    await fn();
    out.push(now() - t0);
  }
  return out;
}

function Home() {
  const [lines, setLines] = useState<string[]>(['measuring…']);

  useEffect(() => {
    (async () => {
      try {
        await echo({ warm: true }); // warm-up
        const result: string[] = [];
        result.push('diag.echo (pure pipe round-trip): ' + stats(await timeN(30, () => echo({ i: 1 }))));
        result.push('kv.set: ' + stats(await timeN(20, () => storage.kv.set('k', 1))));
        result.push('kv.get: ' + stats(await timeN(20, () => storage.kv.get('k'))));
        result.push('records.append: ' + stats(await timeN(20, () => storage.records.append('Pings', { at: Date.now() }))));
        result.push('records.list: ' + stats(await timeN(20, () => storage.records.list('Pings', { limit: 50 }))));
        setLines(result);
      } catch (e) {
        const detail = (e as { detail?: { hint?: string } } | undefined)?.detail;
        setLines(['probe failed: ' + (detail?.hint ?? (e as { message?: string })?.message ?? String(e))]);
      }
    })();
  }, []);

  return (
    <Screen padding="lg">
      <Stack gap="sm">
        <Heading size="title">Latency Probe</Heading>
        <Text size="caption" color="text-muted">syscall round-trip over the real transport</Text>
        {lines.map((l, i) => (
          <Text key={i} size="caption">{l}</Text>
        ))}
      </Stack>
    </Screen>
  );
}

export default defineApp({
  name: 'Latency Probe',
  initial: 'Home',
  screens: { Home },
  capabilities: ['diag', 'storage'],
  schema: SCHEMA,
});
