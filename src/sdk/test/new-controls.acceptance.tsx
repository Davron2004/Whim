// Node acceptance suite for the controls design-system-v1 adds (docs/design/system.md §7.2):
// `Stepper` (bounds, step precision, hold-to-repeat after 400 ms at 8/s), `DateInput` (epoch ms,
// `date` stores local midnight, the native picker under the field) and `Picker` (the native list).
// Auto-discovered by `src/sdk/test/run.mjs`.
import assert from 'node:assert';
import * as React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import * as publicSdk from '../index';
import { DateInput, Picker, Stepper, type DateInputMode } from '../index';
import { installFakeClock } from './fake-clock';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

for (const name of ['Stepper', 'DateInput', 'Picker'] as const) {
  assert.ok(typeof publicSdk[name] === 'function', `vc-sdk exports ${name}`);
}

/** A controlled harness: the component re-renders with every value it reports, like an app's state. */
function Controlled<V>({ initial, render, log }: { initial: V; render: (value: V, set: (v: V) => void) => React.ReactElement; log: V[] }) {
  const [value, setValue] = React.useState(initial);
  return render(value, (v) => {
    log.push(v);
    setValue(v);
  });
}

function mount(element: React.ReactElement): ReactTestRenderer {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(element);
  });
  return renderer!;
}

function stepperButton(root: ReactTestInstance, name: 'Increase' | 'Decrease'): ReactTestInstance {
  return root.find((node) => node.type === 'button' && node.props['aria-label'] === name);
}

function spinValue(root: ReactTestInstance): unknown {
  return root.find((node) => node.props.role === 'spinbutton').props['aria-valuenow'];
}

/** A tap: the pointer goes down and up, then the browser's click (detail 1). */
function tap(button: ReactTestInstance): void {
  act(() => {
    button.props.onPointerDown();
    button.props.onPointerUp();
    button.props.onClick({ detail: 1 });
  });
}

// ── Stepper: a tap steps once, bounds disable, the step keeps its precision ────
{
  const log: number[] = [];
  const renderer = mount(
    <Controlled<number> initial={0.2} log={log} render={(v, set) => <Stepper label="Dose" value={v} min={0} max={0.4} step={0.1} onChange={set} />} />,
  );
  const root = renderer.root;
  assert.deepStrictEqual(stepperButton(root, 'Decrease').props.disabled, false, 'decrease is enabled above the minimum');
  tap(stepperButton(root, 'Increase'));
  assert.deepStrictEqual(log, [0.3], 'one tap is one step, with no float drift (0.2 + 0.1 is 0.3)');
  tap(stepperButton(root, 'Increase'));
  assert.deepStrictEqual(log, [0.3, 0.4], 'a second tap steps again');
  assert.deepStrictEqual([spinValue(root)], [0.4], 'the spinbutton reports the value');
  assert.deepStrictEqual(stepperButton(root, 'Increase').props.disabled, true, 'increase is disabled at the maximum');
  tap(stepperButton(root, 'Increase'));
  assert.deepStrictEqual(log, [0.3, 0.4], 'a disabled button never reports');
  act(() => stepperButton(root, 'Decrease').props.onClick({ detail: 0 }));
  assert.deepStrictEqual(log, [0.3, 0.4, 0.3], 'a keyboard activation (a click with no pointer) steps on its own');
  act(() => renderer.unmount());
}

// ── Stepper: the default minimum is 0 ─────────────────────────────────────────
{
  const log: number[] = [];
  const renderer = mount(<Controlled<number> initial={0} log={log} render={(v, set) => <Stepper value={v} onChange={set} />} />);
  assert.deepStrictEqual(stepperButton(renderer.root, 'Decrease').props.disabled, true, 'at 0 with no min, decrease is disabled');
  tap(stepperButton(renderer.root, 'Increase'));
  assert.deepStrictEqual(log, [1], 'the default step is 1');
  act(() => renderer.unmount());
}

// ── Stepper: holding repeats after 400 ms at 8 a second, and stops at the bound ─
{
  const clock = installFakeClock();
  try {
    const log: number[] = [];
    const renderer = mount(<Controlled<number> initial={0} log={log} render={(v, set) => <Stepper value={v} max={6} onChange={set} />} />);
    const increase = (): ReactTestInstance => stepperButton(renderer.root, 'Increase');
    act(() => increase().props.onPointerDown());
    assert.deepStrictEqual(log, [1], 'the press steps at once');
    act(() => clock.advance(399));
    assert.deepStrictEqual(log, [1], 'nothing more before 400 ms');
    act(() => clock.advance(1 + 125 * 2));
    assert.deepStrictEqual(log, [1, 2, 3], 'then a step every 125 ms');
    act(() => increase().props.onPointerUp());
    act(() => clock.advance(1000));
    assert.deepStrictEqual(log, [1, 2, 3], 'releasing stops the repeat');

    act(() => increase().props.onPointerDown());
    act(() => clock.advance(400 + 125 * 10));
    assert.deepStrictEqual(log, [1, 2, 3, 4, 5, 6], 'a held press runs to the bound and no further');
    assert.deepStrictEqual(clock.pending(), 0, 'and its timer is gone');
    act(() => renderer.unmount());
  } finally {
    clock.restore();
  }
}

// ── Stepper: unmounting mid-hold cancels the repeat ───────────────────────────
{
  const clock = installFakeClock();
  try {
    const log: number[] = [];
    const renderer = mount(<Controlled<number> initial={0} log={log} render={(v, set) => <Stepper value={v} onChange={set} />} />);
    act(() => stepperButton(renderer.root, 'Increase').props.onPointerDown());
    act(() => renderer.unmount());
    assert.deepStrictEqual(clock.pending(), 0, 'no timer outlives the stepper');
    assert.deepStrictEqual(log, [1], 'and nothing more is reported');
  } finally {
    clock.restore();
  }
}

// ── DateInput ─────────────────────────────────────────────────────────────────
function nativeInput(root: ReactTestInstance): ReactTestInstance {
  return root.find((node) => node.type === 'input');
}

function fieldText(root: ReactTestInstance): string {
  // The visible value: the span beside the field's icon.
  const field = root.find((node) => node.type === 'input' || node.type === 'select').parent!;
  const shown = field.findAll((node) => node.type === 'span');
  return shown.map((node) => node.children.join('')).join('');
}

function changeTo(input: ReactTestInstance, text: string): void {
  act(() => input.props.onChange({ target: { value: text } }));
}

const AFTERNOON = new Date(2026, 2, 5, 15, 30, 45, 123).getTime(); // 5 March 2026, 15:30 local

{
  const log: Array<number | null> = [];
  const renderer = mount(<Controlled<number | null> initial={null} log={log} render={(v, set) => <DateInput label="Start" value={v} onChange={set} />} />);
  const input = (): ReactTestInstance => nativeInput(renderer.root);
  assert.deepStrictEqual([input().props.type, input().props.value], ['date', ''], 'an unset date is an empty native date input');
  assert.deepStrictEqual(input().props.style.opacity, 0, 'the native control sits under the field, invisible');
  const placeholder = fieldText(renderer.root);

  changeTo(input(), '2026-03-05');
  const picked = new Date(log[0] as number);
  assert.deepStrictEqual(
    [picked.getFullYear(), picked.getMonth(), picked.getDate(), picked.getHours(), picked.getMinutes(), picked.getSeconds(), picked.getMilliseconds()],
    [2026, 2, 5, 0, 0, 0, 0],
    'date mode stores local midnight of the picked day',
  );
  assert.deepStrictEqual(input().props.value, '2026-03-05', 'the native control shows the stored day back');
  assert.ok(fieldText(renderer.root) !== placeholder && fieldText(renderer.root).includes('2026'), 'the field shows the picked date, not the placeholder');

  changeTo(input(), '');
  assert.deepStrictEqual(log[1], null, 'clearing the native control reports null');
  changeTo(input(), 'not a date');
  assert.deepStrictEqual(log.length, 2, 'an unreadable native value is ignored');
  act(() => renderer.unmount());
}

for (const [mode, type, shown] of [
  ['time', 'time', '15:30'],
  ['datetime', 'datetime-local', '2026-03-05T15:30'],
] as Array<[DateInputMode, string, string]>) {
  const log: Array<number | null> = [];
  const renderer = mount(<Controlled<number | null> initial={AFTERNOON} log={log} render={(v, set) => <DateInput value={v} mode={mode} onChange={set} />} />);
  const input = nativeInput(renderer.root);
  assert.deepStrictEqual([input.props.type, input.props.value], [type, shown], `${mode} mode shows the value in the native ${type} format`);
  act(() => renderer.unmount());
}

{
  const log: Array<number | null> = [];
  const renderer = mount(<Controlled<number | null> initial={AFTERNOON} log={log} render={(v, set) => <DateInput value={v} mode="time" onChange={set} />} />);
  changeTo(nativeInput(renderer.root), '07:05');
  assert.deepStrictEqual(log, [new Date(2026, 2, 5, 7, 5, 0, 0).getTime()], 'time mode keeps the day and sets the minute');
  act(() => renderer.unmount());
}

{
  const log: Array<number | null> = [];
  const renderer = mount(<Controlled<number | null> initial={null} log={log} render={(v, set) => <DateInput value={v} mode="datetime" onChange={set} />} />);
  changeTo(nativeInput(renderer.root), '0099-12-31T23:59');
  const picked = new Date(log[0] as number);
  assert.deepStrictEqual(
    [picked.getFullYear(), picked.getMonth(), picked.getDate(), picked.getHours(), picked.getMinutes()],
    [99, 11, 31, 23, 59],
    'datetime mode stores the picked local minute, even for a two-digit year',
  );
  act(() => renderer.unmount());
}

// ── Picker ────────────────────────────────────────────────────────────────────
{
  const options = ['V60', 'Chemex', 'V60'];
  const log: string[] = [];
  const errors: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  let renderer: ReactTestRenderer | undefined;
  try {
    renderer = mount(
      <Controlled<string> initial="" log={log} render={(v, set) => <Picker label="Brewer" options={options} value={v} placeholder="Pick a brewer" onChange={set} />} />,
    );
  } finally {
    console.error = originalError;
  }
  const select = (): ReactTestInstance => renderer!.root.find((node) => node.type === 'select');
  const keyDiagnostics = errors.filter((args) => args.some((arg) => typeof arg === 'string' && /same key|unique "key"/.test(arg)));
  assert.deepStrictEqual(keyDiagnostics.length, 0, 'repeated options render without a duplicate-key diagnostic');
  assert.deepStrictEqual(select().props.value, '', 'with no choice the native list sits on its placeholder');
  assert.deepStrictEqual(
    select().findAll((node) => node.type === 'option').map((node) => [node.props.value, node.props.disabled === true]),
    [['', true], ['V60', false], ['Chemex', false], ['V60', false]],
    'the native list holds the placeholder (not choosable) and every option',
  );
  assert.ok(fieldText(renderer!.root).includes('Pick a brewer'), 'the field shows the placeholder');

  act(() => select().props.onChange({ target: { value: 'Chemex' } }));
  assert.deepStrictEqual(log, ['Chemex'], 'choosing reports the option');
  assert.deepStrictEqual(select().props.value, 'Chemex', 'the native list follows the value');
  assert.ok(fieldText(renderer!.root).includes('Chemex'), 'the field shows the choice');
  assert.deepStrictEqual(
    select().findAll((node) => node.type === 'option').map((node) => node.props.value),
    ['V60', 'Chemex', 'V60'],
    'once chosen, the placeholder row is gone',
  );
  act(() => renderer!.unmount());
}

console.log('SDK new controls acceptance: PASS');
