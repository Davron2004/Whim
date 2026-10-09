// Node acceptance suite for the restyled SDK components on Android in the light scheme
// (docs/design/system.md §7.2; sdk-design-system "SDK components follow the system's defaults", "The SDK
// adds components and deprecates without removing"). The theme is read once per realm, so the iOS,
// dark, 135% and Increase Contrast cases live in `restyle-ios.acceptance.tsx`.
// Auto-discovered by `src/sdk/test/run.mjs`.
import assert from 'node:assert';
import * as React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Badge, Button, Card, Checkbox, Heading, Modal, ProgressBar, Row, Screen, Switch, Text, type AppSpec } from '../index';
import { NavRoot } from '../navigation';
import { COLORS, LAYOUT, ON_TINT, STATUS, TINTS } from '../../design/tokens';

const THEME = { scheme: 'light', tint: 'purple', platform: 'android', fontScale: 1, increaseContrast: false, reduceMotion: false };
(globalThis as { __WHIM_THEME__?: unknown }).__WHIM_THEME__ = THEME;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { __whimGeneration: 1, parent: { postMessage(): void {} }, addEventListener(): void {}, removeEventListener(): void {} },
});

const light = COLORS.light;
type Style = Record<string, unknown>;

function mount(element: React.ReactElement): ReactTestRenderer {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(element);
  });
  return renderer!;
}

function styleOf(node: ReactTestInstance): Style {
  return (node.props.style ?? {}) as Style;
}

function only(element: React.ReactElement, type: string): ReactTestInstance {
  return mount(element).root.find((n) => n.type === type);
}

try {
  // ── Button: a 52 capsule in the tint; secondary, ghost, danger; disabled by colour ──
  {
    const primary = styleOf(only(<Button label="Save" />, 'button'));
    assert.deepStrictEqual(
      [primary.minHeight, primary.borderRadius, primary.background, primary.color],
      [`${LAYOUT.buttonHeight.large}px`, '999px', TINTS.purple.light, ON_TINT.light],
      'primary is a 52 capsule filled with the tint, its label on-tint',
    );
    assert.deepStrictEqual(primary.fontSize, '17px', 'the label is 17');
    assert.deepStrictEqual(primary.fontWeight, 600, 'and 600');

    const variants = (['secondary', 'ghost', 'danger'] as const).map((variant) => {
      const s = styleOf(only(<Button label="x" variant={variant} />, 'button'));
      return [s.background, s.color];
    });
    assert.deepStrictEqual(
      variants,
      [
        [light.fill, light.text],
        ['transparent', TINTS.purple.light],
        [STATUS.danger.soft.light, STATUS.danger.text.light],
      ],
      'secondary is fill + text, ghost tint text on nothing, danger its text form on its soft form (never a fill)',
    );

    const legacy = styleOf(only(<Button label="Save" radius="sm" />, 'button'));
    assert.deepStrictEqual(legacy.borderRadius, '999px', 'an old bundle’s radius is accepted and ignored');

    let presses = 0;
    const disabledNode = only(<Button label="Sync" variant="danger" disabled onPress={() => presses++} />, 'button');
    const disabled = styleOf(disabledNode);
    assert.deepStrictEqual([disabled.background, disabled.color, disabled.opacity], [light.fill, light['text-3'], 1], 'disabled is fill + text-3 at full opacity, whatever the variant');
    act(() => disabledNode.props.onClick());
    assert.deepStrictEqual(presses, 0, 'and a disabled tap does nothing');
    assert.ok(disabled.flex === undefined, 'at the default text scale a button keeps its own width');
  }

  // ── Heading still renders, as Text at its size ──────────────────────────────
  {
    const heading = only(<Heading>Old title</Heading>, 'div');
    const text = only(<Text size="title">Old title</Text>, 'span');
    const { margin, ...headingStyle } = styleOf(heading);
    assert.deepStrictEqual(margin, 0);
    assert.deepStrictEqual(headingStyle, styleOf(text), 'Heading is styled exactly as Text size="title"');
    assert.deepStrictEqual(heading.children, ['Old title'], 'and shows its text');
  }

  // ── Row: centred and packed at the start by default ─────────────────────────
  {
    const row = styleOf(only(<Row><Text>a</Text></Row>, 'div'));
    assert.deepStrictEqual([row.alignItems, row.justifyContent], ['center', 'flex-start'], 'Row defaults to align center, justify start');
    const odd = styleOf(only(<Row align={'constructor' as 'start'} justify={'toString' as 'start'}><Text>a</Text></Row>, 'div'));
    assert.deepStrictEqual([odd.alignItems, odd.justifyContent], ['center', 'flex-start'], 'an unknown value from an old bundle falls back to the defaults');
  }

  // ── Checkbox and Switch reach the Android target with the whole row ──────────
  {
    const log: boolean[] = [];
    const box = only(<Checkbox label="Bring water" checked={false} onChange={(b) => log.push(b)} />, 'button');
    assert.deepStrictEqual(box.props.role, 'checkbox');
    assert.ok(Number.parseFloat(String(styleOf(box).minHeight)) >= 48, `the checkbox row is at least 48 high (${String(styleOf(box).minHeight)})`);
    act(() => box.props.onClick());
    assert.deepStrictEqual(log, [true], 'tapping the row toggles it');

    const sw = mount(<Switch label="Remind me" value={false} onChange={() => {}} />).root.find((n) => n.props.role === 'switch');
    assert.ok(Number.parseFloat(String(styleOf(sw).minHeight)) >= 48, 'the switch row is at least 48 high');
    const track = sw.findAll((n) => n.type === 'span' && styleOf(n).width === '52px');
    assert.deepStrictEqual(track.length, 1, 'Android draws the Material 52-wide track');
    assert.ok(String(styleOf(track[0]).border).startsWith('2px solid'), 'with its outline');
  }

  // ── Badge: soft fills, the status tones carry their icon ─────────────────────
  {
    const icons = (['neutral', 'primary', 'positive', 'warning', 'danger'] as const).map(
      (tone) => mount(<Badge label="x" tone={tone} />).root.findAll((n) => n.type === 'svg').length,
    );
    assert.deepStrictEqual(icons, [0, 0, 1, 1, 1], 'only the status tones carry an icon');
    const warning = styleOf(only(<Badge label="Due soon" tone="warning" />, 'span'));
    assert.deepStrictEqual([warning.background, warning.color], [STATUS.warning.soft.light, STATUS.warning.text.light], 'warning is amber: its soft fill under its text form');
  }

  // ── ProgressBar: bar with a label, ring with the label inside ────────────────
  {
    const bar = mount(<ProgressBar value={0.25} label="1 of 4" />).root;
    const progress = bar.find((n) => n.props.role === 'progressbar');
    assert.deepStrictEqual([progress.props['aria-valuenow'], progress.props['aria-valuetext']], [25, '1 of 4']);
    assert.ok(bar.findAll((n) => n.type === 'span' && n.children.join('') === '1 of 4').length === 1, 'the bar shows its label');

    const ring = mount(<ProgressBar variant="ring" value={0.5} label="7" />).root;
    const circles = ring.findAll((n) => n.type === 'circle');
    assert.deepStrictEqual(circles.length, 2, 'a ring is a track and an arc');
    const r = Number(circles[1].props.r);
    assert.ok(Math.abs(Number(circles[1].props.strokeDashoffset) - Math.PI * r) < 1e-9, 'half a value leaves half the circumference undrawn');
    assert.deepStrictEqual(styleOf(ring.find((n) => n.type === 'span')).position, 'absolute', 'at the default text scale the label sits inside the ring');
    assert.deepStrictEqual(mount(<ProgressBar variant="ring" value={0} />).root.findAll((n) => n.type === 'circle').length, 1, 'an empty ring draws no arc (a round cap would leave a dot)');
  }

  // ── Card: surface, no border ────────────────────────────────────────────────
  {
    const card = styleOf(only(<Card radius="sm"><Text>x</Text></Card>, 'div'));
    assert.deepStrictEqual([card.background, card.border, card.borderRadius], [light.surface, 'none', '20px'], 'a card is surface, r-lg, no border; its old radius is ignored');
  }

  // ── Modal: close button, scrim, and the action row clears the host chrome ────
  {
    let closes = 0;
    function WithModal() {
      return (
        <Screen>
          <Modal visible title="Add a walk" onClose={() => closes++}>
            <Button label="Save" />
          </Modal>
        </Screen>
      );
    }
    const spec: AppSpec = { name: 'Modal', initial: 'Home', screens: { Home: WithModal }, capabilities: [] };
    const root = mount(<NavRoot spec={spec} chromeInsetBottom={84} />).root;
    const dialog = root.find((n) => n.props.role === 'dialog');
    assert.deepStrictEqual([styleOf(dialog).background, dialog.props['aria-label']], [light.sheet, 'Add a walk'], 'the sheet paints sheet and is named by its title');
    const close = root.find((n) => n.type === 'button' && n.props['aria-label'] === 'Close');
    act(() => close.props.onClick());
    assert.deepStrictEqual(closes, 1, 'the close button calls onClose');
    act(() => dialog.props.onClick({ stopPropagation() {} }));
    assert.deepStrictEqual(closes, 1, 'a tap inside the sheet does not');
    act(() => dialog.parent!.props.onClick());
    assert.deepStrictEqual(closes, 2, 'a scrim tap does');
    const body = dialog.find((n) => n.type === 'div' && String(styleOf(n).padding).includes('84px'));
    assert.ok(body.findAll((n) => n.type === 'button' && n.children.includes('Save')).length === 1, 'the content area holding the action pads by the 84 px the orb covers, though the Modal sits inside a Screen');
  }
} finally {
  delete (globalThis as { __WHIM_THEME__?: unknown }).__WHIM_THEME__;
}

console.log('SDK restyle (Android, light) acceptance: PASS');
