// Node acceptance suite for the `Screen` header (sdk-design-system "Screen gives a header with
// automatic back": a back control on a pushed screen that calls `nav.back()`, none on the root; the
// trailing action; the bottom padding still clears the host's chrome). Auto-discovered by
// `src/sdk/test/run.mjs`. The app runs inside `NavRoot`, the root the trusted loader mounts.
import assert from 'node:assert';
import * as React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Button, Screen, Text, nav, type AppSpec } from '../index';
import { NavRoot } from '../navigation';
import { space } from '../tokens';

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    __whimGeneration: 1,
    parent: { postMessage(): void {} },
    addEventListener(): void {},
    removeEventListener(): void {},
  },
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const presses: string[] = [];

function Home(): React.ReactElement {
  return (
    <Screen title="Brews" action={{ icon: 'settings', label: 'Settings', onPress: () => presses.push('settings') }}>
      <Button label="Open" onPress={() => nav.navigate('Detail')} />
    </Screen>
  );
}

function Detail(): React.ReactElement {
  return (
    <Screen title="V60">
      <Text>Detail</Text>
      <Screen title="Inner">
        <Text>Nested</Text>
      </Screen>
    </Screen>
  );
}

function Untitled(): React.ReactElement {
  return (
    <Screen>
      <Text>No header</Text>
    </Screen>
  );
}

const spec: AppSpec = { name: 'Header acceptance', initial: 'Home', screens: { Home, Detail, Untitled }, capabilities: [] };

function headings(root: ReactTestInstance): string[] {
  return root.findAll((node) => node.type === 'h1').map((node) => node.children.join(''));
}

function headerButton(root: ReactTestInstance, label: string): ReactTestInstance[] {
  return root.findAll((node) => node.type === 'button' && node.props['aria-label'] === label);
}

let renderer: ReactTestRenderer | undefined;
await act(async () => {
  renderer = create(<NavRoot spec={spec} chromeInsetBottom={84} />);
});
const root = (): ReactTestInstance => renderer!.root;

// ── The root screen: title and action, no back control ────────────────────────
assert.deepStrictEqual(headings(root()), ['Brews'], 'the title renders as the page heading');
assert.deepStrictEqual(headerButton(root(), 'Back').length, 0, 'the root screen has no back control');
{
  const [settings] = headerButton(root(), 'Settings');
  assert.ok(settings, 'the action renders as a labelled header button');
  assert.ok(settings.findAll((node) => node.type === 'svg').length === 1, 'the action button is an icon');
  await act(async () => settings.props.onClick());
  assert.deepStrictEqual(presses, ['settings'], 'tapping the action runs its onPress');
}

// ── A pushed screen gets a back control that pops the stack ───────────────────
await act(async () => nav.navigate('Detail'));
assert.deepStrictEqual(headings(root()), ['V60', 'Inner'], 'the pushed screen shows its title');
{
  const backs = headerButton(root(), 'Back');
  assert.deepStrictEqual(backs.length, 1, 'one back control: the nested Screen does not get its own');
  assert.deepStrictEqual(headerButton(root(), 'Settings').length, 0, 'a screen without an action shows none');
  await act(async () => backs[0].props.onClick());
}
assert.deepStrictEqual(headings(root()), ['Brews'], 'the back control returned to the root screen');
assert.deepStrictEqual(headerButton(root(), 'Back').length, 0, 'and the root has no back control again');

// ── No title, no header — even above the root ─────────────────────────────────
await act(async () => nav.navigate('Untitled'));
assert.deepStrictEqual(headings(root()), [], 'a screen without a title has no heading');
assert.deepStrictEqual(headerButton(root(), 'Back').length, 0, 'and no back control');

// ── With a header the bottom padding still clears the orb ─────────────────────
await act(async () => nav.back());
{
  const page = root().find((node) => node.type === 'div' && node.props.style?.minHeight === '100%');
  const padding = page.props.style.padding as string;
  assert.ok(padding.endsWith(`calc(${space('lg')} + 84px)`), `the titled screen pads its bottom by the inset (got ${padding})`);
}

await act(async () => renderer!.unmount());

console.log('SDK screen header acceptance: PASS');
