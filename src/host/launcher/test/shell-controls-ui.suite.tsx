/** The shell's control primitives (design-system-v1 chain-10; system.md §2.7, §4.3, §4.5, §7.1):
 *  Text on the type scale, Button's seven variants, IconButton and the back control, Chip. Colours,
 *  type, press scales and the reduced press are read from system.md itself, so the doc and the
 *  primitives can't drift apart; motion is read from what each control asks Reanimated for. */
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { hapticCalls, Platform, setColorScheme, StyleSheet, accessibilitySettings, windowMetrics } from './native-host';
import { animations, isStep, type Step } from './native-reanimated';
import { hostType, press, renderScreen, textOf, unmountScreen } from './react-screen';
import { Text } from '../../ui/Text';
import { Button } from '../../ui/Button';
import { BackButton, IconButton } from '../../ui/IconButton';
import { Chip } from '../../ui/Chip';
import { haptics } from '../../haptics';
import { COLORS, LAYOUT, ON_TINT, SPRINGS, TIMINGS, TINTS, type ColorRole, type Scheme, type TypeToken } from '../../../design/tokens';
import { ICON_PATHS } from '../../../design/icons/paths';
import type { ButtonVariant } from '../../ui/tokens-pure';

type Node = TestRenderer.ReactTestInstance;
type Style = Record<string, unknown>;

const SYSTEM_MD = fs.readFileSync(path.join(process.cwd(), 'docs/design/system.md'), 'utf8');

const act = (fn: () => void) => TestRenderer.act(async () => { fn(); });
const style = (node: Node): Style => StyleSheet.flatten(node.props.style) as Style;
const all = (tree: TestRenderer.ReactTestRenderer, name: string) => tree.root.findAll((n) => hostType(n) === name);
const one = (tree: TestRenderer.ReactTestRenderer, name: string): Node => {
  const found = all(tree, name);
  if (found.length !== 1) throw new Error(`Expected one ${name}, got ${found.length}`);
  return found[0];
};
const drawn = (tree: TestRenderer.ReactTestRenderer) => all(tree, 'Path').map((p) => p.props.d as string);

async function resetPhone(): Promise<void> {
  await act(() => setColorScheme('light'));
  accessibilitySettings.reduceMotion = false;
  windowMetrics.fontScale = 1;
  Platform.OS = 'ios';
}

/** system.md §7.1's Button variant table: variant → [fill, label], each a colour role, `none`, or
 *  the tint's value / its on-tint colour. */
function documentedVariants(): Map<ButtonVariant, [string, string]> {
  const table = SYSTEM_MD.slice(SYSTEM_MD.indexOf('| Variant | Fill / label | Use |'));
  const rows = new Map<ButtonVariant, [string, string]>();
  for (const line of table.split('\n').slice(2)) {
    if (!line.startsWith('|')) break;
    const [variant, cell] = line.split('|').slice(1, 3).map((c) => c.trim());
    const [fill, label] = cell.split(' / ');
    const role = (part: string) => (/`([\w-]+)`/.exec(part)?.[1] ?? part.trim());
    rows.set(variant.replace(/`/g, '') as ButtonVariant, [fill.startsWith('app ') ? 'tint' : role(fill), role(label)]);
  }
  return rows;
}

/** §4.3 rule 5's press scales by what is pressed. */
function documentedPressScale(of: 'buttons' | 'chips' | 'icon buttons'): number {
  const start = SYSTEM_MD.indexOf('**Press:** scale ');
  const rule = SYSTEM_MD.slice(start, SYSTEM_MD.indexOf('\n', start));
  const m = [...rule.matchAll(/(\d\.\d+) \(([a-z ,]+)\)/g)].find(([, , what]) => what.split(', ').includes(of));
  if (!m) throw new Error(`system.md §4.3 names no press scale for ${of}`);
  return Number(m[1]);
}

/** §4.5: "press scale becomes opacity X over N ms". */
function documentedReducedPress(): { opacity: number; duration: number } {
  const m = /press\s+scale\s+becomes\s+opacity\s+([\d.]+)\s+over\s+(\d+)\s+ms/.exec(SYSTEM_MD);
  if (!m) throw new Error('system.md §4.5 no longer states the reduced press');
  return { opacity: Number(m[1]), duration: Number(m[2]) };
}

/** A §2.7 type row: size / line, weight, tracking in em. */
function documentedType(token: TypeToken): { size: number; line: number; weight: number; header?: number; tracking: number } {
  const m = new RegExp(`\\| \`${token}\` \\| (\\d+) / (\\d+) \\| (\\d+)(?: \\((\\d+) headers\\))? \\| ([+\\u2212-]?[\\d.]+) \\|`).exec(SYSTEM_MD);
  if (!m) throw new Error(`system.md §2.7 has no row for ${token}`);
  return { size: +m[1], line: +m[2], weight: +m[3], header: m[4] ? +m[4] : undefined, tracking: Number(m[5].replace('−', '-')) };
}

const springTo = (to: number): Step | undefined => animations.filter(isStep).find((a) => a.kind === 'spring' && a.to === to);
const timingTo = (to: unknown): Step | undefined => animations.filter(isStep).find((a) => a.kind === 'timing' && a.to === to);
const physics = (name: keyof typeof SPRINGS) => ({ mass: 1, stiffness: SPRINGS[name].stiffness, damping: SPRINGS[name].damping });

function channels(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

export async function runShellControlsUiTests(h: Harness): Promise<void> {
  await h.test('Text sets every size of the type scale as system.md documents it, with tracking in points', async () => {
    for (const token of ['largeTitle', 'title1', 'headline', 'body', 'callout', 'footnote', 'caption'] as TypeToken[]) {
      const doc = documentedType(token);
      const tree = await renderScreen(<Text type={token}>Pour Timer</Text>);
      const face = style(one(tree, 'Text'));
      h.eq([face.fontSize, face.lineHeight, face.fontWeight], [doc.size, doc.line, String(doc.weight)], `${token} size, line and weight`);
      h.ok(Math.abs((face.letterSpacing as number) - doc.tracking * doc.size) < 0.001, `${token} tracks ${doc.tracking} em (got ${face.letterSpacing} pt)`);
      await unmountScreen(tree);
    }
    const header = await renderScreen(<Text type="footnote" header>Your apps</Text>);
    h.eq(style(one(header, 'Text')).fontWeight, String(documentedType('footnote').header), 'a section header takes the footnote header weight');
    await unmountScreen(header);
  });

  await h.test('Text: titles are headings, counters are tabular, and text scales to 200%', async () => {
    const title = await renderScreen(<Text type="title1">Settings</Text>);
    h.eq(one(title, 'Text').props.accessibilityRole, 'header', 'a title is a heading to screen readers');
    await unmountScreen(title);
    const meta = await renderScreen(<Text type="footnote" tabular>v4 · 0:12</Text>);
    const node = one(meta, 'Text');
    h.eq(style(node).fontVariant, ['tabular-nums'], 'tabular figures');
    h.eq(node.props.accessibilityRole, 'text', 'plain text otherwise');
    h.ok(/Text scales to 200%/.test(SYSTEM_MD) && node.props.maxFontSizeMultiplier === 2, 'Dynamic Type up to the 200% system.md allows');
    await unmountScreen(meta);
  });

  await h.test('Button paints each variant with the fill and label system.md §7.1 gives it, in both schemes', async () => {
    const documented = documentedVariants();
    h.eq([...documented.keys()].sort((a, b) => a.localeCompare(b)), ['danger', 'ember', 'ink', 'plain', 'plain-ember', 'secondary', 'tint'], 'the table names the seven variants');
    for (const scheme of ['light', 'dark'] as Scheme[]) {
      await act(() => setColorScheme(scheme));
      for (const [variant, [fill, label]] of documented) {
        const tree = await renderScreen(<Button label="Open it" variant={variant} tint="ocean" onPress={() => {}} />);
        const capsule = style(one(tree, 'Animated.View'));
        const text = style(one(tree, 'Text'));
        let wantFill = fill === 'none' ? 'transparent' : COLORS[scheme][fill as ColorRole];
        let wantLabel = COLORS[scheme][label as ColorRole];
        if (fill === 'tint') {
          wantFill = TINTS.ocean[scheme];
          wantLabel = ON_TINT[scheme];
        }
        h.eq([capsule.backgroundColor, text.color], [wantFill, wantLabel], `${scheme} ${variant}`);
        await unmountScreen(tree);
      }
    }
    await resetPhone();
  });

  await h.test('a pressed filled button darkens its fill by 8%; a plain one stays clear', async () => {
    const tree = await renderScreen(<Button label="Make it" variant="ember" onPress={() => {}} />);
    await act(() => one(tree, 'Pressable').props.onPressIn());
    const pressed = channels(style(one(tree, 'Animated.View')).backgroundColor as string);
    const rest = channels(COLORS.light.ember);
    h.ok(pressed.every((c, i) => Math.abs(c - rest[i] * 0.92) <= 0.5), `ember pressed is 8% darker (got ${pressed}, rest ${rest})`);
    await act(() => one(tree, 'Pressable').props.onPressOut());
    h.eq(style(one(tree, 'Animated.View')).backgroundColor, COLORS.light.ember, 'released, the fill returns');
    await unmountScreen(tree);
    const plain = await renderScreen(<Button label="Not now" variant="plain" onPress={() => {}} />);
    await act(() => one(plain, 'Pressable').props.onPressIn());
    h.eq(style(one(plain, 'Animated.View')).backgroundColor, 'transparent', 'a plain button has no fill to darken');
    await unmountScreen(plain);
  });

  await h.test('a disabled button is fill + text-3, announced disabled, and cannot be pressed', async () => {
    let pressed = 0;
    const tree = await renderScreen(<Button label="Send report" variant="ink" disabled onPress={() => { pressed++; }} />);
    h.eq([style(one(tree, 'Animated.View')).backgroundColor, style(one(tree, 'Text')).color], [COLORS.light.fill, COLORS.light['text-3']], 'fill and text-3, never a faded ink');
    const control = one(tree, 'Pressable');
    h.eq(control.props.accessibilityState, { disabled: true, busy: false }, 'announced disabled');
    await h.throws(() => press(control), 'disabled', 'a press does not reach it');
    h.eq(pressed, 0, 'its handler never ran');
    await unmountScreen(tree);
  });

  await h.test('a busy button shows its busy words, is announced busy, and ignores taps', async () => {
    let pressed = 0;
    const tree = await renderScreen(<Button label="Send report" busy="Sending…" variant="ink" haptic="handoff" onPress={() => { pressed++; }} />);
    const control = one(tree, 'Pressable');
    h.eq(textOf(one(tree, 'Text')), 'Sending…', 'the label becomes the busy words');
    h.eq([control.props.accessibilityLabel, control.props.accessibilityState], ['Sending…', { disabled: false, busy: true }], 'read as busy');
    hapticCalls.splice(0);
    await act(() => control.props.onPressIn());
    await press(control);
    h.eq([pressed, hapticCalls.length], [0, 0], 'the tap does nothing and plays nothing');
    await unmountScreen(tree);
  });

  await h.test('a button plays only the haptic moment it confirms: prepared on touch-down, played on the press', async () => {
    hapticCalls.splice(0);
    haptics.prepare('handoff');
    haptics.play('handoff');
    const expected = hapticCalls.splice(0);
    let pressed = 0;
    const tree = await renderScreen(<Button label="Make it" variant="ember" haptic="handoff" onPress={() => { pressed++; }} />);
    const control = one(tree, 'Pressable');
    await act(() => control.props.onPressIn());
    await press(control);
    h.eq([hapticCalls.splice(0), pressed], [expected, 1], 'handoff prepared then played, and the press ran');
    await unmountScreen(tree);
    const plainTap = await renderScreen(<Button label="Not now" variant="plain" onPress={() => {}} />);
    await act(() => one(plainTap, 'Pressable').props.onPressIn());
    await press(one(plainTap, 'Pressable'));
    h.eq(hapticCalls.splice(0), [], 'a plain tap plays no haptic');
    await unmountScreen(plainTap);
  });

  await h.test('press feedback: buttons, chips and icon buttons scale as §4.3 says, on the named springs', async () => {
    const cases: Array<[string, React.ReactElement, 'buttons' | 'chips' | 'icon buttons']> = [
      ['Button', <Button label="Open it" variant="secondary" onPress={() => {}} />, 'buttons'],
      ['Chip', <Chip label="V60" onPress={() => {}} />, 'chips'],
      ['IconButton', <IconButton icon="x" label="Close" onPress={() => {}} />, 'icon buttons'],
    ];
    for (const [name, element, kind] of cases) {
      const tree = await renderScreen(element);
      const control = one(tree, 'Pressable');
      const scale = documentedPressScale(kind);
      animations.splice(0);
      await act(() => control.props.onPressIn());
      h.eq(springTo(scale)?.config, physics('instant'), `${name} presses to ${scale} with instant`);
      await act(() => control.props.onPressOut());
      h.eq(springTo(1)?.config, physics('snappy'), `${name} releases with snappy`);
      h.eq(control.props.pressRetentionOffset, 10, `${name}: 10 pt off the control cancels`);
      await unmountScreen(tree);
    }
  });

  await h.test('under Reduce Motion a press is the documented opacity fade, never a scale, and it is not skipped', async () => {
    accessibilitySettings.reduceMotion = true;
    const reduced = documentedReducedPress();
    for (const element of [<Button label="Open it" variant="ink" onPress={() => {}} />, <Chip label="V60" onPress={() => {}} />, <IconButton icon="x" label="Close" onPress={() => {}} />]) {
      const tree = await renderScreen(element);
      animations.splice(0);
      await act(() => one(tree, 'Pressable').props.onPressIn());
      h.eq(animations.filter((a) => a.kind === 'spring'), [], 'no spring, no scale');
      h.eq(timingTo(reduced.opacity)?.config, { duration: reduced.duration, reduceMotion: 'never' }, `opacity ${reduced.opacity} over ${reduced.duration} ms, played even though the OS reduces motion`);
      await unmountScreen(tree);
    }
    await resetPhone();
  });

  await h.test('every control reaches the platform\'s touch target, whatever its visual size', async () => {
    for (const os of ['ios', 'android'] as const) {
      Platform.OS = os;
      const target = LAYOUT.touchTarget[os];
      const controls: Array<[string, React.ReactElement]> = [
        ['small Button', <Button label="Save" size="small" variant="ink" onPress={() => {}} />],
        ['medium Button', <Button label="Save" size="medium" variant="ink" onPress={() => {}} />],
        ['Chip', <Chip label="V60" onPress={() => {}} />],
        ['IconButton', <IconButton icon="x" label="Close" onPress={() => {}} />],
      ];
      for (const [name, element] of controls) {
        const tree = await renderScreen(element);
        const visual = style(one(tree, 'Animated.View'));
        const height = (visual.minHeight ?? visual.height) as number;
        const slop = one(tree, 'Pressable').props.hitSlop as number;
        h.ok(height < target || slop === 0, `${os} ${name}: the test measures a control (${height} pt) that needs no slop only when it is already big enough`);
        h.ok(height + 2 * slop >= target, `${os} ${name}: ${height} pt + ${slop} slop each side reaches ${target}`);
        await unmountScreen(tree);
      }
    }
    await resetPhone();
  });

  await h.test('a focused button shows a 2 pt text-coloured ring outside it; blurred, the ring goes', async () => {
    const tree = await renderScreen(<Button label="Open it" variant="tint" tint="blue" onPress={() => {}} />);
    const ring = () => all(tree, 'View').filter((v) => style(v).borderWidth === 2);
    h.eq(ring().length, 0, 'no ring at rest');
    await act(() => one(tree, 'Pressable').props.onFocus());
    h.eq(ring().map((v) => [style(v).borderColor, style(v).top]), [[COLORS.light.text, -4]], 'a text ring 2 pt outside the capsule');
    await act(() => one(tree, 'Pressable').props.onBlur());
    h.eq(ring().length, 0, 'gone on blur');
    await unmountScreen(tree);
  });

  await h.test('IconButton is labelled for screen readers; filled draws its icon on a fill disc', async () => {
    const tree = await renderScreen(<IconButton icon="settings" label="Settings" variant="filled" onPress={() => {}} />);
    const control = one(tree, 'Pressable');
    h.eq([control.props.accessibilityRole, control.props.accessibilityLabel], ['button', 'Settings'], 'a named button');
    h.ok(all(tree, 'View').some((v) => style(v).backgroundColor === COLORS.light.fill && style(v).width === 36), 'a 36 pt fill disc');
    h.eq(drawn(tree), [ICON_PATHS.settings], 'its icon');
    await unmountScreen(tree);
  });

  await h.test('the back control is each platform\'s own glyph, read as "Back"', async () => {
    for (const [os, glyph] of [['ios', 'chevron-left'], ['android', 'arrow-left']] as const) {
      Platform.OS = os;
      let backs = 0;
      const tree = await renderScreen(<BackButton onPress={() => { backs++; }} />);
      h.eq(drawn(tree), [ICON_PATHS[glyph]], `${os} draws ${glyph}`);
      h.eq(one(tree, 'Pressable').props.accessibilityLabel, 'Back', 'read as Back');
      await press(one(tree, 'Pressable'));
      h.eq(backs, 1, 'pressing it goes back');
      await unmountScreen(tree);
    }
    await resetPhone();
  });

  await h.test('Chip states take the colours §7.1 names, and only a selected chip carries the check', async () => {
    const chip = /Unselected `([\w-]+)`\/`([\w-]+)`; selected `([\w-]+)`\/`([\w-]+)` with a (\d+) pt `check`/.exec(SYSTEM_MD);
    const decide = /"Decide for me": unselected `([\w-]+)` \+ `([\w-]+)`, selected `([\w-]+)` \+ `([\w-]+)` \+ `check`/.exec(SYSTEM_MD);
    if (!chip || !decide) throw new Error('system.md §7.1 no longer states the chip colours');
    const c = COLORS.light;
    const cases: Array<[string, React.ReactElement, string, string, boolean]> = [
      ['choice', <Chip label="V60" onPress={() => {}} />, chip[1], chip[2], false],
      ['selected choice', <Chip label="V60" selected onPress={() => {}} />, chip[3], chip[4], true],
      ['decide', <Chip label="Decide for me" kind="decide" onPress={() => {}} />, decide[1], decide[2], false],
      ['selected decide', <Chip label="Decide for me" kind="decide" selected onPress={() => {}} />, decide[3], decide[4], true],
      ['suggestion, even if told selected', <Chip label="A tip splitter" kind="suggestion" selected onPress={() => {}} />, chip[1], chip[2], false],
    ];
    for (const [name, element, fill, label, check] of cases) {
      const tree = await renderScreen(element);
      h.eq([style(one(tree, 'Animated.View')).backgroundColor, style(one(tree, 'Text')).color], [c[fill as ColorRole], c[label as ColorRole]], `${name} colours`);
      h.eq(drawn(tree), check ? [ICON_PATHS.check] : [], `${name} ${check ? 'carries' : 'has no'} check`);
      if (check) h.eq(one(tree, 'Svg').props.width, Number(chip[5]), 'the check is 16 pt');
      await unmountScreen(tree);
    }
  });

  await h.test('Chip: selecting fades the fill over the colour timing; a change of appearance repaints at once', async () => {
    const tree = await renderScreen(<Chip label="V60" onPress={() => {}} />);
    animations.splice(0);
    await TestRenderer.act(async () => tree.update(<Chip label="V60" selected onPress={() => {}} />));
    const fade = timingTo(COLORS.light.ink);
    h.eq((fade?.config as Style | undefined)?.duration, TIMINGS.color, 'the fill fades to ink over the colour timing');
    h.eq((fade?.config as Style | undefined)?.reduceMotion, 'never', 'the colour fade is kept under Reduce Motion');
    animations.splice(0);
    await act(() => setColorScheme('dark'));
    h.eq(animations.filter((a) => a.kind === 'timing'), [], 'no animated light/dark switch');
    await TestRenderer.act(async () => tree.update(<Chip label="V60" selected onPress={() => {}} />));
    h.eq(style(one(tree, 'Animated.View')).backgroundColor, COLORS.dark.ink, 'the next frame is dark ink');
    await unmountScreen(tree);
    await resetPhone();
  });

  await h.test('Chip: a selection move plays the selection haptic; a suggestion plays none; roles say how it is picked', async () => {
    hapticCalls.splice(0);
    haptics.prepare('selection');
    haptics.play('selection');
    const expected = hapticCalls.splice(0);
    const single = await renderScreen(<Chip label="V60" selected onPress={() => {}} />);
    await act(() => one(single, 'Pressable').props.onPressIn());
    await press(one(single, 'Pressable'));
    h.eq(hapticCalls.splice(0), expected, 'selection prepared and played');
    h.eq([one(single, 'Pressable').props.accessibilityRole, one(single, 'Pressable').props.accessibilityState], ['radio', { checked: true, disabled: false }], 'one of several: a checked radio');
    await unmountScreen(single);
    const multi = await renderScreen(<Chip label="Milk" multiple onPress={() => {}} />);
    h.eq([one(multi, 'Pressable').props.accessibilityRole, one(multi, 'Pressable').props.accessibilityState], ['checkbox', { checked: false, disabled: false }], 'any of several: an unchecked checkbox');
    await unmountScreen(multi);
    let suggested = 0;
    const suggestion = await renderScreen(<Chip label="A tip splitter" kind="suggestion" onPress={() => { suggested++; }} />);
    await act(() => one(suggestion, 'Pressable').props.onPressIn());
    await press(one(suggestion, 'Pressable'));
    h.eq([hapticCalls.splice(0), suggested, one(suggestion, 'Pressable').props.accessibilityRole], [[], 1, 'button'], 'a suggestion is a plain button tap');
    await unmountScreen(suggestion);
  });
}
