/** Every shell face resolves to a font file Android ships. React Native on Android loads an asset
 *  font by its family's file base name plus a suffix for the style the text asks for — `_bold` at
 *  weight 700 and up, `_italic` for italic, `_bold_italic` for both (`ReactFontManager`,
 *  `createAssetTypeface`) — and a file that isn't there silently becomes the system font. Whim's
 *  family names each name one file whose weight and slant are baked in, so the variant a face asks
 *  for must exist under that suffixed name too. Checked for the type scale, the Whim Syntax faces,
 *  and every text node of the screens that use the bold and italic faces. */
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { TYPE_SCALE, type TypeFace } from '../../../sdk/theme';
import { proseStyle } from '../../ui/whim-prose/styles';
import type { WhimClass } from '../../ui/whim-prose/types';
import HistoryScreen from '../HistoryScreen';
import HomeScreen from '../HomeScreen';
import DoneStep from '../DoneStep';
import PlanStep from '../PlanStep';
import WhimProse from '../../ui/whim-prose/WhimProse';
import { AppIndex, type InstalledApp } from '../app-index';
import { StoreAccess, storeIdOf } from '../store-access';
import { createMemoryStore, MapKVBackend } from '../../version-store';
import { StyleSheet } from './native-host';
import { renderScreen, textOf, unmountScreen } from './react-screen';
import { waitFor } from './rendered-launcher';

type Node = TestRenderer.ReactTestInstance;
type Face = Pick<TypeFace, 'fontFamily'> & { fontWeight?: string; fontStyle?: string };

const FONTS_DIR = path.join(process.cwd(), 'android/app/src/main/assets/fonts');

/** The asset file React Native on Android opens for `face`, or null for the system font. */
function androidFontFile({ fontFamily, fontWeight, fontStyle }: Partial<Face>): string | null {
  if (fontFamily === undefined) return null;
  const bold = fontWeight === 'bold' || Number(fontWeight ?? 400) >= 700;
  const italic = fontStyle === 'italic';
  const suffix = `${bold ? '_bold' : ''}${italic ? '_italic' : ''}`;
  return `${fontFamily}${suffix}.ttf`;
}

const shipped = () => new Set(fs.readdirSync(FONTS_DIR));

/** A text node's face as drawn: its own style over every enclosing text's, as nested text inherits. */
function drawnFace(node: Node): Partial<Face> {
  const chain: Node[] = [];
  for (let at: Node | null = node; at; at = at.parent) if (String(at.type) === 'Text') chain.unshift(at);
  return Object.assign({}, ...chain.map((n) => StyleSheet.flatten(n.props.style) ?? {})) as Partial<Face>;
}

/** Every text node under `root` whose drawn face names an asset family Android doesn't ship. */
function unshippedFaces(root: Node, files: ReadonlySet<string>): string[] {
  return root
    .findAll((n) => String(n.type) === 'Text')
    .map((n) => ({ text: textOf(n), file: androidFontFile(drawnFace(n)) }))
    .filter(({ file }) => file !== null && !files.has(file))
    .map(({ text, file }) => `“${text}” needs ${file}`);
}

const envelope = (text: string) => JSON.stringify({ v: 2, text });

export async function runAndroidFontsTests(h: Harness): Promise<void> {
  await h.test('android fonts: every type-scale face and every Whim Syntax face opens a font file Android ships', () => {
    const files = shipped();
    for (const [role, face] of Object.entries(TYPE_SCALE)) {
      const file = androidFontFile(face);
      h.ok(file !== null && files.has(file), `TYPE_SCALE.${role} opens ${file}, which Android ships`);
    }
    const classes: WhimClass[] = ['app', 'chg', 'yours', 'measure', 'state', 'hedge'];
    for (const cls of classes) {
      const style = proseStyle({ text: 'x', cls, color: '#000000' }) ?? {};
      const file = androidFontFile({ ...TYPE_SCALE.body, ...style });
      h.ok(file !== null && files.has(file), `the ${cls} prose face over body text opens ${file}, which Android ships`);
    }
  });

  await h.test('android fonts: a style-variant file is the same font as the file it is named for', () => {
    const variants = [...shipped()].filter((name) => /_(bold|italic|bold_italic)\.ttf$/.test(name));
    h.ok(variants.length > 0, `the variants the shell’s faces open are shipped (${variants.join(', ')})`);
    for (const variant of variants) {
      const base = variant.replace(/_(bold|italic|bold_italic)\.ttf$/, '.ttf');
      const same = fs.readFileSync(path.join(FONTS_DIR, variant)).equals(fs.readFileSync(path.join(FONTS_DIR, base)));
      h.ok(same, `${variant} is byte for byte ${base}`);
    }
  });

  await h.test('android fonts: every text on Home, a quoted history, the plan and the done step is drawn in a font Android ships', async () => {
    const files = shipped();
    let t = 1_700_000_000_000;
    const store = createMemoryStore({ autoCompact: false, now: () => (t += 1000) });
    const access = new StoreAccess({ store, index: new AppIndex(new MapKVBackend()), now: () => Date.now() });
    const app: InstalledApp = await access.install({ id: 'tea', name: 'Tea', record: { appId: 'tea', name: 'Tea', manifest: { capabilities: [] } }, bundleSource: 'V1', prompt: envelope('a tea timer') });
    await store.snapshot(storeIdOf(app), { 'bundle.js': 'V2' }, envelope('add a chime'));
    const noop = () => {};
    const screens: [string, React.ReactElement, (tree: TestRenderer.ReactTestRenderer) => Promise<void>][] = [
      ['Home', <HomeScreen apps={[app]} onOpen={noop} onFork={noop} onDelete={noop} onHistory={noop} onPromptAgain={noop} onCreate={noop} onSettings={noop} />, async () => {}],
      ['history', <HistoryScreen app={app} access={access} onBack={noop} onChangeIt={noop} onReport={noop} />, (tree) => waitFor(() => tree.root.findAllByType(WhimProse).length === 2, 'the versions')],
      ['plan', <PlanStep rows={[{ label: 'Timer', text: 'Counts down from 3 minutes' }]} loading={false} editing={false} onChangeRow={noop} onBuild={noop} onBack={noop} />, async () => {}],
      ['done', <DoneStep app={app} onOpen={noop} onBackToApps={noop} onReport={noop} />, async () => {}],
    ];
    for (const [name, element, ready] of screens) {
      const tree = await renderScreen(element);
      try {
        await ready(tree);
        const missing = unshippedFaces(tree.root, files);
        h.eq(missing, [], `${name}: every text is drawn in a shipped font, none falls back to the system’s`);
      } finally {
        await unmountScreen(tree);
      }
    }
  });
}
