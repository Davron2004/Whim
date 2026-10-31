// Node acceptance suite for the restyled SDK components on iOS, in the dark scheme, at 135% text and
// with Increase Contrast (docs/design/system.md §6, §7.2; sdk-design-system "SDK components follow the
// system's defaults"). The Android/light defaults are `restyle-android.acceptance.tsx`.
// Auto-discovered by `src/sdk/test/run.mjs`.
import assert from 'node:assert';
import * as React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Button, Card, Checkbox, List, ListItem, Modal, ProgressBar, Slider, Stepper, Switch, TextInput } from '../index';
import { COLORS, TINTS } from '../../design/tokens';
import { contrastRatio } from '../../design/tints';

const THEME = { scheme: 'dark', tint: 'purple', platform: 'ios', fontScale: 1.35, increaseContrast: true, reduceMotion: false };
(globalThis as { __WHIM_THEME__?: unknown }).__WHIM_THEME__ = THEME;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const dark = COLORS.dark;
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

/** The outermost element of a rendered tree. */
function top(element: React.ReactElement): ReactTestInstance {
  return mount(element).root.find((n) => typeof n.type === 'string');
}

try {
  // ── iOS targets and shapes ──────────────────────────────────────────────────
  {
    const box = mount(<Checkbox label="Stretch first" checked onChange={() => {}} />).root.find((n) => n.props.role === 'checkbox');
    assert.deepStrictEqual(styleOf(box).minHeight, '44px', 'on iOS the checkbox row is the 44 target');
    const sw = mount(<Switch label="Remind me" value={false} onChange={() => {}} />).root;
    const track = sw.find((n) => n.type === 'span' && styleOf(n).width === '48px');
    assert.deepStrictEqual(styleOf(track).border, 'none', 'the iOS switch is an unoutlined 48 track');
    // WCAG 1.4.11 (product-owner ruling, design-system-v1 task 6.0): with no outline, the off
    // track's own fill is its edge, and it must hold 3:1 against the surface it sits on.
    const offTrack = contrastRatio(String(styleOf(track).background), dark.surface);
    assert.ok(offTrack >= 3, `the dark iOS off track holds 3:1 on surface (${offTrack.toFixed(2)}:1)`);
    const sliderTrack = mount(<Slider value={0} onChange={() => {}} />).root.find((n) => n.type === 'div' && styleOf(n).height === '6px');
    const empty = contrastRatio(String(styleOf(sliderTrack).background), dark.surface);
    assert.ok(empty >= 3, `the dark slider's empty track holds 3:1 on surface (${empty.toFixed(2)}:1)`);
    const on = mount(<Switch value onChange={() => {}} />).root.find((n) => n.type === 'span' && styleOf(n).width === '48px');
    assert.deepStrictEqual(styleOf(on).background, TINTS.purple.dark, 'and the tint when on');
  }

  // ── From 135%, paired buttons and labelled steppers stack ────────────────────
  {
    assert.deepStrictEqual(styleOf(top(<Button label="Export" variant="secondary" />)).flex, '1 1 100%', 'a button takes a line of its own, so two in a Row stack');
    const stepper = top(<Stepper label="Laps" value={2} onChange={() => {}} />);
    assert.deepStrictEqual(styleOf(stepper).flexDirection, 'column', 'a labelled stepper puts its label above the capsule');
    const ring = mount(<ProgressBar variant="ring" value={0.4} label="2:30" />).root.find((n) => n.type === 'span');
    assert.deepStrictEqual(styleOf(ring).position, undefined, 'the ring label moves under the ring');
  }

  // ── Increase Contrast outlines groups; a Modal's groups and fields paint sheet-group ──
  {
    const outline = `1px solid ${dark.border}`;
    const card = styleOf(top(<Card><ListItem title="x" /></Card>));
    const list = styleOf(top(<List><ListItem title="x" /></List>));
    assert.deepStrictEqual([card.border, list.border], [outline, outline], 'Card and List draw a 1 px border outline');
    assert.deepStrictEqual([card.background, list.background], [dark.surface, dark.surface], 'on the screen they are surface');

    const sheet = mount(
      <Modal visible onClose={() => {}}>
        <Card>
          <TextInput label="Name" value="" placeholder="Lunch walk" />
        </Card>
        <List>
          <ListItem title="x" />
        </List>
      </Modal>,
    ).root;
    const inSheet = sheet.findAll((n) => n.type === 'div' && styleOf(n).border === outline).map((n) => styleOf(n).background);
    assert.deepStrictEqual(inSheet, [dark['sheet-group'], dark['sheet-group']], 'inside a Modal, Card and List paint sheet-group');
    const input = sheet.find((n) => n.type === 'input');
    assert.deepStrictEqual(styleOf(input).background, dark['sheet-group'], 'and so does a field');
    assert.ok(dark['sheet-group'] !== dark.surface, 'precondition: in dark the two differ');
    const placeholder = sheet.find((n) => n.type === 'span' && n.children.join('') === 'Lunch walk');
    assert.deepStrictEqual(styleOf(placeholder).color, dark.text, 'the placeholder is text-muted, which Increase Contrast makes text');
    assert.deepStrictEqual([input.props.placeholder, input.props['aria-placeholder']], [undefined, 'Lunch walk'], 'the native placeholder is replaced, and still announced');
  }
} finally {
  delete (globalThis as { __WHIM_THEME__?: unknown }).__WHIM_THEME__;
}

console.log('SDK restyle (iOS, dark, 135%, Increase Contrast) acceptance: PASS');
