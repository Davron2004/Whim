/** The keyboard never hides the field or the action it belongs to (app-launcher "Text input never
 *  hides the content or action it belongs to", beta-1 D3): every launcher screen and sheet with a
 *  text field, rendered on each platform, for how its keyboard comes up and goes away. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY } from '../copy';
import { primaryActionLabel } from '../prompt-flow';
import ComposeStep from '../ComposeStep';
import ClarifyStep from '../ClarifyStep';
import PlanStep from '../PlanStep';
import ReportSheet from '../ReportSheet';
import SettingsScreen from '../SettingsScreen';
import type { InstalledApp } from '../app-index';
import type { StoreAccess } from '../store-access';
import { reportClientOptions } from '../transport-shared';
import { AI_CONSENT_VERSION } from '../release-config';
import { button, press, renderScreen, textOf, unmountScreen } from './react-screen';
import { testAppInfo } from './client-fixtures';
import { Keyboard, Platform } from './native-host';

type Tree = TestRenderer.ReactTestRenderer;
type Node = TestRenderer.ReactTestInstance;

const noop = () => {};

/** Counts calls per callback name. */
function spies() {
  const calls: Record<string, number> = {};
  return { fn: (name: string) => () => { calls[name] = (calls[name] ?? 0) + 1; }, count: (name: string) => calls[name] ?? 0 };
}

function nearest(node: Node, type: string): Node | undefined {
  for (let at: Node | null = node.parent; at; at = at.parent) if (at.type === type) return at;
  return undefined;
}

const field = (tree: Tree) => tree.root.find((n) => String(n.type) === 'TextInput');
const doneBars = (tree: Tree) => tree.root.findAll((n) => String(n.type) === 'InputAccessoryView');
/** The behaviour of every `KeyboardAvoidingView` on screen, outermost first. */
const avoiders = (tree: Tree) => tree.root.findAll((n) => String(n.type) === 'KeyboardAvoidingView').map((a) => a.props.behavior);
/** The frame's empty-space target: the one press target screen readers skip. */
const emptySpace = (tree: Tree) => tree.root.find((n) => String(n.type) === 'Pressable' && n.props.accessible === false);

/** Renders `element` with `Platform.OS` set to `os`, restoring it (and unmounting) after `body`. */
async function on(os: 'ios' | 'android', element: React.ReactElement, body: (tree: Tree) => Promise<void>): Promise<void> {
  const before = Platform.OS;
  Platform.OS = os;
  try {
    const tree = await renderScreen(element);
    try { await body(tree); } finally { await unmountScreen(tree); }
  } finally {
    Platform.OS = before;
  }
}

/** What the keyboard does around the focused field, as its scroll view and avoider are wired. */
function around(tree: Tree, input: Node) {
  const scroll = nearest(input, 'ScrollView');
  return {
    scrolls: scroll != null,
    insetsForKeyboard: scroll?.props.automaticallyAdjustKeyboardInsets === true,
    dragDismisses: scroll?.props.keyboardDismissMode,
    tapsReachControls: scroll?.props.keyboardShouldPersistTaps === 'handled',
    doneBarLinked: doneBars(tree).some((bar) => bar.props.nativeID != null && bar.props.nativeID === input.props.inputAccessoryViewID),
  };
}

/** Where an action sits: pinned outside the scrolling content, and whether it rides above the
 *  keyboard on iOS (the avoider it sits in pads by the keyboard's height). */
function pinned(action: Node) {
  return { outsideScroll: nearest(action, 'ScrollView') == null, avoidance: nearest(action, 'KeyboardAvoidingView')?.props.behavior };
}

/** Presses Done, then empty space; returns how many times the keyboard went away. */
async function dismissBoth(tree: Tree): Promise<number> {
  const before = Keyboard.dismissed;
  await press(button(tree, COPY.keyboardDone));
  await press(emptySpace(tree));
  return Keyboard.dismissed - before;
}

/** Lets the report sheet's draft load (`reportDraftFor` reads the store). */
const draftLoaded = () => TestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });

const APP: InstalledApp = { id: 'timer', name: 'Timer', createdAt: 1, lineageId: 'main', record: { appId: 'timer', name: 'Timer', manifest: { capabilities: [] } } };
const ACCESS = { activeDescription: async () => 'A tea timer', activeSource: async () => 'export default {}' } as unknown as StoreAccess;
const ROWS = [
  { label: 'Timer', text: 'Counts down' },
  { label: 'Alert', text: 'Buzzes at zero' },
  { label: 'Look', text: 'A big dial' },
];
const OTHER_QUESTION = { id: 'cup', question: 'What size is the cup?', options: ['Small', 'Large'], select: 'one', other: true } as const;

export async function runKeyboardShellUiTests(h: Harness): Promise<void> {
  await h.test('compose opens without the keyboard, with the suggestions in view', async () => {
    await on('ios', <ComposeStep text="" editing={false} onChangeText={noop} onContinue={noop} onBack={noop} />, async (tree) => {
      h.ok(field(tree).props.autoFocus !== true, 'the description field is not focused on open');
      const shown = textOf(tree.root);
      h.ok([COPY.composeChipTimer, COPY.composeChipTracker, COPY.composeChipDice].every((chip) => shown.includes(chip)), 'the suggestions show');
    });
  });

  await h.test('compose on iOS: Continue rides above the keyboard; Done, empty space and a drag put the keyboard away without continuing', async () => {
    const s = spies();
    await on('ios', <ComposeStep text="A tea timer" editing={false} onChangeText={s.fn('change')} onContinue={s.fn('continue')} onBack={noop} />, async (tree) => {
      h.eq(pinned(button(tree, primaryActionLabel('compose', false))), { outsideScroll: true, avoidance: 'padding' }, 'Continue is pinned and padded above the keyboard');
      const input = around(tree, field(tree));
      h.eq([input.scrolls, input.insetsForKeyboard, input.tapsReachControls, input.doneBarLinked], [true, true, true, true], 'the field scrolls clear of the keyboard, taps reach the chips, and it has a Done bar');
      h.eq(input.dragDismisses, 'interactive', 'dragging the content pulls the keyboard down');
      h.eq(await dismissBoth(tree), 2, 'Done and a tap on empty space each put the keyboard away');
      h.eq([s.count('continue'), s.count('change')], [0, 0], 'without continuing or changing the text');
    });
  });

  await h.test('compose on Android: the resized window keeps Continue up, a drag dismisses, and there is no iOS Done bar', async () => {
    const s = spies();
    await on('android', <ComposeStep text="A tea timer" editing={false} onChangeText={noop} onContinue={s.fn('continue')} onBack={noop} />, async (tree) => {
      h.eq(pinned(button(tree, primaryActionLabel('compose', false))), { outsideScroll: true, avoidance: undefined }, 'Continue is pinned; adjustResize lifts it, so nothing pads it twice');
      const input = around(tree, field(tree));
      h.eq([input.insetsForKeyboard, input.dragDismisses, input.doneBarLinked], [false, 'on-drag', false], 'a drag dismisses; no inset of our own and no Done bar');
      h.eq(doneBars(tree).length, 0, 'no keyboard bar renders on Android');
      const before = Keyboard.dismissed;
      await press(emptySpace(tree));
      h.eq([Keyboard.dismissed - before, s.count('continue')], [1, 0], 'a tap on empty space puts the keyboard away, without continuing');
    });
  });

  await h.test('"Change it" opens compose for the app with its text and no keyboard, Continue pinned the same way', async () => {
    await on('ios', <ComposeStep text="A tea timer" editing editingName="Timer" onChangeText={noop} onContinue={noop} onBack={noop} />, async (tree) => {
      h.ok(field(tree).props.autoFocus !== true, 'the prefilled field is not focused on open');
      h.eq(pinned(button(tree, primaryActionLabel('compose', false))), { outsideScroll: true, avoidance: 'padding' }, 'Continue rides above the keyboard');
    });
  });

  await h.test('plan editing: the edited row scrolls clear of the keyboard, gets its own Done bar, and Build it stays pinned', async () => {
    const s = spies();
    const plan = <PlanStep rows={ROWS} loading={false} editing={false} onChangeRow={s.fn('row')} onBuild={s.fn('build')} onBack={noop} />;
    for (const os of ['ios', 'android'] as const) {
      await on(os, plan, async (tree) => {
        h.eq(doneBars(tree).length, 0, `${os}: no keyboard bar before a row is edited`);
        await press(tree.root.find((n) => String(n.type) === 'TouchableOpacity' && textOf(n).includes('A big dial')));
        const input = around(tree, field(tree));
        h.eq([input.scrolls, input.insetsForKeyboard, input.tapsReachControls, input.doneBarLinked], [true, os === 'ios', true, os === 'ios'], `${os}: the row's field scrolls clear, Save and Cancel take their taps, and iOS links a Done bar to it`);
        h.eq(pinned(button(tree, primaryActionLabel('plan', false))), { outsideScroll: true, avoidance: os === 'ios' ? 'padding' : undefined }, `${os}: Build it is pinned above the keyboard`);
      });
    }
    await on('ios', plan, async (tree) => {
      await press(tree.root.find((n) => String(n.type) === 'TouchableOpacity' && textOf(n).includes('A big dial')));
      h.eq(await dismissBoth(tree), 2, 'Done and empty space put the keyboard away');
      h.eq(field(tree).props.value, 'A big dial', 'leaving the row open');
      h.eq([s.count('row'), s.count('build')], [0, 0], 'saving and building nothing');
    });
  });

  await h.test('clarify "Other": the field scrolls clear of the keyboard and Next stays pinned; Return is its Done', async () => {
    for (const os of ['ios', 'android'] as const) {
      await on(os, <ClarifyStep prompt="A tea timer" questions={[OTHER_QUESTION]} answers={{}} loading={false} editing={false} onAnswer={noop} onContinue={noop} onBack={noop} />, async (tree) => {
        const other = field(tree);
        const input = around(tree, other);
        h.eq([input.scrolls, input.insetsForKeyboard, input.tapsReachControls], [true, os === 'ios', true], `${os}: the field scrolls clear, and the pills take their taps while typing`);
        h.eq(input.dragDismisses, os === 'ios' ? 'interactive' : 'on-drag', `${os}: a drag puts the keyboard away`);
        h.eq([other.props.multiline === true, other.props.returnKeyType, doneBars(tree).length], [false, 'done', 0], `${os}: one line, so Return puts the keyboard away and no bar is added`);
        h.eq(pinned(button(tree, primaryActionLabel('clarify', false))), { outsideScroll: true, avoidance: os === 'ios' ? 'padding' : undefined }, `${os}: Next is pinned above the keyboard`);
      });
    }
  });

  await h.test('the report sheet: its note scrolls in the sheet, Send stays pinned, and the sheet avoids the keyboard exactly once', async () => {
    const s = spies();
    const sheet = (
      <ReportSheet
        app={APP}
        access={ACCESS}
        options={reportClientOptions({ kind: 'absent' }, 'https://server.test', 'device', testAppInfo)}
        onClose={s.fn('close')}
        onUpdateRequired={noop}
        legalLanguage="en"
      />
    );
    for (const os of ['ios', 'android'] as const) {
      await on(os, sheet, async (tree) => {
        await draftLoaded();
        const input = around(tree, field(tree));
        h.eq([input.scrolls, input.tapsReachControls, input.doneBarLinked], [true, true, os === 'ios'], `${os}: the note scrolls in the sheet, the pills take their taps, and iOS links a Done bar`);
        h.eq(input.insetsForKeyboard, false, `${os}: the sheet's scroll view adds no keyboard inset of its own`);
        h.eq(avoiders(tree), [os === 'ios' ? 'padding' : undefined], `${os}: one avoider, the sheet's own`);
        h.ok(pinned(button(tree, COPY.reportSend)).outsideScroll && pinned(button(tree, COPY.cancel)).outsideScroll, `${os}: Send and Cancel are pinned below the note`);
      });
    }
    await on('ios', sheet, async (tree) => {
      await draftLoaded();
      h.eq(await dismissBoth(tree), 2, 'Done and empty space put the keyboard away');
      h.eq(s.count('close'), 0, 'without closing the sheet');
    });
  });

  await h.test('settings: the server field scrolls clear of the keyboard; with no pinned action nothing else pads', async () => {
    const settings = (
      <SettingsScreen
        onBack={noop}
        legalLanguage="en"
        internalBuild
        serverUrl="https://saved.example"
        onServerUrlChange={noop}
        onUseDefaultServer={noop}
        highlighting
        onHighlightingChange={noop}
        consentStatus={{ kind: 'granted', version: AI_CONSENT_VERSION, grantedAt: '2026-09-18' }}
        canProbe={false}
        onOpenAIFeatures={noop}
        errorDetails
        onErrorDetailsChange={noop}
        deviceId="test-device"
        onResetDeviceId={noop}
      />
    );
    for (const os of ['ios', 'android'] as const) {
      await on(os, settings, async (tree) => {
        const input = around(tree, field(tree));
        h.eq([input.scrolls, input.insetsForKeyboard, input.tapsReachControls], [true, os === 'ios', true], `${os}: the field scrolls clear, and the switches take their taps while typing`);
        h.eq(input.dragDismisses, os === 'ios' ? 'interactive' : 'on-drag', `${os}: a drag puts the keyboard away`);
        h.eq(avoiders(tree), [undefined], `${os}: no padding on top of the scroll view's own inset`);
      });
    }
  });
}
