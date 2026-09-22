/**
 * link-routing Node suite (design D15; store-launch-compliance chain-6). Locks app-links spec
 * §§"opens the app", "pending build", "isn't on this phone", "leaves the current screen" and
 * "waits" — the pure half of app-link handling. The rendered `LauncherRoot` taking these exits is
 * in `app-link-ui.suite.tsx` and `attempt-lifecycle-ui.suite.tsx` (a link arriving on the build
 * screen).
 */

import { Harness } from './harness';
import { MapKVBackend } from '../../version-store';
import type { AppRecord } from '../../bridge/contract';
import { AppIndex, InstalledApp } from '../app-index';
import { PendingBuildStore } from '../pending-builds';
import { resolveAppLink, linkExitFor, PendingLinkHolder } from '../link-routing';

const REC = (id: string): AppRecord => ({ appId: id, name: id, manifest: { capabilities: [] } });

function entry(id: string, over: Partial<InstalledApp> = {}): InstalledApp {
  return { id, name: id, createdAt: 1000, record: REC(id), lineageId: 'main', ...over };
}

export async function runLinkRoutingTests(h: Harness): Promise<void> {
  // ── resolveAppLink: "opens the app when it is on this phone" ───────────────────────────────

  await h.test('link-routing: an id matching an installed app resolves to open', () => {
    const index = new AppIndex(new MapKVBackend());
    index.put(entry('water-counter'));
    const resolution = resolveAppLink('water-counter', index.list(), []);
    h.eq(resolution.kind, 'open', 'resolves to open');
    h.eq(resolution.kind === 'open' && resolution.app.id, 'water-counter', 'carries the matched app');
  });

  // ── resolveAppLink: "a link to a pending build opens that build's screen" ──────────────────

  await h.test('link-routing: an id matching a building record resolves to building', () => {
    const pending = new PendingBuildStore(new MapKVBackend());
    pending.create({ id: 'app-1', prompt: 'a tip splitter', workingTitle: 'a tip splitter' });
    const resolution = resolveAppLink('app-1', [], pending.list());
    h.eq(resolution.kind, 'building', 'resolves to building');
  });

  await h.test('link-routing: an id matching a failed record resolves to failed', () => {
    const pending = new PendingBuildStore(new MapKVBackend());
    pending.create({ id: 'app-1', prompt: 'a tip splitter', workingTitle: 'a tip splitter' });
    pending.setFailed('app-1', { reason: 'stopped', diagnostics: [] });
    const resolution = resolveAppLink('app-1', [], pending.list());
    h.eq(resolution.kind, 'failed', 'a failed record resolves to failed');
  });

  await h.test('link-routing: an id matching an interrupted record ALSO resolves to failed', () => {
    const pending = new PendingBuildStore(new MapKVBackend());
    pending.create({ id: 'app-1', prompt: 'a tip splitter', workingTitle: 'a tip splitter' });
    pending.demoteBuildingToInterrupted();
    h.eq(pending.get('app-1')!.state, 'interrupted', 'the fixture is actually interrupted');
    const resolution = resolveAppLink('app-1', [], pending.list());
    h.eq(resolution.kind, 'failed', 'interrupted opens the SAME hydrated failure screen as failed');
  });

  // ── resolveAppLink: "isn't on this phone" ───────────────────────────────────────────────────

  await h.test('link-routing: an id matching neither resolves to missing', () => {
    h.eq(resolveAppLink('nobody-has-this-id', [], []).kind, 'missing', 'no installed app, no pending record');
  });

  await h.test('link-routing: installed apps are checked before pending records', () => {
    const index = new AppIndex(new MapKVBackend());
    index.put(entry('shared-id'));
    const pending = new PendingBuildStore(new MapKVBackend());
    pending.create({ id: 'shared-id', prompt: 'x', workingTitle: 'x' });
    h.eq(resolveAppLink('shared-id', index.list(), pending.list()).kind, 'open', 'the installed app wins');
  });

  // ── linkExitFor: "leaves the current screen through that screen's own safe exit" ───────────

  await h.test('linkExitFor: each screen leaves through its own safe exit', () => {
    const cases: Array<[string, string, string]> = [
      ['sheet', 'close-overlay', 'an open sheet takes precedence over the screen behind it'],
      ['app', 'exit-app', 'a running mini-app exits'],
      ['build', 'leave-build', 'the build screen behaves as Leave it running'],
      ['failure', 'leave-failure', 'the failure screen takes its own non-destructive Back'],
      ['consent', 'decline-consent', 'the consent screen declines as Not now'],
      ...['home', 'dev', 'settings', 'history', 'done', 'compose', 'clarify', 'plan', 'link-missing']
        .map((kind): [string, string, string] => [kind, 'home', `${kind} goes Home`]),
    ];
    for (const [kind, exit, why] of cases) h.eq(linkExitFor(kind), exit, why);
  });

  // ── PendingLinkHolder: "a link that arrives before the launcher is ready waits" ─────────────

  await h.test('PendingLinkHolder: released once, and only the last of several holds survives', () => {
    const holder = new PendingLinkHolder();
    h.eq(holder.release(), null, 'nothing held yet');
    holder.hold('first');
    holder.hold('second');
    holder.hold('third');
    h.eq(holder.release(), 'third', 'only the last hold is resolved');
    h.eq(holder.release(), null, 'release is one-shot — a second read finds nothing');
  });
}
