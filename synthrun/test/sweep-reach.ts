/**
 * synthrun-reach: the sweep acts on what can receive the action, drives native controls, and reads
 * the screen only once the candidate has gone quiet. The assertions are on behavior: which
 * fingerprints were acted on and in what order (`actionsLog`), the report's counts, the syscall
 * trace and the effect a candidate shows only after it received the action. None of them reads a
 * wall-clock duration.
 */
import nodeAssert from 'node:assert';
import { awaitMount, mergeBudgets } from '../observe';
import type { RunBudgets } from '../contract';
import { createRunCandidate } from '../report';
import { SynthRunSession } from '../session';
import { findAppFrame, sweepApp, type SweepOptions, type SweepResult } from '../sweep';
import { createEngine } from '../../src/host/storage-engine/engine';
import { createNodeSqlExecutor } from '../../src/host/storage-engine/bindings/node-sqlite';
import type { StorageEngine } from '../../src/host/storage-engine/contract';
import type { CapabilityWiring } from '../capability';
import { recordAssertion, test } from './harness';
import { flowbenchApp } from './flowbench';
import { openWiredRun, within } from './support';

function ok(cond: boolean, msg: string): void {
  recordAssertion(() => nodeAssert.ok(cond, msg), msg);
}

/** Short quiet budgets for the hand-written fixtures; the hard cap is generous because it also
 *  bounds the wait for a Modal sheet's spring (~0.6 s), which is not a quiet-window matter. */
const FIXTURE_BUDGETS = mergeBudgets({ mountBudgetMs: 5000, actionQuietMs: 40, actionHardCapMs: 2000 });
/** For candidates whose next step follows an async hop (a storage reply, a toast): a quiet window
 *  shorter than a hop on a loaded machine reads the screen before it has finished changing. */
const ASYNC_BUDGETS = mergeBudgets({ mountBudgetMs: 5000, actionQuietMs: 150, actionHardCapMs: 2000 });
/** The production quiet window. It is what a reply opens, so a step that follows a reply by a few
 *  hundred milliseconds (`NAVIGATE_BEAT_MS`, the gap between two dependent calls) still lands
 *  inside it on a loaded machine. */
const REPLY_BUDGETS = mergeBudgets({ mountBudgetMs: 5000, actionQuietMs: 300, actionHardCapMs: 2000 });

const SWEEP_TIMEOUT_MS = 60_000;

interface SweepOutcome {
  result: SweepResult;
  wiring: CapabilityWiring;
  /** The visible text of the app frame once the sweep ended. */
  text: string;
}

async function runSweep(
  session: SynthRunSession,
  source: string,
  options: { budgets?: RunBudgets; engineFactory?: () => StorageEngine; sweep?: SweepOptions } = {},
): Promise<SweepOutcome> {
  const budgets = options.budgets ?? FIXTURE_BUDGETS;
  const { ctx, obs, wiring, dispose } = await openWiredRun(session, source, { engineFactory: options.engineFactory });
  try {
    await within(awaitMount(obs, budgets), 10_000, 'the mount gate');
    const result = await within(sweepApp(ctx, obs, source, budgets, options.sweep), SWEEP_TIMEOUT_MS, 'the sweep');
    const frame = await findAppFrame(ctx.page);
    const text = await frame.evaluate(() => (globalThis as unknown as { document: { body: { innerText: string } } }).document.body.innerText);
    return { result, wiring, text };
  } finally {
    await dispose();
  }
}

function labels(result: SweepResult): string[] {
  return result.actionsLog.map((el) => el.label);
}

/** What was acted on, in order, as `kind:label` joined by commas. */
function signature(result: SweepResult): string {
  return result.actionsLog.map((el) => el.kind + ':' + el.label).join(',');
}

function describe(result: SweepResult): string {
  const acted = result.actionsLog.map((el) => el.kind + ':' + el.label).join(' ; ');
  return `acted on: ${acted}; sweep ${JSON.stringify(result.sweep)}`;
}

/** Polls until `predicate` holds or `budgetMs` passes, then reports whether it held. */
async function holds(predicate: () => boolean, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (!predicate() && Date.now() < deadline) await new Promise<void>((resolve) => setTimeout(resolve, 15));
  return predicate();
}

// ── fixtures ────────────────────────────────────────────────────────────────────────────────

// "Second" lies under the open Modal's scrim when the sweep reaches it. The Modal closes only once
// "Inside" has armed it, so the Modal's own controls have to be used before it can be dismissed.
// "Inside" sorts before "Second", so a sweep that does not look at what covers "Second" presses it
// while the scrim is over it.
const FIXTURE_UNDER_MODAL = `import { defineApp, Screen, Stack, Heading, Text, Button, Modal, useState } from 'vc-sdk';
function Home() {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [pressed, setPressed] = useState(false);
  return (
    <Screen>
      <Stack>
        <Heading size="title">Cover</Heading>
        <Button label="Open sheet" onPress={() => setOpen(true)} />
        <Button label="Second" onPress={() => setPressed(true)} />
        <Text>{pressed ? 'Second was pressed' : 'Second is waiting'}</Text>
      </Stack>
      <Modal visible={open} title="Sheet" onClose={() => { if (armed) setOpen(false); }}>
        <Stack><Button label="Inside" onPress={() => setArmed(true)} /></Stack>
      </Modal>
    </Screen>
  );
}
export default defineApp({ name: 'UnderModal', initial: 'Home', screens: { Home }, capabilities: [] });
`;

// As above, and "Second" reopens the Modal, which then covers "Third" with every one of its own
// fingerprints already visited. Only dismissing the same backdrop a second time reaches "Third".
const FIXTURE_REOPENED_MODAL = `import { defineApp, Screen, Stack, Text, Button, Modal, useState } from 'vc-sdk';
function Home() {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [third, setThird] = useState(false);
  return (
    <Screen>
      <Stack>
        <Button label="Open sheet" onPress={() => setOpen(true)} />
        <Button label="Second" onPress={() => setOpen(true)} />
        <Button label="Third" onPress={() => setThird(true)} />
        <Text>{third ? 'Third was pressed' : 'Third is waiting'}</Text>
      </Stack>
      <Modal visible={open} title="Sheet" onClose={() => { if (armed) setOpen(false); }}>
        <Stack><Button label="Inside" onPress={() => setArmed(true)} /></Stack>
      </Modal>
    </Screen>
  );
}
export default defineApp({ name: 'ReopenedModal', initial: 'Home', screens: { Home }, capabilities: [] });
`;

// A Modal that never closes covers the two buttons beneath it for the whole run.
const FIXTURE_STUCK_MODAL = `import { defineApp, Screen, Stack, Button, Modal } from 'vc-sdk';
function Home() {
  return (
    <Screen>
      <Stack>
        <Button label="Under 1" onPress={() => {}} />
        <Button label="Under 2" onPress={() => {}} />
      </Stack>
      <Modal visible title="Stuck" onClose={() => {}}>
        <Stack><Button label="Inside" onPress={() => {}} /></Stack>
      </Modal>
    </Screen>
  );
}
export default defineApp({ name: 'StuckModal', initial: 'Home', screens: { Home }, capabilities: [] });
`;

// A button that stays disabled for the whole run, and a Stepper resting on its lower bound (its
// decrement button is disabled), between enabled buttons.
const FIXTURE_DISABLED = `import { defineApp, Screen, Stack, Button, Stepper } from 'vc-sdk';
function Home() {
  return (
    <Screen>
      <Stack>
        <Button label="Alpha" onPress={() => {}} />
        <Button label="Locked" disabled onPress={() => {}} />
        <Stepper label="Count" value={0} min={0} max={3} onChange={() => {}} />
        <Button label="Beta" onPress={() => {}} />
      </Stack>
    </Screen>
  );
}
export default defineApp({ name: 'Disabled', initial: 'Home', screens: { Home }, capabilities: [] });
`;

// The only button lies far below the first screenful.
const FIXTURE_BELOW_THE_FOLD = `import { defineApp, Screen, Stack, Text, Button, useState } from 'vc-sdk';
function Home() {
  const [pressed, setPressed] = useState(false);
  return (
    <Screen>
      <Stack>
        <Text>{pressed ? 'Far was pressed' : 'Far is waiting'}</Text>
        {Array.from({ length: 70 }, (_, i) => <Text key={i}>{'Filler line ' + i}</Text>)}
        <Button label="Far down" onPress={() => setPressed(true)} />
      </Stack>
    </Screen>
  );
}
export default defineApp({ name: 'BelowTheFold', initial: 'Home', screens: { Home }, capabilities: [] });
`;

// A Picker with a placeholder and two options; the chosen value reaches storage only through the
// candidate's own onChange.
const FIXTURE_PICKER = `import { defineApp, Screen, Stack, Text, Picker, useState, storage } from 'vc-sdk';
function Home() {
  const [value, setValue] = useState('');
  return (
    <Screen>
      <Stack>
        <Picker
          label="Fruit"
          options={['Apple', 'Pear']}
          value={value}
          placeholder="Pick one"
          onChange={(v) => { setValue(v); storage.kv.set('picked', v).catch(() => {}); }}
        />
        <Text>{value === '' ? 'nothing chosen' : 'chosen ' + value}</Text>
      </Stack>
    </Screen>
  );
}
export default defineApp({ name: 'PickerApp', initial: 'Home', screens: { Home }, capabilities: ['storage'] });
`;

// One DateInput per mode; each onChange writes the picked value, read back in local time, so the
// stored string does not depend on the machine's time zone.
const FIXTURE_DATES = `import { defineApp, Screen, Stack, DateInput, useState, storage } from 'vc-sdk';
const pad = (n) => String(n).padStart(2, '0');
function format(ms, mode) {
  const d = new Date(ms);
  const day = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const time = pad(d.getHours()) + ':' + pad(d.getMinutes());
  return mode === 'date' ? day : mode === 'time' ? time : day + 'T' + time;
}
function Home() {
  const [date, setDate] = useState(null);
  const [time, setTime] = useState(null);
  const [both, setBoth] = useState(null);
  const save = (mode, set) => (ms) => { set(ms); if (ms !== null) storage.kv.set(mode, format(ms, mode)).catch(() => {}); };
  return (
    <Screen>
      <Stack>
        <DateInput label="Day" mode="date" value={date} onChange={save('date', setDate)} />
        <DateInput label="Hour" mode="time" value={time} onChange={save('time', setTime)} />
        <DateInput label="Both" mode="datetime" value={both} onChange={save('datetime', setBoth)} />
      </Stack>
    </Screen>
  );
}
export default defineApp({ name: 'Dates', initial: 'Home', screens: { Home }, capabilities: ['storage'] });
`;

/** Writes this many values, one reply at a time, before navigating. */
const SEQUENTIAL_WRITES = 2;
/** How long after the last reply the candidate navigates: well inside the quiet window that the
 *  reply opens (`REPLY_BUDGETS`), and well after the instant the reply is returned. */
const NAVIGATE_BEAT_MS = 100;

// The handler awaits a chain of storage writes and navigates a beat after the last one resolves.
const FIXTURE_WRITE_THEN_NAVIGATE = `import { defineApp, nav, Screen, Stack, Heading, Button, delay, storage } from 'vc-sdk';
function Home() {
  return (
    <Screen>
      <Stack>
        <Heading size="title">Home</Heading>
        <Button
          label="Save"
          onPress={() => {
            (async () => {
              for (let i = 0; i < ${SEQUENTIAL_WRITES}; i += 1) await storage.kv.set('k' + i, i);
              await delay(${NAVIGATE_BEAT_MS});
              nav.navigate('Saved');
            })().catch(() => {});
          }}
        />
      </Stack>
    </Screen>
  );
}
function Saved() {
  return (
    <Screen>
      <Stack><Heading size="title">Saved</Heading><Button label="Finish" onPress={() => {}} /></Stack>
    </Screen>
  );
}
export default defineApp({ name: 'WriteThenNavigate', initial: 'Home', screens: { Home, Saved }, capabilities: ['storage'] });
`;

// Each screen's only button is disabled until a chain of storage reads has resolved in the
// candidate. `Orphan` is never navigated to, so the sweep reaches it by a cold mount.
const READS_BEFORE_ENABLED = 150;
const FIXTURE_GATED_BUTTONS = `import { defineApp, Screen, Stack, Heading, Button, useState, useEffect, storage } from 'vc-sdk';
function useReads() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      for (let i = 0; i < ${READS_BEFORE_ENABLED}; i += 1) await storage.kv.get('seed' + i);
      setReady(true);
    })().catch(() => {});
  }, []);
  return ready;
}
function Home() {
  const ready = useReads();
  return (
    <Screen>
      <Stack>
        <Heading size="title">Home</Heading>
        <Button label="Go home" disabled={!ready} onPress={() => {}} />
      </Stack>
    </Screen>
  );
}
function Orphan() {
  const ready = useReads();
  return (
    <Screen>
      <Stack>
        <Heading size="title">Orphan</Heading>
        <Button label="Go orphan" disabled={!ready} onPress={() => {}} />
      </Stack>
    </Screen>
  );
}
export default defineApp({ name: 'Gated', initial: 'Home', screens: { Home, Orphan }, capabilities: ['storage'] });
`;

// The list reads from storage and is empty on a fresh install. The header's plus opens a form whose
// save control is disabled until the field is filled; saving pops back to a list that now holds a
// row, and the row opens a detail screen.
const FIXTURE_EMPTY_LIST = `import { defineApp, nav, Screen, Stack, Heading, TextInput, Button, List, ListItem, EmptyState, useState, useEffect, storage } from 'vc-sdk';
let ITEMS = [];
let picked = '';
const listeners = new Set();
function publish(next) {
  ITEMS = next;
  listeners.forEach((listener) => listener(next));
}
function Home() {
  const [items, setItems] = useState(ITEMS);
  useEffect(() => {
    listeners.add(setItems);
    storage.kv.get('items').then((saved) => { if (Array.isArray(saved)) publish(saved); }).catch(() => {});
    return () => { listeners.delete(setItems); };
  }, []);
  return (
    <Screen title="Items" action={{ icon: 'plus', label: 'Add item', onPress: () => nav.navigate('Form') }}>
      <Stack>
        {items.length === 0 ? (
          <EmptyState icon="search" title="Nothing yet" hint="Add the first one." />
        ) : (
          <List items={items} keyBy="name" renderItem={(item) => <ListItem title={item.name} onPress={() => { picked = item.name; nav.navigate('Detail'); }} />} />
        )}
      </Stack>
    </Screen>
  );
}
function Form() {
  const [name, setName] = useState('');
  const save = () => {
    const next = [...ITEMS, { name: name.trim() }];
    storage.kv.set('items', next).then(() => { publish(next); nav.back(); }).catch(() => {});
  };
  return (
    <Screen title="New item">
      <Stack>
        <TextInput label="Item name" value={name} onChange={setName} />
        <Button label="Save item" disabled={name.trim() === ''} onPress={save} />
      </Stack>
    </Screen>
  );
}
function Detail() {
  return (
    <Screen title="Item">
      <Stack><Heading size="title">{picked}</Heading><Button label="Archive" onPress={() => {}} /></Stack>
    </Screen>
  );
}
export default defineApp({ name: 'EmptyList', initial: 'Home', screens: { Home, Form, Detail }, capabilities: ['storage'] });
`;

// A pushed form. "Save" writes what the field holds, so the stored value shows whether the field was
// filled before the button was pressed. "Back" is an ordinary text button, not the header's.
const FIXTURE_PUSHED_FORM = `import { defineApp, nav, Screen, Stack, TextInput, Button, useState, storage } from 'vc-sdk';
function Home() {
  return <Screen><Stack><Button label="Open form" onPress={() => nav.navigate('Form')} /></Stack></Screen>;
}
function Form() {
  const [note, setNote] = useState('');
  return (
    <Screen title="Form">
      <Stack>
        <TextInput label="Note" value={note} onChange={setNote} />
        <Button label="Save" onPress={() => { storage.kv.set('saved', note).catch(() => {}); }} />
        <Button label="Back" onPress={() => {}} />
      </Stack>
    </Screen>
  );
}
export default defineApp({ name: 'PushedForm', initial: 'Home', screens: { Home, Form }, capabilities: ['storage'] });
`;

// A card whose label carries a count that rises on every press, beside one ordinary button.
const FIXTURE_RUNNING_VALUE = `import { defineApp, Screen, Stack, Button, ListItem, useState } from 'vc-sdk';
function Home() {
  const [taps, setTaps] = useState(0);
  return (
    <Screen>
      <Stack>
        <ListItem title={'Taps ' + taps} onPress={() => setTaps(taps + 1)} />
        <Button label="Other" onPress={() => {}} />
      </Stack>
    </Screen>
  );
}
export default defineApp({ name: 'RunningValue', initial: 'Home', screens: { Home }, capabilities: [] });
`;

// The only action shows a toast, which the SDK draws as a fixed region at the bottom of the app.
const FIXTURE_TOAST = `import { defineApp, Screen, Stack, Button, toast } from 'vc-sdk';
function Home() {
  return <Screen><Stack><Button label="Show" onPress={() => toast('Hello there')} /></Stack></Screen>;
}
export default defineApp({ name: 'ToastOnly', initial: 'Home', screens: { Home }, capabilities: [] });
`;

// Five screens the sweep cannot reach: the field takes a phrase the canonical text never matches.
// Four are navigated to, each written another way (single, double and backtick quotes, a receiver
// that is not "nav", spacing inside the call); "Gated" is named by no call and its name is a prefix
// of "GatedA".
const FIXTURE_GATED_SCREENS = `import { defineApp, nav, Screen, Stack, Heading, TextInput, useState } from 'vc-sdk';
const sdk = { nav };
function Home() {
  const [phrase, setPhrase] = useState('');
  const go = (text) => {
    setPhrase(text);
    if (text === 'open a') nav.navigate('GatedA');
    if (text === 'open b') nav.navigate("GatedB");
    if (text === 'open c') nav.navigate(\`GatedC\`);
    if (text === 'open d') sdk.nav.navigate( 'GatedD' );
  };
  return <Screen><Stack><Heading size="title">Home</Heading><TextInput label="Phrase" value={phrase} onChange={go} /></Stack></Screen>;
}
const page = (title) => () => <Screen><Stack><Heading size="title">{title}</Heading></Stack></Screen>;
const Gated = page('Gated');
const GatedA = page('GatedA');
const GatedB = page('GatedB');
const GatedC = page('GatedC');
const GatedD = page('GatedD');
export default defineApp({ name: 'GatedScreens', initial: 'Home', screens: { Home, Gated, GatedA, GatedB, GatedC, GatedD }, capabilities: [] });
`;

// A screen behind a phrase the sweep does not type, which throws as it renders.
const FIXTURE_GATED_THROWS = `import { defineApp, nav, Screen, Stack, Heading, TextInput, useState } from 'vc-sdk';
function Home() {
  const [phrase, setPhrase] = useState('');
  const go = (text) => {
    setPhrase(text);
    if (text === 'open sesame') nav.navigate('Vault');
  };
  return <Screen><Stack><Heading size="title">Home</Heading><TextInput label="Phrase" value={phrase} onChange={go} /></Stack></Screen>;
}
function Vault() {
  throw new Error('gated-vault-throws');
}
export default defineApp({ name: 'GatedThrows', initial: 'Home', screens: { Home, Vault }, capabilities: [] });
`;

/** The `kv` verbs with each write holding the host for `ms`. */
function slowKv(kv: StorageEngine['kv'], ms: number): StorageEngine['kv'] {
  return {
    get: (key) => kv.get(key),
    remove: (key) => kv.remove(key),
    set: (key, value) => {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
      kv.set(key, value);
    },
  };
}

/** The host's storage answers its writes slowly: each `kv.set` holds the host for `ms`, longer than
 *  the quiet window, so the window has closed before the reply is returned. */
function slowWrites(ms: number): () => StorageEngine {
  return () => {
    const engine = createEngine(createNodeSqlExecutor(':memory:'));
    const kv = slowKv(engine.kv, ms);
    return new Proxy(engine, { get: (target, prop, receiver) => (prop === 'kv' ? kv : (Reflect.get(target, prop, receiver) as unknown)) });
  };
}

export async function testSweepReach(): Promise<void> {
  const session = await SynthRunSession.launch({ concurrency: 2 });
  try {
    await runScenarios(session);
  } finally {
    await session.close();
  }
}

async function runScenarios(session: SynthRunSession): Promise<void> {
  await test('hit test: a control under an open Modal is pressed after the Modal closes, with no failed action', async () => {
    const { result, text } = await runSweep(session, FIXTURE_UNDER_MODAL);
    const order = labels(result);
    const at = (label: string): number => order.indexOf(label);
    ok(at('Inside') > at('Open sheet') && at('Inside') >= 0, `the Modal's own control was used after it opened (${describe(result)})`);
    ok(at('modal') > at('Inside'), `the backdrop was dismissed after the Modal's own controls (${describe(result)})`);
    ok(at('Second') > at('modal'), `"Second" was pressed only after the Modal was dismissed (${describe(result)})`);
    ok(text.includes('Second was pressed'), `the candidate saw the press on "Second" (page text: ${text.replace(/\s+/g, ' ')})`);
    ok(result.sweep.failedActions === 0, `no action failed (${describe(result)})`);
    ok(result.sweep.blocked === 0, `nothing was left blocked (${describe(result)})`);
  });

  await test('hit test: deferring a covered control does not spend the per-screen cap', async () => {
    const uncapped = await runSweep(session, FIXTURE_UNDER_MODAL);
    const needed = uncapped.result.actionsLog.length;
    ok(labels(uncapped.result).includes('Second'), `the uncapped run pressed "Second" (${describe(uncapped.result)})`);
    // A deferral that counted as an action would reach a cap equal to the actions the run takes
    // before "Second" is pressed.
    const { result } = await runSweep(session, FIXTURE_UNDER_MODAL, { sweep: { maxActionsPerScreen: needed } });
    ok(labels(result).includes('Second'), `"Second" was still pressed under a cap of ${needed} actions (${describe(result)})`);
    ok(result.truncated === false, 'the screen was not reported truncated');
  });

  await test('hit test: a Modal that reopens over a control is dismissed again once something was acted on since', async () => {
    const { result, text } = await runSweep(session, FIXTURE_REOPENED_MODAL);
    const dismissals = result.actionsLog.filter((el) => el.kind === 'modal-backdrop').length;
    ok(dismissals === 2, `the same backdrop was dismissed twice (${describe(result)})`);
    ok(labels(result).includes('Third'), `"Third", covered by the reopened Modal, was pressed (${describe(result)})`);
    ok(text.includes('Third was pressed'), `the candidate saw the press on "Third" (page text: ${text.replace(/\s+/g, ' ')})`);
    ok(result.sweep.failedActions === 0, `no action failed (${describe(result)})`);
  });

  await test('hit test: a Modal that cannot be dismissed ends the screen with its covered controls blocked, and nothing times out', async () => {
    const { result } = await runSweep(session, FIXTURE_STUCK_MODAL);
    const order = labels(result);
    ok(!order.includes('Under 1') && !order.includes('Under 2'), `no action was attempted on a covered control (${describe(result)})`);
    ok(order.includes('Inside'), `the Modal's own control was used (${describe(result)})`);
    ok(result.actionsLog.filter((el) => el.kind === 'modal-backdrop').length === 1, `the backdrop was tried once, not again without anything acted on in between (${describe(result)})`);
    ok(result.sweep.blocked === 2, `the two covered controls are counted as blocked (${describe(result)})`);
    ok(result.sweep.failedActions === 0, `no action failed (${describe(result)})`);
    ok(result.truncated === false, 'the screen ended without being reported truncated');
  });

  await test('hit test: a control that stays disabled is never acted on, and the enabled ones all are', async () => {
    const { result } = await runSweep(session, FIXTURE_DISABLED);
    const order = labels(result);
    ok(!order.includes('Locked'), `no action was attempted on the disabled button (${describe(result)})`);
    ok(order.includes('Alpha') && order.includes('Beta'), `the enabled buttons were acted on (${describe(result)})`);
    ok(result.sweep.failedActions === 0 && result.sweep.blocked === 0, `no failed action and nothing blocked (${describe(result)})`);
  });

  await test('hit test: a control below the fold is scrolled into view and pressed', async () => {
    const { result, text } = await runSweep(session, FIXTURE_BELOW_THE_FOLD);
    ok(labels(result).includes('Far down'), `the button below the fold was acted on (${describe(result)})`);
    ok(text.includes('Far was pressed'), `the candidate saw the press (page text: ${text.slice(0, 80).replace(/\s+/g, ' ')})`);
    ok(result.sweep.blocked === 0 && result.sweep.failedActions === 0, `nothing blocked and no failed action (${describe(result)})`);
  });

  await test('native controls: a Picker option is chosen through select-option, so onChange receives its value', async () => {
    const { result, wiring } = await runSweep(session, FIXTURE_PICKER);
    ok(result.actionsLog.length === 1 && result.actionsLog[0].kind === 'select', `the only fingerprint is the native select, not its wrapper (${describe(result)})`);
    ok(result.actionsLog[0].label === 'Fruit', `the select is labelled by its aria-label (${describe(result)})`);
    const stored = await holds(() => wiring.realm?.engine?.kv.get('picked') === 'Apple', 5000);
    ok(stored, `onChange received the first option's value, so the candidate stored it (stored ${JSON.stringify(wiring.realm?.engine?.kv.get('picked'))})`);
    ok(result.sweep.failedActions === 0, `no action failed (${describe(result)})`);
  });

  await test('native controls: a DateInput of each mode is filled with the fixed value in its own format', async () => {
    const { result, wiring } = await runSweep(session, FIXTURE_DATES);
    ok(result.actionsLog.map((el) => el.kind).sort((a, b) => a.localeCompare(b)).join(',') === 'date-input,datetime-input,time-input', `one native input per mode, no wrapper (${describe(result)})`);
    const kv = (key: string): unknown => wiring.realm?.engine?.kv.get(key);
    const stored = await holds(() => kv('date') === '2026-01-15' && kv('time') === '09:30' && kv('datetime') === '2026-01-15T09:30', 5000);
    ok(stored, `each onChange received the fixed value (stored ${JSON.stringify([kv('date'), kv('time'), kv('datetime')])})`);
    ok(result.sweep.failedActions === 0, `no action failed (${describe(result)})`);
  });

  await test('quiet wait: a write-then-navigate is followed, so the screen it navigates to is swept live', async () => {
    const { result, wiring } = await runSweep(session, FIXTURE_WRITE_THEN_NAVIGATE, { budgets: REPLY_BUDGETS, engineFactory: slowWrites(400) });
    const writes = wiring.trace.filter((t) => t.kind === 'syscall' && t.method === 'storage.kv.set').length;
    ok(writes === SEQUENTIAL_WRITES, `the handler's ${SEQUENTIAL_WRITES} writes all resolved (got ${writes})`);
    ok(result.visitedScreens.includes('Saved'), `the screen navigated to was visited (${result.visitedScreens.join(',')})`);
    ok(result.coldMountedScreens.length === 0, `no screen needed a cold mount (${result.coldMountedScreens.join(',')})`);
    ok(labels(result).includes('Finish'), `the sweep acted on the new screen (${describe(result)})`);
  });

  await test('quiet wait: a button gated on a chain of mount-time reads is enumerated once they resolve, at the first mount and after a cold mount', async () => {
    const { result } = await runSweep(session, FIXTURE_GATED_BUTTONS, { budgets: REPLY_BUDGETS });
    ok(labels(result).join(',') === 'Go home,Go orphan', `both gated buttons were acted on (${describe(result)})`);
    ok(result.coldMountedScreens.join(',') === 'Orphan', `Orphan was covered by the cold mount (${result.coldMountedScreens.join(',')})`);
  });

  await test('real app: workout-log-p2 sweeps History live, through the buttons that sat under a Modal', async () => {
    const { result } = await runSweep(session, flowbenchApp('workout-log-p2'), { budgets: ASYNC_BUDGETS });
    ok(result.visitedScreens.includes('History') && !result.coldMountedScreens.includes('History'), `History was reached live (visited ${result.visitedScreens.join(',')}; cold ${result.coldMountedScreens.join(',')}; ${describe(result)})`);
    ok(result.actionsLog.some((el) => el.kind === 'select' && el.label === 'Common lifts'), `the Picker was driven through its select (${describe(result)})`);
    ok(result.sweep.failedActions === 0, `no action failed (${describe(result)})`);
  });

  await test('real app: packing-checklist-p2 sweeps Trip live, through a template row', async () => {
    const { result } = await runSweep(session, flowbenchApp('packing-checklist-p2'), { budgets: ASYNC_BUDGETS });
    ok(result.visitedScreens.includes('Trip') && !result.coldMountedScreens.includes('Trip'), `Trip was reached live (visited ${result.visitedScreens.join(',')}; cold ${result.coldMountedScreens.join(',')}; ${describe(result)})`);
    ok(result.sweep.failedActions === 0, `no action failed (${describe(result)})`);
  });

  await test('real app: flashcards-p1 sweeps Review live, through "Start review"', async () => {
    const { result } = await runSweep(session, flowbenchApp('flashcards-p1'), { budgets: ASYNC_BUDGETS });
    ok(result.visitedScreens.includes('Review') && !result.coldMountedScreens.includes('Review'), `Review was reached live (visited ${result.visitedScreens.join(',')}; cold ${result.coldMountedScreens.join(',')}; ${describe(result)})`);
    ok(result.actionsLog.some((el) => el.label === 'Start review'), `"Start review" was pressed (${describe(result)})`);
    ok(result.sweep.failedActions === 0, `no action failed (${describe(result)})`);
  });

  await test('real app: score-keeper-p1 presses the cards its Modal scrim covered, with no failed action', async () => {
    const { result } = await runSweep(session, flowbenchApp('score-keeper-p1'), { budgets: ASYNC_BUDGETS, sweep: { maxActionsPerScreen: 12 } });
    ok(result.actionsLog.some((el) => el.kind === 'pressable' && el.label.startsWith('Player 1')), `a player card beneath the Modal was pressed (${describe(result)})`);
    ok(result.sweep.failedActions === 0, `no action failed (${describe(result)})`);
  });

  await test('order: the header Back button of a pushed screen is a kind of its own, detected on a real SDK screen, and a text button named Back is not it', async () => {
    const { result, wiring } = await runSweep(session, FIXTURE_PUSHED_FORM, { budgets: ASYNC_BUDGETS });
    ok(
      signature(result) === 'button:Open form,text-input:Note,button:Back,button:Save,nav-back:Back',
      `the form was filled and saved, the text "Back" button pressed as a button, and the header Back button last (${describe(result)})`,
    );
    const stored = await holds(() => wiring.realm?.engine?.kv.get('saved') === 'synthrun-probe', 5000);
    ok(stored, `"Save" was pressed after the field was filled (stored ${JSON.stringify(wiring.realm?.engine?.kv.get('saved'))})`);
    ok(result.sweep.failedActions === 0, `no action failed (${describe(result)})`);
  });

  await test('labels: an icon-only header action is labelled by its accessible name, not by the placeholder', async () => {
    const { result } = await runSweep(session, FIXTURE_EMPTY_LIST, { budgets: REPLY_BUDGETS });
    ok(result.actionsLog.some((el) => el.kind === 'button' && el.label === 'Add item'), `the header action is a button labelled by its aria-label (${describe(result)})`);
    ok(result.actionsLog.every((el) => el.label !== '(button)'), `no fingerprint fell back to the placeholder label (${describe(result)})`);
  });

  await test('order: a detail screen behind an empty list is reached live, through the form that creates the row', async () => {
    const { result } = await runSweep(session, FIXTURE_EMPTY_LIST, { budgets: REPLY_BUDGETS });
    ok(result.visitedScreens.includes('Detail'), `the detail screen was visited (${result.visitedScreens.join(',')})`);
    ok(!result.coldMountedScreens.includes('Detail'), `and not by a cold mount (cold: ${result.coldMountedScreens.join(',')}; ${describe(result)})`);
    ok(result.coldMountedScreens.length === 0 && result.diagnostics.length === 0, `no screen needed a cold mount and no diagnostic was raised (${describe(result)})`);
    const order = result.actionsLog.map((el) => el.kind + ':' + el.label);
    const at = (entry: string): number => order.indexOf(entry);
    ok(at('text-input:Item name') >= 0 && at('button:Save item') > at('text-input:Item name'), `the field was filled and then saved (${describe(result)})`);
    ok(at('pressable:synthrun-probe') > at('button:Save item'), `the row the form created was pressed after the save (${describe(result)})`);
    ok(at('button:Archive') > at('pressable:synthrun-probe'), `the detail screen was swept after the row (${describe(result)})`);
    ok(!order.slice(0, at('button:Save item')).includes('nav-back:Back'), `the form was not left before it was saved (${describe(result)})`);
  });

  await test('order: workout-log-p1 fills the pushed form before it presses the header Back button', async () => {
    const { result } = await runSweep(session, flowbenchApp('workout-log-p1'), { budgets: REPLY_BUDGETS });
    const order = result.actionsLog.map((el) => el.kind + ':' + el.label);
    const back = order.indexOf('nav-back:Back');
    ok(back >= 0, `the header Back button was recognised as nav-back (${describe(result)})`);
    for (const field of ['date-input:Date', 'text-input:Exercise', 'number-input:Reps', 'number-input:Weight (kg)', 'button:Add set']) {
      const at = order.indexOf(field);
      ok(at >= 0 && at < back, `${field} was acted on before the header Back button (${describe(result)})`);
    }
  });

  await test('order: recipe-box-p1 presses its rows before it types into the search field', async () => {
    const { result } = await runSweep(session, flowbenchApp('recipe-box-p1'), { budgets: REPLY_BUDGETS });
    // The list screen's only text field; the form's three are labelled.
    const formFields = ['Recipe name', 'Ingredients', 'Steps'];
    const search = result.actionsLog.findIndex((el) => el.kind === 'text-input' && !formFields.includes(el.label));
    ok(search >= 0, `the search field was typed into (${describe(result)})`);
    for (const recipe of ['Banana Oat Pancakes', 'Tomato Pasta', 'Berry Yogurt Bowl']) {
      const row = result.actionsLog.findIndex((el) => el.kind === 'pressable' && el.label.startsWith(recipe));
      ok(row >= 0 && row < search, `the "${recipe}" row was pressed before the search field was typed into (${describe(result)})`);
    }
    ok(result.visitedScreens.includes('RecipeDetail') && !result.coldMountedScreens.includes('RecipeDetail'), `a row led to the detail screen live (${describe(result)})`);
  });

  await test('limit: a card whose label carries a running value is pressed three times, the screen goes on, and the report is not truncated', async () => {
    const { result } = await runSweep(session, FIXTURE_RUNNING_VALUE);
    ok(labels(result).join(',') === 'Taps 0,Taps 1,Taps 2,Other', `the card was pressed three times, then the other button (${describe(result)})`);
    ok(result.truncated === false, 'the report is not truncated');
    ok(result.sweep.blocked === 0, `the spent card is not counted as blocked (${describe(result)})`);
  });

  await test('limit: a cap reached only because of spent fingerprints is not a truncation', async () => {
    const { result } = await runSweep(session, FIXTURE_RUNNING_VALUE, { sweep: { maxActionsPerScreen: 4 } });
    ok(result.actionsLog.length === 4, `the cap was reached exactly (${describe(result)})`);
    ok(result.truncated === false, `only the spent card was left, so the report is not truncated (${describe(result)})`);
    ok(result.sweep.blocked === 0, `and it is not counted as blocked (${describe(result)})`);
  });

  await test('limit: score-keeper-p1 is not truncated, and no DOM path is acted on more than three times', async () => {
    const { result } = await runSweep(session, flowbenchApp('score-keeper-p1'), { budgets: ASYNC_BUDGETS });
    ok(result.truncated === false, `the report is not truncated (${describe(result)})`);
    const perPath = new Map<string, number>();
    for (const el of result.actionsLog.filter((e) => e.kind !== 'modal-backdrop')) perPath.set(el.domPath, (perPath.get(el.domPath) ?? 0) + 1);
    ok(Math.max(0, ...perPath.values()) <= 3, `no DOM path was acted on more than three times (${describe(result)})`);
    ok(result.actionsLog.some((el) => el.kind === 'pressable' && el.label.startsWith('Player 1')), `a player card was pressed (${describe(result)})`);
  });

  await test('toast: showing a toast does not add a Modal backdrop dismissal to the action log', async () => {
    const { result, text } = await runSweep(session, FIXTURE_TOAST, { budgets: ASYNC_BUDGETS });
    ok(text.includes('Hello there'), `the toast was on screen when the sweep ended (page text: ${text.replace(/\s+/g, ' ')})`);
    ok(signature(result) === 'button:Show', `only the button was acted on (${describe(result)})`);
    ok(result.sweep.blocked === 0, `the toast is no fingerprint, so nothing is counted as blocked (${describe(result)})`);
  });

  await test('coverage: a gated screen is cold-mounted and listed, with no diagnostic when a navigate call names it, however the call is written', async () => {
    const { result } = await runSweep(session, FIXTURE_GATED_SCREENS, { budgets: ASYNC_BUDGETS });
    ok(
      [...result.coldMountedScreens].sort((a, b) => a.localeCompare(b)).join(',') === 'Gated,GatedA,GatedB,GatedC,GatedD',
      `every screen the sweep could not reach live was cold-mounted (${result.coldMountedScreens.join(',')})`,
    );
    ok(result.diagnostics.map((d) => d.kind).join(',') === 'unreachable_screen', `exactly one diagnostic (${JSON.stringify(result.diagnostics)})`);
    ok(result.diagnostics[0]?.message.includes('"Gated"') ?? false, `and it names the screen no call names, not its longer neighbour (${JSON.stringify(result.diagnostics)})`);
  });

  await test('coverage: a screen no navigate call names is still flagged, hint included', async () => {
    const { result } = await runSweep(session, FIXTURE_GATED_BUTTONS, { budgets: REPLY_BUDGETS });
    const flagged = result.diagnostics.filter((d) => d.kind === 'unreachable_screen');
    ok(flagged.length === 1 && flagged[0].severity === 'warning' && flagged[0].message.includes('"Orphan"'), `a warning names the orphan (${JSON.stringify(result.diagnostics)})`);
    ok(flagged[0]?.hint.includes('nav.navigate') ?? false, 'it carries the hint that tells the author what to add');
  });

  await test('coverage: a gated screen that throws while rendering still fails the run, and carries no unreachable_screen', async () => {
    const report = await within(createRunCandidate(session)(FIXTURE_GATED_THROWS, { budgets: { mountBudgetMs: 5000, actionQuietMs: 40, actionHardCapMs: 2000 } }), SWEEP_TIMEOUT_MS, 'the run');
    ok(report.diagnostics.some((d) => d.kind === 'runtime_throw' && d.message.includes('gated-vault-throws')), `the render error is a runtime_throw (${JSON.stringify(report.diagnostics)})`);
    ok(report.ok === false, 'the run did not pass');
    ok(report.screens.coldMounted.join(',') === 'Vault', `the gated screen is listed as cold-mounted (${report.screens.coldMounted.join(',')})`);
    ok(!report.diagnostics.some((d) => d.kind === 'unreachable_screen'), 'and no unreachable_screen was raised for it');
  });
}
