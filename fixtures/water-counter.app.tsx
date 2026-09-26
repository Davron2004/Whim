// ─────────────────────────────────────────────────────────────────────────────
// water-counter — the capability-bridge v0.2 acceptance mini-app (§15.3: "a tracker
// becomes a genuine app"). Hand-written; the agent/server is later.
// ─────────────────────────────────────────────────────────────────────────────
// Imports ONLY from `vc-sdk`, declares `capabilities: ['storage']` + a `schema`, and persists
// real user data across a process kill through syscalls (kv for the running count, records for
// a per-glass history). This is the §15.2 acceptance: increment, kill the app, relaunch, count
// intact. The bundle never sees SQL, the engine, or the host — only the typed `storage` facade,
// which rides the one-way syscall transport.
import {
  defineApp,
  Screen,
  Stack,
  Row,
  Heading,
  Text,
  Button,
  useState,
  useEffect,
  storage,
  type SchemaArtifact,
} from 'vc-sdk';

// The declared storage shape (burned ids per #38/D3). The build extracts this into the host-
// held app record; the engine opens it before this bundle runs (D7).
const SCHEMA: SchemaArtifact = {
  schemaVersion: 1,
  collections: {
    Drinks: { id: 'c1', tombstones: [], fields: { at: { id: 'f1', type: 'date' } } },
  },
};

function Home() {
  const [total, setTotal] = useState(0);
  const [history, setHistory] = useState(0);
  // The line under the title speaks to the person using the app. It changes only once the reads
  // or the writes have landed, which is what the release upgrade check waits on.
  const [status, setStatus] = useState('Loading…');

  // Load the persisted count + history on mount (the cross-restart proof: this is what shows
  // the count survived a kill).
  useEffect(() => {
    let live = true;
    (async () => {
      const saved = await storage.kv.get('total');
      const drinks = await storage.records.list('Drinks');
      if (!live) return;
      setTotal(typeof saved === 'number' ? saved : 0);
      setHistory(drinks.length);
      setStatus('Tap a button after each glass.');
    })().catch(() => {
      // A read that fails is told to the person on the status line.
      if (live) setStatus('Couldn’t load your saved glasses.');
    });
    return () => {
      live = false;
    };
  }, []);

  const add = async (count: number) => {
    const previous = total;
    const next = previous + count;
    setTotal(next); // optimistic; the syscall persists it
    let kvSaved = false;
    let landed = 0;
    const save = async () => {
      await storage.kv.set('total', next);
      kvSaved = true;
      for (let i = 0; i < count; i++) {
        await storage.records.append('Drinks', { at: Date.now() });
        landed++;
      }
    };
    await save()
      .then(() => {
        setHistory((h) => h + landed);
        setStatus('Saved.');
      })
      .catch(() => {
        // A write that fails is told to the person on the status line. If kv.set already
        // landed, `next` is the durable truth, so keep it displayed (reverting here would diverge
        // from what a reload shows). Only undo the optimistic bump if the kv write itself never
        // made it to storage.
        if (!kvSaved) setTotal(previous);
        if (landed > 0) setHistory((h) => h + landed);
        setStatus('Couldn’t save that. Try again.');
      });
  };

  return (
    <Screen padding="lg">
      <Stack gap="lg">
        <Heading size="title">Water Counter</Heading>
        <Text size="caption" color="text-muted">{status}</Text>

        <Row gap="sm">
          <Text color="text-muted">Glasses</Text>
          <Text size="display" color="primary">{String(total)}</Text>
        </Row>
        <Row gap="sm">
          <Text color="text-muted">History entries</Text>
          <Text>{String(history)}</Text>
        </Row>

        <Button label="+1 glass" onPress={() => add(1)} />
        <Button label="+2 glasses" onPress={() => add(2)} />
      </Stack>
    </Screen>
  );
}

export default defineApp({
  name: 'Water Counter',
  initial: 'Home',
  screens: { Home },
  capabilities: ['storage'],
  schema: SCHEMA,
  // Declared, with tip-splitter.app.tsx and style-gallery.app.tsx (#48/#52): "Water Counter" and
  // "Style Gallery" hash to the same appColor(name) palette slot without this. A sky the palette
  // doesn't hold, so no generated app falls back to it.
  tileColor: '#0369a1',
});
