/** The shell's one scheme hook (design-system-v1 chain-10; app-launcher "The shell follows the
 *  phone's appearance through one scheme hook"; D2): `useTokens()` follows appearance, Increase
 *  Contrast, Reduce Motion and text size live, from the OS only; `makeStyles` builds once per
 *  combination; the named springs reach Reanimated with the physics the token module documents. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import {
  accessibilityListenerCount,
  accessibilityQueryFailure,
  accessibilitySettings,
  emitAccessibility,
  Platform,
  setColorScheme,
  View,
  windowMetrics,
} from './native-host';
import { hostType, renderScreen, unmountScreen } from './react-screen';
import { log } from '../../logging';
import { useTokens } from '../../ui/tokens';
import { makeStyles, resolveTokens, springConfig, staggerDelay, type ShellTokens } from '../../ui/tokens-pure';
import { Text } from '../../ui/Text';
import { COLORS, LAYOUT, SPRINGS, TIMINGS, type SpringName } from '../../../design/tokens';
import { SAMPLED_SPRINGS } from '../../../design/generated/springs';
import { contrastRatio } from '../../../design/tints';
import { backdropOf, statusBarStyleOver } from '../../ui/status-bar-style';

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

  await h.test('text given captured tokens draws with them whatever the phone does; text without them follows the phone', async () => {
    const pinned = resolveTokens({ scheme: 'dark', fontScale: 1, platform: 'ios', reduceMotion: false, increaseContrast: true });
    const tree = await renderScreen(<><Text color="text-2" tokens={pinned}>Pinned</Text><Text color="text-2">Live</Text></>);
    const color = (label: string) => tree.root.findAll((n) => hostType(n) === 'Text' && n.props.children === label)[0].props.style[1].color;
    try {
      h.eq([color('Pinned'), color('Live')], [COLORS.dark.text, COLORS.light['text-2']], 'on a light phone: the captured dark, contrast-raised role; the live light one');
      await act(() => setColorScheme('dark'));
      h.eq([color('Pinned'), color('Live')], [COLORS.dark.text, COLORS.dark['text-2']], 'the phone turned dark: the captured role is unchanged, the live one follows');
      await act(() => setColorScheme('light'));
      h.eq([color('Pinned'), color('Live')], [COLORS.dark.text, COLORS.light['text-2']], 'and back to light');
    } finally {
      await unmountScreen(tree);
      await resetPhone();
    }
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

  await h.test('a Reduce Motion read the OS rejects is logged with its reason, never as "[object Object]", and the hook keeps its default', async () => {
    const unreadable = () => log.buffer.snapshot().filter((r) => r.message === 'accessibility setting unreadable');
    try {
      log.buffer.clear();
      accessibilityQueryFailure.reason = { code: 'E_UNAVAILABLE' };
      const tree = await renderScreen(<Probe />);
      h.eq(probeTokens(tree).reduceMotion, false, 'the unreadable setting leaves Reduce Motion at its default');
      const logged = unreadable().map((r) => r.fields as { flag: string; detail: string });
      h.eq(logged.length, 1, 'one log line for the one rejected read');
      h.eq(logged[0].flag, 'reduceMotion', 'it names the setting');
      h.eq(logged[0].detail, 'rejected with a non-error object', `the reason is not an object's default stringification: ${logged[0].detail}`);
      await unmountScreen(tree);
      log.buffer.clear();
      accessibilityQueryFailure.reason = new Error('no accessibility service');
      const again = await renderScreen(<Probe />);
      h.eq(unreadable().map((r) => (r.fields as { detail: string }).detail), ['no accessibility service'], 'an Error is logged by its message');
      await unmountScreen(again);
      log.buffer.clear();
      accessibilityQueryFailure.reason = 42;
      const numeric = await renderScreen(<Probe />);
      h.eq(unreadable().map((r) => (r.fields as { detail: string }).detail), ['42'], 'a primitive reason is logged as its value');
      await unmountScreen(numeric);
    } finally {
      delete accessibilityQueryFailure.reason;
    }
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
  });

  await h.test('status bar over a scrim: the content reads on the dimmed backdrop, not on either scheme alone (#218)', async () => {
    const contrasts = (backdrop: string) => ({ dark: contrastRatio('#000000', backdrop), light: contrastRatio('#FFFFFF', backdrop) });
    h.eq([statusBarStyleOver(COLORS.light.bg), statusBarStyleOver(COLORS.dark.bg)], ['dark-content', 'light-content'], 'no sheet: dark content on the light canvas, light on the dark');
    const lightAppDarkPhone = backdropOf(COLORS.light.bg, [COLORS.dark.scrim]);
    const darkReads = contrasts(lightAppDarkPhone);
    h.ok(darkReads.dark < 4.5 && darkReads.light > darkReads.dark,
      `a light app under the dark phone's scrim is ${lightAppDarkPhone}: dark content ${darkReads.dark.toFixed(2)}:1, light ${darkReads.light.toFixed(2)}:1`);
    h.eq(statusBarStyleOver(COLORS.light.bg, [COLORS.dark.scrim]), 'light-content', 'light app, dark phone, sheet up: light content');
    h.eq(statusBarStyleOver(COLORS.dark.bg, [COLORS.light.scrim]), 'light-content', 'dark app, light phone, sheet up: light content');
    h.eq(statusBarStyleOver(COLORS.light.bg, [COLORS.light.scrim]), 'dark-content', 'light app, light phone, sheet up: still dark content on the light-grey scrim');
    h.eq(statusBarStyleOver(COLORS.dark.bg, [COLORS.dark.scrim]), 'light-content', 'dark app, dark phone, sheet up: light content');
    h.ok(contrastRatio('#000000', backdropOf(COLORS.light.bg, [COLORS.light.scrim, COLORS.light.scrim])) < contrastRatio('#000000', backdropOf(COLORS.light.bg, [COLORS.light.scrim])),
      'a sheet over a sheet dims the backdrop once more');
    for (const behind of [COLORS.light.bg, COLORS.dark.bg, '#808080', '#FFD400', '#1E50C8']) {
      for (const scrims of [[], [COLORS.light.scrim], [COLORS.dark.scrim], [COLORS.dark.scrim, COLORS.dark.scrim]]) {
        const read = contrasts(backdropOf(behind, scrims));
        const picked = statusBarStyleOver(behind, scrims) === 'light-content' ? read.light : read.dark;
        h.ok(picked >= Math.max(read.light, read.dark), `${behind} under ${scrims.length} scrim(s): the picked content has the higher contrast`);
      }
    }
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

  await h.test('stagger: one step per item over the first items, the rest together one step later; nothing waits under Reduce Motion', async () => {
    const first = TIMINGS.staggerFirst;
    const delays = Array.from({ length: first + 4 }, (_, i) => staggerDelay(i, false));
    h.eq(delays[0], 0, 'the first item does not wait');
    h.eq(delays.slice(1, first + 1).map((d, i) => d - delays[i]), Array(first).fill(TIMINGS.staggerPerItem), `each of the first ${first} items starts one ${TIMINGS.staggerPerItem} ms step after the one before`);
    h.eq(new Set(delays.slice(first)).size, 1, `every item from the ${first + 1}th on arrives together`);
    h.ok(delays[first] > delays[first - 1], 'and after the staggered ones, never before them');
    h.eq(delays.map((_, i) => staggerDelay(i, true)), Array(delays.length).fill(0), 'Reduce Motion: no stagger');
  });
}
