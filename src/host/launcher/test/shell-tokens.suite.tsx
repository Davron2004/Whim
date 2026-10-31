/** The shell's one scheme hook (design-system-v1 chain-10; app-launcher "The shell follows the
 *  phone's appearance through one scheme hook"; D2): `useTokens()` follows appearance, Increase
 *  Contrast, Reduce Motion and text size live, from the OS only; `makeStyles` builds once per
 *  combination; the named springs reach Reanimated with the physics the token module documents. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import {
  accessibilityListenerCount,
  accessibilitySettings,
  emitAccessibility,
  Platform,
  setColorScheme,
  View,
  windowMetrics,
} from './native-host';
import { hostType, renderScreen, unmountScreen } from './react-screen';
import { useTokens } from '../../ui/tokens';
import { makeStyles, resolveTokens, springConfig, type ShellTokens } from '../../ui/tokens-pure';
import { Text } from '../../ui/Text';
import { COLORS, LAYOUT, SPRINGS, type SpringName } from '../../../design/tokens';
import { SAMPLED_SPRINGS } from '../../../design/generated/springs';

/** Renders what `useTokens()` returns, so a test reads the hook's live value. */
function Probe() {
  const t = useTokens();
  return <View tokens={t} />;
}
function probeTokens(tree: TestRenderer.ReactTestRenderer): ShellTokens {
  return tree.root.findAll((n) => hostType(n) === 'View' && n.props.tokens !== undefined)[0].props.tokens;
}
const act = (fn: () => void) => TestRenderer.act(async () => { fn(); });

/** Restores the shared native doubles after a test changed them. */
async function resetPhone(): Promise<void> {
  await act(() => setColorScheme('light'));
  accessibilitySettings.reduceMotion = false;
  accessibilitySettings.increaseContrast = false;
  windowMetrics.fontScale = 1;
  Platform.OS = 'ios';
}

/** The settled time of a mass-spring released at 0 toward 1, at 60 Hz frames, the way the token
 *  generator defines it: the first frame from which |x − 1| < 0.001 and |v| < 0.01/s hold. */
function settledMs({ mass, stiffness, damping }: { mass: number; stiffness: number; damping: number }): number {
  const substeps = 1000;
  const dt = 1 / 60 / substeps;
  let x = 0;
  let v = 0;
  let lastUnsettledFrame = 0;
  for (let frame = 1; frame <= 180; frame++) {
    for (let i = 0; i < substeps; i++) {
      v += ((-stiffness * (x - 1) - damping * v) / mass) * dt;
      x += v * dt;
    }
    if (!(Math.abs(x - 1) < 0.001 && Math.abs(v) < 0.01)) lastUnsettledFrame = frame;
  }
  return ((lastUnsettledFrame + 1) * 1000) / 60;
}

export async function runShellTokensTests(h: Harness): Promise<void> {
  await h.test('switching the phone to dark re-renders the shell with the dark roles, without a remount', async () => {
    const tree = await renderScreen(<Text>Your apps</Text>);
    const text = () => tree.root.findAll((n) => hostType(n) === 'Text')[0];
    const before = text();
    h.eq(before.props.style[1].color, COLORS.light.text, 'light text on a light phone');
    await act(() => setColorScheme('dark'));
    h.eq(text().props.style[1].color, COLORS.dark.text, 'dark text once the phone turns dark');
    h.ok(text() === before, 'the same element re-rendered, nothing remounted');
    await act(() => setColorScheme(null));
    h.eq(text().props.style[1].color, COLORS.light.text, 'an unspecified appearance is light');
    await unmountScreen(tree);
    await resetPhone();
  });

  await h.test('Increase Contrast turns text-2 into text, read from each platform\'s own setting', async () => {
    for (const [os, own, other] of [
      ['ios', 'darkerSystemColorsChanged', 'highTextContrastChanged'],
      ['android', 'highTextContrastChanged', 'darkerSystemColorsChanged'],
    ] as const) {
      Platform.OS = os;
      const tree = await renderScreen(<Text color="text-2">5 min ago</Text>);
      const color = () => tree.root.findAll((n) => hostType(n) === 'Text')[0].props.style[1].color;
      h.eq(color(), COLORS.light['text-2'], `${os}: secondary text by default`);
      await act(() => emitAccessibility(other, true));
      h.eq(color(), COLORS.light['text-2'], `${os}: the other platform's contrast event changes nothing`);
      await act(() => emitAccessibility(own, true));
      h.eq(color(), COLORS.light.text, `${os}: its own contrast setting makes secondary text primary`);
      await act(() => emitAccessibility(own, false));
      h.eq(color(), COLORS.light['text-2'], `${os}: turning it off restores secondary text`);
      await unmountScreen(tree);
    }
    await resetPhone();
  });

  await h.test('the hook starts from the settings the phone already has, then follows Reduce Motion live', async () => {
    accessibilitySettings.reduceMotion = true;
    accessibilitySettings.increaseContrast = true;
    windowMetrics.fontScale = 1.4;
    const tree = await renderScreen(<Probe />);
    const first = probeTokens(tree);
    h.eq([first.reduceMotion, first.increaseContrast, first.fontScale, first.largeText], [true, true, 1.4, true], 'every setting read at mount');
    await act(() => emitAccessibility('reduceMotionChanged', false));
    h.eq(probeTokens(tree).reduceMotion, false, 'Reduce Motion turned off while open');
    await unmountScreen(tree);
    await resetPhone();
  });

  await h.test('every subscriber shares one set of OS listeners, released when the last one goes', async () => {
    h.eq(accessibilityListenerCount(), 0, 'nothing listens before the shell renders');
    const first = await renderScreen(<Probe />);
    const listening = accessibilityListenerCount();
    h.eq(listening, 2, 'one Reduce Motion and one contrast listener');
    const second = await renderScreen(<><Probe /><Probe /><Text>More</Text></>);
    h.eq(accessibilityListenerCount(), listening, 'more components add no native listeners');
    await unmountScreen(first);
    h.eq(accessibilityListenerCount(), listening, 'still listening while a component remains');
    await unmountScreen(second);
    h.eq(accessibilityListenerCount(), 0, 'nothing left listening once the shell is gone');
  });

  await h.test('Dynamic Type: large-text layouts start at 135%, and the touch target follows the platform', async () => {
    const at = (fontScale: number, platform: string) => resolveTokens({ scheme: 'light', fontScale, platform, reduceMotion: false, increaseContrast: false });
    h.eq([at(1.34, 'ios').largeText, at(1.35, 'ios').largeText, at(2, 'ios').largeText], [false, true, true], 'stacking from 135%');
    h.eq([at(1, 'ios').touchTarget, at(1, 'android').touchTarget], [LAYOUT.touchTarget.ios, LAYOUT.touchTarget.android], '44 pt on iOS, 48 dp on Android');
    h.eq([at(1, 'ios').barStyle, resolveTokens({ scheme: 'dark', fontScale: 1, platform: 'ios', reduceMotion: false, increaseContrast: false }).barStyle], ['dark-content', 'light-content'], 'status-bar content reads on each scheme\'s canvas');
  });

  await h.test('makeStyles builds once per combination of settings and shares the result across components', async () => {
    const built: string[] = [];
    const styles = makeStyles((t) => {
      built.push(t.scheme);
      return { canvas: { backgroundColor: t.colors.bg } };
    });
    const light = resolveTokens({ scheme: 'light', fontScale: 1, platform: 'ios', reduceMotion: false, increaseContrast: false });
    const lightAgain = resolveTokens({ scheme: 'light', fontScale: 1, platform: 'ios', reduceMotion: false, increaseContrast: false });
    const dark = resolveTokens({ scheme: 'dark', fontScale: 1, platform: 'ios', reduceMotion: false, increaseContrast: false });
    h.ok(styles(light) === styles(lightAgain), 'the same settings give the same style object');
    h.eq(styles(dark).canvas.backgroundColor, COLORS.dark.bg, 'dark styles carry the dark canvas');
    h.eq(styles(light).canvas.backgroundColor, COLORS.light.bg, 'light styles carry the light canvas');
    h.eq(built, ['light', 'dark'], 'the builder ran once per scheme');
  });

  await h.test('each named spring reaches Reanimated with the physics whose settled time the tokens document', async () => {
    for (const name of Object.keys(SPRINGS) as SpringName[]) {
      const measured = settledMs(springConfig(name));
      const documented = SAMPLED_SPRINGS[name].durationMs;
      h.ok(Math.abs(measured - documented) <= 1000 / 60 + 1, `${name} settles in ${documented} ms (Reanimated config settles in ${measured.toFixed(0)} ms)`);
    }
  });
}
