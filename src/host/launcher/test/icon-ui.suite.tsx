/** The shell's `Icon` (design-system-v1 chain-7, system.md §3.1): what it draws for a name, the
 *  stroke it renders at each documented size, and how a screen reader meets it. The stroke widths
 *  are read from system.md itself, so the doc and the primitive can't drift apart. */
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { renderScreen, unmountScreen, hostType } from './react-screen';
import { Icon } from '../../ui/Icon';
import { ICON_PATHS } from '../../../design/icons/paths';

type Node = TestRenderer.ReactTestInstance;

const SYSTEM_MD = path.join(process.cwd(), 'docs/design/system.md');

/** system.md §3.1's "rendered stroke A px at S–T pt, B px at U–V pt", as [size, stroke] pairs for
 *  both ends of each range. */
function documentedStrokes(): Array<[size: number, stroke: number]> {
  const doc = fs.readFileSync(SYSTEM_MD, 'utf8');
  const m = /rendered stroke ([\d.]+) px at (\d+)–(\d+) pt, ([\d.]+) px at (\d+)–(\d+) pt/.exec(doc);
  if (!m) throw new Error('system.md §3.1 no longer states the rendered stroke per size');
  const [a, s1, s2, b, s3, s4] = m.slice(1).map(Number);
  return [[s1, a], [s2, a], [s3, b], [s4, b]];
}

async function draw(element: React.ReactElement) {
  const tree = await renderScreen(element);
  const only = (name: string): Node => {
    const found = tree.root.findAll((n) => hostType(n) === name);
    if (found.length !== 1) throw new Error(`Expected one ${name}, got ${found.length}`);
    return found[0];
  };
  return { tree, svg: only('Svg'), path: only('Path'), box: only('View') };
}

export async function runIconUiTests(h: Harness): Promise<void> {
  await h.test('Icon draws the vendored path of the name it is given, on the 24 grid at its size', async () => {
    const settings = await draw(<Icon name="settings" size={24} color="#111111" />);
    const timer = await draw(<Icon name="timer" size={24} color="#111111" />);
    h.eq(settings.path.props.d, ICON_PATHS.settings, 'settings draws its own path');
    h.eq(timer.path.props.d, ICON_PATHS.timer, 'timer draws its own path');
    h.ok(settings.path.props.d !== timer.path.props.d, 'two names draw two different shapes');
    h.eq(settings.svg.props.viewBox, '0 0 24 24', 'the path is placed on the 24 grid');
    h.eq([settings.svg.props.width, settings.svg.props.height], [24, 24], 'the drawing fills the asked size');
    await unmountScreen(settings.tree);
    await unmountScreen(timer.tree);
  });

  await h.test('Icon is an outline in the caller\'s colour with round caps and joins', async () => {
    const icon = await draw(<Icon name="check" color="#0a7d3b" />);
    h.eq(icon.path.props.stroke, '#0a7d3b', 'stroked in the given colour');
    h.eq(icon.path.props.fill, 'none', 'never filled');
    h.eq([icon.path.props.strokeLinecap, icon.path.props.strokeLinejoin], ['round', 'round'], 'round caps and joins');
    h.eq(icon.svg.props.width, 20, 'an unsized icon is the 20 pt row and button size');
    await unmountScreen(icon.tree);
  });

  await h.test('Icon renders the stroke system.md documents at every icon size', async () => {
    const documented = documentedStrokes();
    h.eq(documented.map(([size]) => size), [16, 20, 24, 28], 'system.md documents the four icon sizes');
    for (const [size, stroke] of documented) {
      const icon = await draw(<Icon name="plus" size={size} color="#000" />);
      const rendered = (icon.path.props.strokeWidth * size) / 24;
      h.ok(Math.abs(rendered - stroke) < 1e-9, `${size} pt renders a ${stroke} pt stroke (got ${rendered})`);
      await unmountScreen(icon.tree);
    }
  });

  await h.test('a stroke named on the grid wins over the size\'s default (tile glyphs are 2)', async () => {
    const glyph = await draw(<Icon name="coffee" size={32} color="#fff" stroke={2} />);
    h.eq(glyph.path.props.strokeWidth, 2, 'the grid stroke is drawn as given');
    await unmountScreen(glyph.tree);
  });

  await h.test('a labelled icon is one image to screen readers; an unlabelled one is hidden from them', async () => {
    const labelled = await draw(<Icon name="settings" color="#000" label="Settings" />);
    h.eq(
      [labelled.box.props.accessible, labelled.box.props.accessibilityRole, labelled.box.props.accessibilityLabel],
      [true, 'image', 'Settings'],
      'read as an image named by its label',
    );
    const decorative = await draw(<Icon name="settings" color="#000" />);
    h.eq(decorative.box.props.accessible, false, 'not an accessibility element');
    h.eq(
      [decorative.box.props.accessibilityElementsHidden, decorative.box.props.importantForAccessibility],
      [true, 'no-hide-descendants'],
      'hidden from VoiceOver and TalkBack, drawing included',
    );
    await unmountScreen(labelled.tree);
    await unmountScreen(decorative.tree);
  });
}
