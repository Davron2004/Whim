/**
 * grid-composition Node suite (design-system-v1 15.1/15.2/15.3/15.6). The pure logic behind Home:
 * which cells there are, in what order, in which state (spec "The home grid orders and lays out apps
 * for every text size", "Tiles show their state"), the rows each state's menu offers (spec "Tile
 * menus follow the tile's state"), the attempt names, the search, and the glyph search of Customize
 * tile. What the rendered grid does with them is `home-grid-ui.suite.tsx`.
 */

import { Harness } from './harness';
import {
  ATTEMPT_RECENT_MS,
  attemptName,
  composeGrid,
  searchCells,
  SEARCH_FROM_APPS,
  type GridCell,
} from '../grid-composition';
import { menuFor } from '../tile-menus';
import { filterGlyphs, glyphLabel } from '../customize-tile';
import { stateLine, tileAccessibilityLabel, type TileState } from '../../ui/AppTile-states';
import { GLYPH_NAMES } from '../../../design/icons/names';
import { PendingBuildStore, type PendingBuildRecord } from '../pending-builds';
import { MapKVBackend } from '../../version-store';
import { sampleLive, sameLiveView, type LiveSample } from '../home-live';
import type { InstalledApp } from '../app-index';

const NOW = 1_700_000_000_000;
const DAY = ATTEMPT_RECENT_MS;

function app(id: string, createdAt: number, extra: Partial<InstalledApp> = {}): InstalledApp {
  return { id, name: id, createdAt, lineageId: 'main', record: { appId: id, name: id, manifest: { capabilities: [] } }, ...extra };
}

/** Records as the store writes them (creation, `setFailed`, the launch-time demotion to stopped),
 *  listed in the order given (newest first) and aged to `age` ms before `NOW`. */
function attempts(spec: { id: string; prompt?: string; state?: 'building' | 'failed' | 'interrupted'; age?: number; editingAppId?: string; remedy?: 'update' }[]): PendingBuildRecord[] {
  const store = new PendingBuildStore(new MapKVBackend());
  const make = (s: (typeof spec)[number]) =>
    store.create({ id: s.id, prompt: s.prompt ?? `prompt for ${s.id}`, workingTitle: s.id, ...(s.editingAppId ? { editingAppId: s.editingAppId } : {}) });
  spec.filter((s) => s.state === 'interrupted').forEach(make);
  store.demoteBuildingToInterrupted();
  for (const s of spec.filter((x) => x.state !== 'interrupted')) {
    make(s);
    if (s.state === 'failed') store.setFailed(s.id, { reason: 'no', ...(s.remedy ? { remedy: { kind: 'update' as const, protocolLevel: 9 } } : {}) });
  }
  return spec.map((s) => ({ ...store.get(s.id)!, createdAt: NOW - (s.age ?? 0) }));
}

const names = (cells: readonly GridCell[]): string[] =>
  cells.map((c) => {
    if (c.kind === 'app') return c.app.id;
    if (c.kind === 'attempt') return c.rec.id;
    return `older(${c.recs.map((r) => r.id).join(',')})`;
  });

const states = (cells: readonly GridCell[]): string[] => cells.map((c) => (c.kind === 'older' ? 'older' : c.state));

export async function runGridCompositionTests(h: Harness): Promise<void> {
  // ── order ───────────────────────────────────────────────────────────────────
  await h.test('home order: attempts being made first, then failed and stopped ones from the last day, then apps, each newest first', () => {
    const pending = attempts([
      { id: 'made-2', state: 'building' },
      { id: 'failed-1', state: 'failed', age: 3_600_000 },
      { id: 'made-1', state: 'building' },
      { id: 'stopped-1', state: 'interrupted', age: 7_200_000 },
    ]);
    const cells = composeGrid(pending, [app('old', 1), app('new', 50)], { now: NOW });
    h.eq(names(cells), ['made-2', 'made-1', 'failed-1', 'stopped-1', 'new', 'old'], 'making, recent attempts in the order given, apps newest first');
  });

  await h.test('home order: a finished app lands first among the apps, after the tiles still being made', () => {
    const others = [app('a', 10), app('b', 20)];
    const making = attempts([{ id: 'making-1', state: 'building' }, { id: 'making-2', state: 'building' }]);
    const before = composeGrid(making, others, { now: NOW });
    h.eq(names(before), ['making-1', 'making-2', 'b', 'a'], 'before: two being made, then the apps');
    const after = composeGrid(making, [...others, app('finished', NOW)], { now: NOW });
    h.eq(names(after), ['making-1', 'making-2', 'finished', 'b', 'a'], 'the finished app is the first app, after both tiles being made');
  });

  await h.test('home order: an app keeps its place when it changes — a rebuild, a new tint, a new name never move it', () => {
    const apps = [app('a', 10), app('b', 20), app('c', 30)];
    const before = names(composeGrid([], apps, { now: NOW }));
    const changed = apps.map((a) => (a.id === 'a' ? { ...a, name: 'Renamed', tint: 'rose' as const, record: { ...a.record, manifest: { capabilities: ['storage' as const] } } } : a));
    const rebuild = attempts([{ id: 'a', state: 'building', editingAppId: 'a' }]);
    h.eq(names(composeGrid(rebuild, changed, { now: NOW })), before, 'the order is the same, a changing app and all');
  });

  await h.test('home order: newest install first, and a tie in time keeps the later install ahead', () => {
    const cells = composeGrid([], [app('seed-1', 5), app('seed-2', 5), app('seed-3', 5)], { now: NOW });
    h.eq(names(cells), ['seed-3', 'seed-2', 'seed-1'], 'installed together: the index lists in install order, newest last');
  });

  // ── states ──────────────────────────────────────────────────────────────────
  await h.test('tile states: an attempt is making, waiting, failed, stopped or needs an update; an app is ready, changing or has a change that failed', () => {
    const pending = attempts([
      { id: 'a-making', state: 'building' },
      { id: 'a-waiting', state: 'building' },
      { id: 'a-failed', state: 'failed' },
      { id: 'a-update', state: 'failed', remedy: 'update' },
      { id: 'a-stopped', state: 'interrupted' },
      { id: 'timer', state: 'building', editingAppId: 'timer' },
      { id: 'dice', state: 'failed', editingAppId: 'dice' },
      { id: 'quiet', state: 'interrupted', editingAppId: 'quiet' },
    ]);
    const cells = composeGrid(pending, [app('timer', 1), app('dice', 2), app('quiet', 3), app('plain', 4)], { now: NOW, queued: new Set(['a-waiting']) });
    h.eq(
      Object.fromEntries(cells.map((c, i) => [names(cells)[i], states([c])[0]])),
      {
        'a-making': 'making', 'a-waiting': 'queued', 'a-failed': 'failed', 'a-update': 'needs-update', 'a-stopped': 'stopped',
        plain: 'ready', quiet: 'change-failed', dice: 'change-failed', timer: 'changing',
      },
      'every cell is in the state its record says',
    );
    h.eq(cells.filter((c) => c.kind === 'attempt' && c.rec.editingAppId !== undefined).length, 0, 'a change in flight is never a tile of its own');
  });

  await h.test('home order: an id both installed and still an attempt is one tile, the attempt', () => {
    const cells = composeGrid(attempts([{ id: 'same', state: 'building' }]), [app('same', 1), app('other', 2)], { now: NOW });
    h.eq(names(cells), ['same', 'other'], 'the attempt wins, the app returns when the record is gone');
    h.eq(cells[0].kind, 'attempt', 'as the attempt');
  });

  await h.test('home order: apps and attempts whose purge is armed are not cells; their neighbours keep their order', () => {
    const pending = attempts([{ id: 'x', state: 'failed' }, { id: 'y', state: 'failed' }]);
    const cells = composeGrid(pending, [app('a', 1), app('b', 2), app('c', 3)], { now: NOW, deletedApps: new Set(['b']), discardedAttempts: new Set(['x']) });
    h.eq(names(cells), ['y', 'c', 'a'], 'the deleted app and the discarded attempt are gone');
  });

  // ── collapse ────────────────────────────────────────────────────────────────
  await h.test('older attempts: failed and stopped ones more than a day old gather in one cell at the end; making ones, recent ones and update-needed ones never do', () => {
    const pending = attempts([
      { id: 'recent-failed', state: 'failed', age: DAY - 60_000 },
      { id: 'old-failed', state: 'failed', age: DAY + 60_000 },
      { id: 'old-stopped', state: 'interrupted', age: 5 * DAY },
      { id: 'old-update', state: 'failed', remedy: 'update', age: 9 * DAY },
      { id: 'old-making', state: 'building', age: 3 * DAY },
    ]);
    const cells = composeGrid(pending, [app('a', 1)], { now: NOW });
    h.eq(names(cells), ['old-making', 'recent-failed', 'old-update', 'a', 'older(old-failed,old-stopped)'], 'the two old ones are one cell, last');
    const older = cells.at(-1);
    h.ok(older?.kind === 'older' && older.recs.length === 2, 'standing for both attempts');
  });

  await h.test('older attempts: nothing old, no older cell', () => {
    h.eq(composeGrid(attempts([{ id: 'r', state: 'failed', age: 1000 }]), [], { now: NOW }).some((c) => c.kind === 'older'), false, 'a day-old failure is still news');
  });

  // ── names and lines ─────────────────────────────────────────────────────────
  await h.test('attempt name: the description’s first three words, without a leading article, capitalised', () => {
    const name = (prompt: string) => attemptName({ prompt, workingTitle: 'fallback' });
    h.eq(name('A tea timer that buzzes three times'), 'Tea timer that', 'article dropped, three words kept');
    h.eq(name('the plant watering tracker for my balcony'), 'Plant watering tracker', 'any article');
    h.eq(name('An  odd   spaced   idea here'), 'Odd spaced idea', 'spacing collapses');
    h.eq(name('dice roller'), 'Dice roller', 'fewer than three words is the whole thing');
    h.eq(name('a'), 'A', 'a lone article is the name, not nothing');
    h.eq(name('   '), 'fallback', 'a blank description falls back to the working title');
    h.eq(name('Timer for Pour-over coffee'), 'Timer for Pour-over', 'a name that starts with a word that is not an article is kept whole');
  });

  await h.test('state lines: only state gets a line; a seeded app says Example, a copy says Copy, the older cell counts', () => {
    h.eq(stateLine('ready'), null, 'a ready app has no line');
    h.eq(stateLine('ready', { example: true })?.color, 'text-2', 'Example is quiet');
    h.ok(stateLine('ready', { copy: true }) !== null, 'a copy says so');
    h.ok((stateLine('older', { count: 2 })?.text ?? '').startsWith('2 '), 'the older cell names how many');
    const lines = (['making', 'queued', 'failed', 'stopped', 'needs-update', 'changing', 'change-failed'] as TileState[]).map((s) => stateLine(s)?.text);
    h.eq(new Set(lines).size, lines.length, 'every state has its own words');
    h.eq(stateLine('failed')?.color, 'danger-text', 'failure in danger-text');
    h.eq(stateLine('needs-update')?.color, 'warning-text', 'needs update in warning-text');
    h.eq(stateLine('making')?.color, 'ember-text', 'making in ember-text');
  });

  await h.test('tile label: the name, then the state in lower case without its ellipsis', () => {
    h.eq(tileAccessibilityLabel('Pour Timer', stateLine('making')), 'Pour Timer, making', 'making');
    h.eq(tileAccessibilityLabel('Pour Timer', null), 'Pour Timer', 'a ready tile is just its name');
    h.eq(tileAccessibilityLabel('Pour Timer', stateLine('change-failed')), 'Pour Timer, change didn’t work', 'a failed change');
  });

  // ── menus ───────────────────────────────────────────────────────────────────
  await h.test('tile menus: each state offers exactly its rows, a ready app’s ending in Delete', () => {
    const pending = attempts([
      { id: 'making', state: 'building' }, { id: 'waiting', state: 'building' }, { id: 'failed', state: 'failed' },
      { id: 'stopped', state: 'interrupted' }, { id: 'update', state: 'failed', remedy: 'update' },
      { id: 'changing', state: 'building', editingAppId: 'changing' }, { id: 'broke', state: 'failed', editingAppId: 'broke' },
      { id: 'old-1', state: 'failed', age: 3 * DAY }, { id: 'old-2', state: 'interrupted', age: 3 * DAY },
    ]);
    const cells = composeGrid(pending, [app('ready', 1), app('changing', 2), app('broke', 3)], { now: NOW, queued: new Set(['waiting']) });
    const rows = (id: string) => menuFor(cells.find((c) => names([c])[0] === id)!).map((r) => r.action);
    h.eq(rows('ready'), ['open', 'change', 'history', 'copy', 'customize', 'share', 'delete'], 'a ready app');
    h.eq(rows('making'), ['details', 'stop'], 'a tile being made offers Details and Stop and nothing else');
    h.eq(rows('waiting'), ['details', 'stop'], 'a waiting one the same');
    h.eq(rows('failed'), ['what-happened', 'try-again', 'discard'], 'failed');
    h.eq(rows('stopped'), ['try-again', 'discard'], 'stopped, Try again first');
    h.eq(rows('update'), ['update', 'discard'], 'needs an update');
    h.eq(rows('changing'), ['details', 'stop-change'], 'an app being changed');
    h.eq(rows('broke'), ['what-happened', 'try-again', 'discard-change'], 'an app whose change failed');
    h.eq(rows('older(old-1,old-2)'), ['discard-all'], 'the older cell');
    h.eq(menuFor(cells.find((c) => c.kind === 'app' && c.app.id === 'ready')!).filter((r) => r.destructive).map((r) => r.action), ['delete'], 'Delete is the destructive row');
  });

  // ── search ──────────────────────────────────────────────────────────────────
  await h.test('search: appears from 13 apps and filters by name in any case; the older cell is not searched', () => {
    h.eq(SEARCH_FROM_APPS, 13, 'from thirteen apps');
    const cells = composeGrid(attempts([{ id: 'old', state: 'failed', age: 3 * DAY }]), [app('Pour Timer', 1), app('Tip Splitter', 2), app('Water Counter', 3)], { now: NOW });
    h.eq(names(searchCells(cells, 'TIMER')), ['Pour Timer'], 'case does not matter');
    h.eq(names(searchCells(cells, 'e')).includes('older(old)'), false, 'the older cell is not a name');
    h.eq(searchCells(cells, '  ').length, cells.length, 'a blank query keeps everything');
    h.eq(searchCells(cells, 'zzz'), [], 'nothing matches nothing');
  });

  // ── customize tile: glyph search ────────────────────────────────────────────
  await h.test('customize tile: the glyph search finds by name or group, words in any order, and keeps table order', () => {
    h.eq(filterGlyphs('').length, GLYPH_NAMES.length, 'every glyph for an empty query');
    h.ok(filterGlyphs('glass').includes('glass-water'), 'a name part finds it');
    h.ok(filterGlyphs('water glass').includes('glass-water'), 'in either order');
    h.ok(filterGlyphs('food').includes('coffee'), 'a group name finds the group');
    h.eq(filterGlyphs('qqqq'), [], 'nothing for nonsense');
    const hits = filterGlyphs('a');
    h.eq(hits, GLYPH_NAMES.filter((g) => hits.includes(g)), 'in the table’s order');
    h.eq(glyphLabel('glass-water'), 'glass water', 'a glyph is spoken without hyphens');
  });

  // ── live attempts: waiting, and how hard the stream works ───────────────────
  await h.test('home live: an attempt in line is waiting; the ember follows tokens a second, 40 being full; a first sight is idle; ended attempts are forgotten', () => {
    const samples = new Map<string, LiveSample>();
    const at = (id: string, tokens: number, extra: { inLine?: boolean; thinkingChars?: number } = {}) => ({
      id, signals: { aggregates: { tokens, thinkingChars: extra.thinkingChars }, inLine: extra.inLine },
    });
    const first = sampleLive([at('a', 100), at('b', 0, { inLine: true })], samples, 10_000);
    h.eq([first.queued.has('b'), first.queued.has('a'), first.activity.a], [true, false, 0], 'b waits for a spot; a has no rate yet');
    const second = sampleLive([at('a', 120), at('b', 0)], samples, 11_000);
    h.eq(second.activity.a, 0.5, '20 tokens in a second is half of 40');
    h.eq(second.queued.size, 0, 'b has its turn');
    const third = sampleLive([at('a', 320, { thinkingChars: 400 })], samples, 12_000);
    h.eq(third.activity.a, 1, '300 tokens in a second is more than full, held at 1');
    h.eq([...samples.keys()], ['a'], 'b ended and is forgotten');
    const steady = sampleLive([at('a', 320, { thinkingChars: 400 })], samples, 13_000);
    h.eq(steady.activity.a, 0, 'nothing written in a second is idle');
    h.ok(sameLiveView(steady, sampleLive([at('a', 320, { thinkingChars: 400 })], samples, 14_000)), 'an unchanged view is the same view, so Home does not re-render');
    h.ok(!sameLiveView(second, third), 'a changed one is not');
  });
}
