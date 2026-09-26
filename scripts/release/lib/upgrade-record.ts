/**
 * The data half of the release upgrade check (beta-1 design D15; spec release-upgrade-check "A beta
 * build must upgrade cleanly over the previous release"). `scripts/release/upgrade-check.sh`
 * captures the device twice, once after seeding the previous release and once after installing the
 * candidate over it. This module turns each capture into an `UpgradeRecord` and diffs the two. Any
 * difference fails the check, and so does a seed record that lacks something the seed must create.
 *
 * A capture directory holds:
 *   storage/whim.launcher, storage/whim.launcher.crc
 *       the launcher's MMKV store, pulled with the app stopped: the installed-app index (`order`,
 *       `app:<id>`, read the way `AppIndex.list` reads it), the consent grant
 *       (`whim.ai-consent:v1`) and the device id (`whim.device:v1`).
 *   grid.json          `maestro hierarchy` on the home grid: which apps show a tile.
 *   history/<id>.json  `maestro hierarchy` on each app's History: its version count.
 *   water-counter.json `maestro hierarchy` inside the Water Counter example: its saved count.
 * The consent grant and the device id are read from the store, not from a screen: 382511 never
 * shows the device id, and a build whose consent version has moved shows an older grant as "Off",
 * the same as no grant at all.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Buffer as NodeBuffer } from 'buffer';
import { readMmkv, type MmkvStore } from './mmkv';

declare module 'node:fs' {
  export function existsSync(path: string): boolean;
}

export interface TileRecord {
  readonly id: string;
  readonly name: string;
  readonly example: boolean;
  /** The home grid shows a tile with this name. */
  readonly onGrid: boolean;
  /** The version count the app's History shows, or `null` when History wasn't read. */
  readonly versions: number | null;
}

export interface ConsentGrant {
  readonly version: number;
  readonly grantedAt: string;
}

export interface UpgradeRecord {
  readonly deviceId: string | null;
  readonly consent: ConsentGrant | null;
  readonly tiles: readonly TileRecord[];
  /** `<app> / <label>` → the number the app shows next to that label. */
  readonly savedData: Readonly<Record<string, string>>;
}

/** The example the seed saves data in, and the labels its saved numbers sit next to
 *  (fixtures/water-counter.app.tsx). */
export const SAVED_DATA_APP = 'Water Counter';
export const SAVED_DATA_LABELS: readonly string[] = ['Glasses', 'History entries'];

const TEXT_ATTRIBUTES = ['text', 'accessibilityText', 'hintText', 'value', 'title'];

interface HierarchyNode {
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly children?: readonly HierarchyNode[];
}

/** Every text a `maestro hierarchy` dump carries, in document order, each node's distinct texts
 *  once. Android puts a view's text in `text` and its label in `accessibilityText`; iOS adds
 *  `value` and `title`. */
function hierarchyTexts(root: unknown): string[] {
  const out: string[] = [];
  const visit = (node: HierarchyNode): void => {
    const attributes = node.attributes ?? {};
    const own = new Set<string>();
    for (const key of TEXT_ATTRIBUTES) {
      const value = attributes[key];
      if (typeof value === 'string' && value.trim() !== '') own.add(value);
    }
    out.push(...own);
    for (const child of node.children ?? []) visit(child);
  };
  visit(root as HierarchyNode);
  return out;
}

/** Whether a screen text shows this tile name: the name's own Text, or a tile label that ends with
 *  it (a pressable tile's label joins its texts, "EXAMPLE, Tip Splitter"). */
function showsName(text: string, name: string): boolean {
  return text === name || text.endsWith(`, ${name}`) || text.endsWith(` ${name}`);
}

const VERSIONS_LINE = /^(\d+) versions? · /;

/** The version count on a History screen ("2 versions · started 1d ago", copy.ts#historySubtitle). */
export function versionsFromHistory(texts: readonly string[]): number | null {
  for (const text of texts) {
    const match = VERSIONS_LINE.exec(text);
    if (match) return Number(match[1]);
  }
  return null;
}

/** The number shown after each label: the next text that is only digits. */
function numbersAfterLabels(texts: readonly string[], labels: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const label of labels) {
    const at = texts.indexOf(label);
    if (at === -1) continue;
    const value = texts.slice(at + 1).find((text) => /^\d+$/.test(text));
    if (value !== undefined) out[label] = value;
  }
  return out;
}

interface IndexedApp {
  readonly id: string;
  readonly name: string;
  readonly example: boolean;
}

function parseJson(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as unknown;
    // eslint-disable-next-line no-restricted-syntax -- intentional: an unreadable value reads as absent, the way the app itself reads it (AppIndex, ai-consent)
  } catch {
    return undefined;
  }
}

/** The installed apps in grid order, read the way `AppIndex.list` reads them: order ids with no
 *  readable record are dropped. */
function indexedApps(store: MmkvStore): IndexedApp[] {
  const order = parseJson(store.getString('order'));
  if (!Array.isArray(order)) return [];
  const apps: IndexedApp[] = [];
  for (const id of order) {
    if (typeof id !== 'string') continue;
    const app = parseJson(store.getString(`app:${id}`)) as { name?: unknown; example?: unknown } | undefined;
    if (typeof app?.name !== 'string') continue;
    apps.push({ id, name: app.name, example: app.example === true });
  }
  return apps;
}

function consentFrom(store: MmkvStore): ConsentGrant | null {
  const grant = parseJson(store.getString('whim.ai-consent:v1')) as { version?: unknown; grantedAt?: unknown } | undefined;
  if (typeof grant?.version !== 'number' || typeof grant.grantedAt !== 'string') return null;
  return { version: grant.version, grantedAt: grant.grantedAt };
}

/** The raw inputs of one capture: `histories` is keyed by app id, and a missing screen is
 *  `undefined` (that screen wasn't read). */
export interface Capture {
  readonly store: MmkvStore;
  readonly grid: unknown;
  readonly histories: Readonly<Record<string, unknown>>;
  readonly savedDataScreen: unknown;
}

/** The apps whose tile shows on the grid: the ones the script reads a History screen for. */
export function tilesOnGrid(store: MmkvStore, grid: unknown): IndexedApp[] {
  const texts = hierarchyTexts(grid);
  return indexedApps(store).filter((app) => texts.some((text) => showsName(text, app.name)));
}

export function buildRecord(capture: Capture): UpgradeRecord {
  const gridTexts = hierarchyTexts(capture.grid);
  const tiles = indexedApps(capture.store).map((app): TileRecord => {
    const history = capture.histories[app.id];
    return {
      ...app,
      onGrid: gridTexts.some((text) => showsName(text, app.name)),
      versions: history === undefined ? null : versionsFromHistory(hierarchyTexts(history)),
    };
  });
  const savedData: Record<string, string> = {};
  if (capture.savedDataScreen !== undefined) {
    const numbers = numbersAfterLabels(hierarchyTexts(capture.savedDataScreen), SAVED_DATA_LABELS);
    for (const [label, value] of Object.entries(numbers)) savedData[`${SAVED_DATA_APP} / ${label}`] = value;
  }
  return {
    deviceId: capture.store.getString('whim.device:v1') ?? null,
    consent: consentFrom(capture.store),
    tiles,
    savedData,
  };
}

function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  } catch (err) {
    throw new Error(`${file}: not a JSON view hierarchy (${err instanceof Error ? err.message : String(err)})`);
  }
}

function readOptionalJson(file: string): unknown {
  return fs.existsSync(file) ? readJsonFile(file) : undefined;
}

/** Reads a capture directory (layout in the header). Throws naming the file for a missing store or
 *  grid dump, since a record without them would be empty rather than wrong. */
export function readCapture(dir: string): Capture {
  const storeFile = path.join(dir, 'storage', 'whim.launcher');
  const gridFile = path.join(dir, 'grid.json');
  for (const file of [storeFile, `${storeFile}.crc`, gridFile]) {
    if (!fs.existsSync(file)) throw new Error(`${file} is missing from the capture`);
  }
  const store = readMmkv(fs.readFileSync(storeFile) as NodeBuffer, fs.readFileSync(`${storeFile}.crc`) as NodeBuffer, storeFile);
  const histories: Record<string, unknown> = {};
  for (const app of indexedApps(store)) {
    const history = readOptionalJson(path.join(dir, 'history', `${app.id}.json`));
    if (history !== undefined) histories[app.id] = history;
  }
  return {
    store,
    grid: readJsonFile(gridFile),
    histories,
    savedDataScreen: readOptionalJson(path.join(dir, 'water-counter.json')),
  };
}

/** What the seed must have created (task 9.1): an example with saved data, a generated app with two
 *  versions, a consent grant and a device id, every tile on the grid with its History read. One
 *  line per gap; empty when the seed is complete. */
export function seedFindings(seed: UpgradeRecord): string[] {
  const findings: string[] = [];
  if (seed.deviceId === null) findings.push('seed: no device id in the store');
  if (seed.consent === null) findings.push('seed: no consent grant in the store');
  if (seed.tiles.length === 0) findings.push('seed: no installed apps');
  for (const tile of seed.tiles) {
    if (!tile.onGrid) findings.push(`seed: "${tile.name}" is installed but the grid shows no tile for it`);
    if (tile.versions === null) findings.push(`seed: no version count read for "${tile.name}"`);
  }
  if (!seed.tiles.some((tile) => !tile.example && (tile.versions ?? 0) >= 2)) {
    findings.push('seed: no generated app with at least two versions');
  }
  const savedCount = Number(seed.savedData[`${SAVED_DATA_APP} / ${SAVED_DATA_LABELS[0]}`] ?? '0');
  if (savedCount <= 0) findings.push(`seed: ${SAVED_DATA_APP} shows no saved ${SAVED_DATA_LABELS[0].toLowerCase()}`);
  return findings;
}

function show(value: unknown): string {
  return value === null || value === undefined ? 'nothing' : JSON.stringify(value);
}

function tileChanges(tile: TileRecord, now: TileRecord): string[] {
  const lines: string[] = [];
  if (now.name !== tile.name) lines.push(`app ${tile.id}: name "${tile.name}" became "${now.name}"`);
  if (now.example !== tile.example) lines.push(`app "${tile.name}": example ${tile.example} became ${now.example}`);
  if (now.onGrid !== tile.onGrid) lines.push(`app "${tile.name}": tile on the grid ${tile.onGrid} became ${now.onGrid}`);
  if (now.versions !== tile.versions) lines.push(`app "${tile.name}": ${show(tile.versions)} versions became ${show(now.versions)}`);
  return lines;
}

function tileDiff(before: readonly TileRecord[], after: readonly TileRecord[]): string[] {
  const lines: string[] = [];
  const afterTiles = new Map(after.map((tile) => [tile.id, tile]));
  for (const tile of before) {
    const now = afterTiles.get(tile.id);
    if (now === undefined) lines.push(`app "${tile.name}" (${tile.id}) is no longer installed`);
    else lines.push(...tileChanges(tile, now));
  }
  const beforeIds = new Set(before.map((tile) => tile.id));
  for (const tile of after) {
    if (!beforeIds.has(tile.id)) lines.push(`app "${tile.name}" (${tile.id}) appeared after the upgrade`);
  }
  return lines;
}

/** Every difference between the seed record and the record after the upgrade, one line each. */
export function diffRecords(before: UpgradeRecord, after: UpgradeRecord): string[] {
  const lines: string[] = [];
  if (before.deviceId !== after.deviceId) lines.push(`device id: ${show(before.deviceId)} became ${show(after.deviceId)}`);
  if (JSON.stringify(before.consent) !== JSON.stringify(after.consent)) {
    lines.push(`consent grant: ${show(before.consent)} became ${show(after.consent)}`);
  }
  lines.push(...tileDiff(before.tiles, after.tiles));
  for (const key of new Set([...Object.keys(before.savedData), ...Object.keys(after.savedData)])) {
    if (before.savedData[key] !== after.savedData[key]) {
      lines.push(`saved data "${key}": ${show(before.savedData[key])} became ${show(after.savedData[key])}`);
    }
  }
  return lines;
}
