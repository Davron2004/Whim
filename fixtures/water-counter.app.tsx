// Water Counter: counts glasses of water and keeps every glass as a dated row, so the count and
// its history are still there the next time the app opens.
import { defineApp, Screen, Stack, Row, Card, Text, Button, useState, useEffect, storage, type SchemaArtifact } from 'vc-sdk';

const SCHEMA: SchemaArtifact = {
  schemaVersion: 1,
  collections: {
    Drinks: { id: 'c1', tombstones: [], fields: { at: { id: 'f1', type: 'date' } } },
  },
};

// The running total, and one dated row per glass.
async function saveGlasses(total: number, count: number): Promise<void> {
  await storage.kv.set('total', total);
  for (let i = 0; i < count; i++) {
    await storage.records.append('Drinks', { at: Date.now() });
  }
}

function Home() {
  const [total, setTotal] = useState(0);
  const [history, setHistory] = useState(0);
  const [status, setStatus] = useState('Loading…');

  // Read the saved count and history once, when the screen opens.
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
      if (live) setStatus('Couldn’t load your saved glasses.');
    });
    return () => {
      live = false;
    };
  }, []);

  // Show the new count at once, then save it.
  const add = (count: number) => {
    const next = total + count;
    setTotal(next);
    saveGlasses(next, count)
      .then(() => {
        setHistory((h) => h + count);
        setStatus('Saved.');
      })
      .catch(() => setStatus('Couldn’t save that. Try again.'));
  };

  return (
    <Screen title="Water Counter">
      <Stack gap="lg">
        <Text color="text-muted">{status}</Text>
        <Card>
          <Stack>
            <Row justify="between">
              <Text>Glasses</Text>
              <Text size="display" color="primary">{String(total)}</Text>
            </Row>
            <Row justify="between">
              <Text color="text-muted">History entries</Text>
              <Text color="text-muted">{String(history)}</Text>
            </Row>
          </Stack>
        </Card>
        <Row>
          <Button label="+1 glass" icon="glass-water" onPress={() => add(1)} />
          <Button label="+2 glasses" variant="secondary" onPress={() => add(2)} />
        </Row>
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
  tint: ['blue', 'ocean'],
  icon: 'glass-water',
  // A legacy colour, kept only until the home screen draws `tint`. New apps never declare it.
  tileColor: '#0369a1',
});
