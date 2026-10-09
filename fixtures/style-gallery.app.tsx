// ─────────────────────────────────────────────────────────────────────────────
// style-gallery — the SDK's acceptance mini-app and the generator's worked example
// (docs/design/system.md §7.2).
// ─────────────────────────────────────────────────────────────────────────────
// One file, imports ONLY from `vc-sdk`, `capabilities: []` (Tier-0, zero syscalls). It shows every
// component, variant and prop, the disabled, empty and error states, in the places an app would use
// them: a home screen that reaches one screen per topic with `nav`, each a `Screen title` (so the
// header's back control is automatic), one filled button per screen, `danger` beside `secondary`, and
// keyed lists that add and remove rows. It holds no colour of its own: it renders in whichever
// scheme the phone delivers, and its `primary` is its tint.
import {
  defineApp,
  Screen,
  Stack,
  Row,
  Text,
  NumberInput,
  Button,
  useState,
  TextInput,
  Switch,
  Checkbox,
  Slider,
  SegmentedControl,
  Card,
  Divider,
  Spacer,
  Grid,
  Badge,
  ProgressBar,
  List,
  ListItem,
  EmptyState,
  Modal,
  Chart,
  Icon,
  Stepper,
  DateInput,
  Picker,
  toast,
  nav,
  type SeriesPoint,
  type DayPoint,
} from 'vc-sdk';

// ── Seeded demo data (hardcoded, never fetched, never capability-backed) ──────
const weeklySpending: SeriesPoint[] = [
  { label: 'Groceries', value: 128 },
  { label: 'Rent', value: 950 },
  { label: 'Transport', value: 64 },
  { label: 'Dining', value: 87 },
  { label: 'Utilities', value: 142 },
  { label: 'Fun', value: 55 },
  { label: 'Other', value: 33 },
];

const thirtyDayTrend: SeriesPoint[] = Array.from({ length: 30 }, (_, i) => ({
  label: `Day ${i + 1}`,
  value: Math.round(60 + 15 * Math.sin(i / 4) + i * 0.3),
}));

// 12 weeks of sequential calendar dates, so the heatmap (which anchors to the latest date in
// `data`) renders a full grid.
function habitDays(startDate: string, days: number): DayPoint[] {
  const start = new Date(`${startDate}T00:00:00Z`);
  const points: DayPoint[] = [];
  for (let i = 0; i < days; i++) {
    const iso = new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    const value = (i * 7919) % 11 < 7 ? (i * 37) % 4 : 0;
    points.push({ date: iso, value });
  }
  return points;
}

const twelveWeeksOfHabits: DayPoint[] = habitDays('2026-04-20', 84);

interface Walk {
  id: number;
  name: string;
  when: string;
  icon: string;
}

const FIRST_WALKS: Walk[] = [
  { id: 1, name: 'Morning walk', when: 'Oct 9 · 3 laps', icon: 'footprints' },
  { id: 2, name: 'Evening run', when: 'Oct 8 · 5 km', icon: 'activity' },
  { id: 3, name: 'Hill loop', when: 'Oct 6 · 7 km', icon: 'mountain' },
];

const MORE_WALKS: Omit<Walk, 'id'>[] = [
  { name: 'Park lap', when: 'Today · 2 km', icon: 'trees' },
  { name: 'Ride to work', when: 'Today · 9 km', icon: 'bike' },
  { name: 'Beach walk', when: 'Today · 4 km', icon: 'waves' },
];

/** A keyed walk list that grows and shrinks: each row keeps its id, so it can enter and leave. */
function useWalks() {
  const [walks, setWalks] = useState<Walk[]>(FIRST_WALKS);
  const [nextId, setNextId] = useState(FIRST_WALKS.length + 1);
  const add = (walk: Omit<Walk, 'id'>) => {
    setWalks([...walks, { ...walk, id: nextId }]);
    setNextId(nextId + 1);
  };
  const removeLast = () => setWalks(walks.slice(0, -1));
  return { walks, add, removeLast, nextId };
}

// ── Home: one row per topic ───────────────────────────────────────────────────
function Home() {
  return (
    <Screen title="Style Gallery">
      <Stack gap="lg">
        <Text color="text-muted">Every vc-sdk component, variant and state, one topic per screen.</Text>
        <List>
          <ListItem title="Text and buttons" subtitle="Type, colours, icons, buttons" icon="pen-tool" onPress={() => nav.navigate('TextAndButtons')} />
          <ListItem title="Controls" subtitle="Fields, pickers, toggles, sliders" icon="list-checks" onPress={() => nav.navigate('Controls')} />
          <ListItem title="Surfaces" subtitle="Cards, lists, badges, progress, charts" icon="chart-column" onPress={() => nav.navigate('Surfaces')} />
          <ListItem title="Modal and toast" subtitle="A sheet and a passing message" icon="message-circle" onPress={() => nav.navigate('ModalAndToast')} />
        </List>
      </Stack>
    </Screen>
  );
}

// ── Text and buttons ──────────────────────────────────────────────────────────
function TextAndButtons() {
  return (
    <Screen title="Text and buttons">
      <Stack gap="lg">
        <Stack gap="sm">
          <Text size="display">1,284</Text>
          <Text size="title">Title</Text>
          <Text size="subtitle">Subtitle</Text>
          <Text>Body text reads at 17 on both platforms.</Text>
          <Text size="caption" color="text-muted">Caption, for small print and labels.</Text>
        </Stack>

        <Card>
          <Stack gap="sm">
            <Text>text · what you read most</Text>
            <Text color="text-muted">text-muted · the line under it</Text>
            <Text color="primary">primary · the app’s own tint</Text>
            <Row gap="sm">
              <Icon name="check" color="positive" />
              <Text color="positive">positive · Saved</Text>
            </Row>
            <Row gap="sm">
              <Icon name="circle-alert" color="danger" />
              <Text color="danger">danger · Over budget</Text>
            </Row>
            <Row gap="sm">
              <Icon name="triangle-alert" color="warning" />
              <Text color="warning">warning · Due tomorrow</Text>
            </Row>
          </Stack>
        </Card>

        <Card>
          <Stack gap="sm">
            <Row gap="lg">
              <Text weight="regular">Regular</Text>
              <Text weight="medium">Medium</Text>
              <Text weight="semibold">Semibold</Text>
              <Text weight="bold">Bold</Text>
            </Row>
            <Divider />
            <Text align="start">Start-aligned</Text>
            <Text align="center">Centred</Text>
            <Text align="end">End-aligned</Text>
          </Stack>
        </Card>

        <Card>
          <Row gap="lg">
            <Icon name="timer" size="sm" />
            <Icon name="timer" />
            <Icon name="timer" size="lg" />
            <Spacer />
            <Icon name="coffee" color="text-muted" />
            <Icon name="heart" color="primary" label="Favourite" />
          </Row>
        </Card>

        <Card>
          <Stack gap="md">
            <Stack gap="xs">
              <Text size="subtitle">This week</Text>
              <Text size="caption" color="text-muted">3 walks · 9.4 km of 15 km</Text>
            </Stack>
            <ProgressBar value={0.62} />
            <Button label="Start a walk" icon="footprints" onPress={() => toast('Walk started')} />
          </Stack>
        </Card>

        <Grid columns={2}>
          <Button label="Edit goal" variant="secondary" />
          <Button label="Share" variant="ghost" icon="share" />
        </Grid>

        <Card>
          <Stack gap="md">
            <Stack gap="none">
              <Text>All walks</Text>
              <Text size="caption" color="text-muted">42 saved</Text>
            </Stack>
            <Row gap="sm">
              <Button label="Export" variant="secondary" />
              <Button label="Delete all" variant="danger" icon="trash-2" />
            </Row>
          </Stack>
        </Card>

        <Card>
          <Row justify="between">
            <Stack gap="none">
              <Text>Sync</Text>
              <Text size="caption" color="text-muted">Needs a connection</Text>
            </Stack>
            <Button label="Sync now" variant="secondary" disabled />
          </Row>
        </Card>
      </Stack>
    </Screen>
  );
}

// ── Controls ──────────────────────────────────────────────────────────────────
function Controls() {
  const [name, setName] = useState('');
  const [distance, setDistance] = useState(4.5);
  const [day, setDay] = useState<number | null>(null);
  const [start, setStart] = useState<number | null>(() => new Date().setHours(7, 30, 0, 0));
  const [due, setDue] = useState<number | null>(() => Date.now());
  const [kind, setKind] = useState('');
  const [laps, setLaps] = useState(3);
  const [hours, setHours] = useState(1.5);
  const [remind, setRemind] = useState(true);
  const [stretch, setStretch] = useState(true);
  const [water, setWater] = useState(false);
  const [pace, setPace] = useState(58);
  const [effort, setEffort] = useState('Steady');
  const missingName = name.trim() === '';

  return (
    <Screen title="Controls">
      <Stack gap="lg">
        <Stack gap="xs">
          <TextInput label="Name" value={name} placeholder="Morning walk" onChange={setName} />
          {missingName ? (
            <Row gap="xs">
              <Icon name="circle-alert" size="sm" color="danger" />
              <Text size="caption" color="danger">Give the walk a name to save it</Text>
            </Row>
          ) : null}
        </Stack>
        <NumberInput label="Distance (km)" value={distance} min={0} step={0.5} onChange={setDistance} />
        <DateInput label="Day" value={day} onChange={setDay} />
        <Grid columns={2}>
          <DateInput label="Start" mode="time" value={start} onChange={setStart} />
          <Picker
            label="Kind"
            options={['Walk', 'Run', 'Hike', 'Ride', 'Swim']}
            value={kind}
            placeholder="Pick a kind"
            onChange={setKind}
          />
        </Grid>
        <DateInput label="Next walk" mode="datetime" value={due} onChange={setDue} />

        <Card>
          <Stack gap="sm">
            <Stepper label="Laps" value={laps} min={0} max={8} onChange={setLaps} />
            <Row justify="between">
              <Text>Hours</Text>
              <Stepper value={hours} min={0.5} max={12} step={0.5} onChange={setHours} />
            </Row>
          </Stack>
        </Card>

        <Card>
          <Stack gap="none">
            <Switch label="Remind me" value={remind} onChange={setRemind} />
            <Checkbox label="Stretch first" checked={stretch} onChange={setStretch} />
            <Checkbox label="Bring water" checked={water} onChange={setWater} />
          </Stack>
        </Card>

        <Card>
          <Slider label="Pace" value={pace} min={0} max={100} onChange={setPace} />
        </Card>

        <SegmentedControl options={['Easy', 'Steady', 'Fast']} value={effort} onChange={setEffort} />

        <Button label="Save walk" icon="check" disabled={missingName} onPress={() => toast(`${name.trim()} saved`)} />
      </Stack>
    </Screen>
  );
}

// ── Surfaces ──────────────────────────────────────────────────────────────────
function Surfaces() {
  const { walks, add, removeLast, nextId } = useWalks();
  const [starred, setStarred] = useState(false);
  const addWalk = () => add(MORE_WALKS[nextId % MORE_WALKS.length]);

  return (
    <Screen title="Surfaces" action={{ icon: 'plus', label: 'Add a walk', onPress: addWalk }}>
      <Stack gap="lg">
        <Card>
          <Stack gap="md">
            <Row gap="sm">
              <Badge label="Neutral" tone="neutral" />
              <Badge label="Primary" tone="primary" />
              <Badge label="Done" tone="positive" />
              <Badge label="Due soon" tone="warning" />
              <Badge label="Missed" tone="danger" />
            </Row>
            <ProgressBar value={0.62} label="9.4 of 15 km" />
            <ProgressBar value={1} tone="positive" label="Sleep goal met" />
            <ProgressBar value={0.8} tone="warning" label="80% of the budget" />
            <ProgressBar value={1} tone="danger" label="Over by 12" />
          </Stack>
        </Card>

        <Grid columns={2}>
          <Card>
            <ProgressBar variant="ring" value={0.7} label="7" />
          </Card>
          <Card onPress={() => toast('Cards can be tapped')}>
            <Stack gap="xs">
              <Icon name="trophy" color="primary" />
              <Text size="subtitle">Best week</Text>
              <Text size="caption" color="text-muted">Tap the card</Text>
            </Stack>
          </Card>
        </Grid>

        <Stack gap="sm">
          <Text size="subtitle">Walks</Text>
          {walks.length === 0 ? (
            <Card>
              <EmptyState icon="footprints" title="No walks yet" hint="Tap + to add one." />
            </Card>
          ) : (
            <List
              items={walks}
              keyBy="id"
              renderItem={(walk) => <ListItem title={walk.name} subtitle={walk.when} icon={walk.icon} />}
            />
          )}
          <Grid columns={2}>
            <Button label="Add a walk" icon="plus" onPress={addWalk} />
            <Button label="Remove last" variant="secondary" disabled={walks.length === 0} onPress={removeLast} />
          </Grid>
        </Stack>

        <List>
          <ListItem title="Distance" trailing="9.4 km" icon="map-pin" />
          <ListItem title="Goal" trailing="15 km" />
          <ListItem title={starred ? 'Starred' : 'Star this week'} icon="star" onPress={() => setStarred(!starred)} />
        </List>

        <Card>
          <Stack gap="md">
            <Row>
              <Text>Left</Text>
              <Spacer />
              <Text color="text-muted">Right</Text>
            </Row>
            <Divider />
            <Grid columns={3} gap="sm">
              <Text align="center">A</Text>
              <Text align="center">B</Text>
              <Text align="center">C</Text>
            </Grid>
          </Stack>
        </Card>

        <Card>
          <Stack gap="md">
            <Text size="subtitle">Spending by category</Text>
            <Chart kind="bar" data={weeklySpending} tone="primary" showValues />
            <Text size="subtitle">30-day trend</Text>
            <Chart kind="line" data={thirtyDayTrend} tone="positive" />
            <Text size="subtitle">Habit (12 weeks)</Text>
            <Chart kind="heatmap" data={twelveWeeksOfHabits} tone="warning" weeks={12} />
            <Text size="subtitle">No entries</Text>
            <Chart kind="bar" data={[]} />
          </Stack>
        </Card>
      </Stack>
    </Screen>
  );
}

// ── Modal and toast ───────────────────────────────────────────────────────────
function ModalAndToast() {
  const { walks, add } = useWalks();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('Lunch walk');
  const [laps, setLaps] = useState(2);
  const save = () => {
    add({ name: name.trim() || 'Walk', when: `Today · ${laps} laps`, icon: 'footprints' });
    setOpen(false);
    toast('Walk added');
  };

  return (
    <Screen title="Modal and toast" action={{ icon: 'plus', label: 'Add a walk', onPress: () => setOpen(true) }}>
      <Stack gap="lg">
        <Text color="text-muted">The + opens a sheet; saving it adds a row and shows a toast.</Text>
        <List
          items={walks}
          keyBy={(walk) => walk.id}
          renderItem={(walk) => <ListItem title={walk.name} subtitle={walk.when} icon={walk.icon} />}
        />
        <Button label="Show a toast" variant="secondary" onPress={() => toast('Nothing new since this morning')} />
      </Stack>
      <Modal visible={open} title="Add a walk" onClose={() => setOpen(false)}>
        <TextInput label="Name" value={name} onChange={setName} />
        <Card>
          <Stepper label="Laps" value={laps} min={1} max={10} onChange={setLaps} />
        </Card>
        <Button label="Save" onPress={save} />
      </Modal>
    </Screen>
  );
}

export default defineApp({
  name: 'Style Gallery',
  initial: 'Home',
  screens: { Home, TextAndButtons, Controls, Surfaces, ModalAndToast },
  capabilities: [], // Tier-0: manual QA / knip anchor, zero syscalls
  tint: 'purple',
  icon: 'palette',
  // Kept beside `tint` (#48/#52) while the shell still colours tiles from it: purple's light value.
  tileColor: '#662a8d',
});
