// Sleep Log: log the hours slept each night and see the last week against a nightly goal. Nights
// are rows in storage; the goal is a setting kept with storage.kv and changed on its own screen.
import {
  defineApp,
  nav,
  Screen,
  Stack,
  Card,
  Text,
  Slider,
  Stepper,
  DateInput,
  Button,
  ProgressBar,
  Chart,
  toast,
  useState,
  useEffect,
  storage,
  type SchemaArtifact,
} from 'vc-sdk';

const SCHEMA: SchemaArtifact = {
  schemaVersion: 1,
  collections: {
    Nights: {
      id: 'c1',
      tombstones: [],
      fields: {
        night: { id: 'f1', type: 'date' },
        hours: { id: 'f2', type: 'float' },
      },
    },
  },
};

interface Night {
  id: number;
  night: number;
  hours: number;
}

const DEFAULT_GOAL = 8;

const DAY_MS = 24 * 60 * 60 * 1000;

function lastMidnight(): number {
  const d = new Date(Date.now() - DAY_MS);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'short' });
}

async function saveNight(night: number, hours: number): Promise<number> {
  const [existing] = await storage.records.list('Nights', { where: { night }, limit: 1 });
  if (existing === undefined) return (await storage.records.append('Nights', { night, hours })).id;
  await storage.records.update('Nights', existing.id, { hours });
  return existing.id;
}

function Week() {
  const [nights, setNights] = useState<Night[]>([]);
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [night, setNight] = useState<number | null>(lastMidnight());
  const [hours, setHours] = useState(7.5);

  useEffect(() => {
    let live = true;
    (async () => {
      const saved = await storage.kv.get('goal');
      const rows = await storage.records.list('Nights', { orderBy: { field: 'night', direction: 'desc' }, limit: 7 });
      if (!live) return;
      if (typeof saved === 'number') setGoal(saved);
      setNights(rows.map((row) => ({ id: row.id, night: Number(row.night), hours: Number(row.hours) })).reverse());
    })().catch(() => {
      if (live) toast('Couldn’t load your nights.');
    });
    return () => {
      live = false;
    };
  }, []);

  // One row per night: logging a night again corrects it.
  const log = (at: number) => {
    saveNight(at, hours)
      .then((id) => {
        const others = nights.filter((n) => n.night !== at);
        setNights([...others, { id, night: at, hours }].sort((a, b) => a.night - b.night).slice(-7));
        toast(`${hours} h logged`);
      })
      .catch(() => toast('Couldn’t log that night. Try again.'));
  };

  const average = nights.length === 0 ? 0 : nights.reduce((sum, n) => sum + n.hours, 0) / nights.length;

  return (
    <Screen title="Sleep Log" action={{ icon: 'settings', label: 'Nightly goal', onPress: () => nav.navigate('Goal') }}>
      <Stack gap="lg">
        <ProgressBar
          variant="ring"
          value={average / goal}
          tone={average >= goal ? 'positive' : 'primary'}
          label={`${average.toFixed(1)} h`}
        />
        <Text color="text-muted" align="center">
          {nights.length === 0 ? 'No nights logged yet' : `Average of your last ${nights.length} nights · goal ${goal} h`}
        </Text>
        <Chart kind="bar" data={nights.map((n) => ({ label: dayLabel(n.night), value: n.hours }))} maxValue={goal} showValues />
        <Card>
          <Stack>
            <DateInput label="Night of" value={night} onChange={setNight} />
            <Slider label="Hours slept" value={hours} min={0} max={12} step={0.5} onChange={setHours} />
          </Stack>
        </Card>
        <Button label="Log night" icon="bed" disabled={night === null} onPress={() => night !== null && log(night)} />
      </Stack>
    </Screen>
  );
}

function Goal() {
  const [hours, setHours] = useState(DEFAULT_GOAL);

  useEffect(() => {
    let live = true;
    storage.kv
      .get('goal')
      .then((saved) => {
        if (live && typeof saved === 'number') setHours(saved);
      })
      .catch(() => toast('Couldn’t load the goal.'));
    return () => {
      live = false;
    };
  }, []);

  const change = (next: number) => {
    setHours(next);
    storage.kv.set('goal', next).catch(() => toast('Couldn’t save the goal.'));
  };

  return (
    <Screen title="Nightly goal">
      <Stack>
        <Stepper label="Hours a night" value={hours} min={4} max={12} step={0.5} onChange={change} />
        <Text color="text-muted">The ring fills when your weekly average reaches this.</Text>
      </Stack>
    </Screen>
  );
}

export default defineApp({
  name: 'Sleep Log',
  initial: 'Week',
  screens: { Week, Goal },
  capabilities: ['storage'],
  schema: SCHEMA,
  tint: ['indigo', 'violet', 'slate'],
  icon: 'bed',
});
