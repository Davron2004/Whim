/**
 * App-link UI wiring (store-launch-compliance chain-6, design D15/D16). `LauncherRoot.tsx`,
 * `HomeScreen.tsx`, `AppLinkMissingScreen.tsx` and `AppLinkSheet.tsx` are not rendered under
 * Node (react-native import graph too large to bundle — the same idiom `fork-question-ui.suite.ts`
 * and `launch-failure-ui.suite.ts` already use), so this is a static source assertion. The RN-free
 * routing logic itself (`resolveAppLink`/`linkExitFor`/`PendingLinkHolder`) is exercised
 * behaviourally in `link-routing.suite.ts`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Harness } from './harness';
import { COPY } from '../copy';

function read(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'src/host/launcher', file), 'utf8');
}

export async function runAppLinkUiTests(h: Harness): Promise<void> {
  const launcherRootSrc = read('LauncherRoot.tsx');
  const homeScreenSrc = read('HomeScreen.tsx');
  const missingScreenSrc = read('AppLinkMissingScreen.tsx');
  const sheetSrc = read('AppLinkSheet.tsx');

  // ── LauncherRoot: the Linking wiring ─────────────────────────────────────────

  await h.test('app-link: LauncherRoot reads the cold-start URL and subscribes to the url event', () => {
    h.ok(launcherRootSrc.includes('Linking.getInitialURL().then(handleIncomingUrl)'), 'cold-start URL is read once');
    h.ok(/Linking\.addEventListener\('url', /.test(launcherRootSrc), 'a warm link is handled through the url event');
  });

  await h.test('app-link: a rejected URL is logged with only its scheme and host, never the full URL', () => {
    h.ok(
      /log\.warn\(CHANNELS\.app, 'app link rejected', schemeAndHostOf\(url\)\)/.test(launcherRootSrc),
      'rejection is logged through schemeAndHostOf(url), not the raw string',
    );
  });

  await h.test('app-link: a link that arrives before ready is held, not opened immediately', () => {
    h.ok(
      /if \(!readyRef\.current\) \{\s*pendingLinkHolder\.hold\(id\);/.test(launcherRootSrc),
      'an unready launcher holds the id via pendingLinkHolder rather than opening it',
    );
    h.ok(launcherRootSrc.includes('pendingLinkHolder.release()'), 'the held link is released once first-run finishes');
  });

  await h.test('app-link: a link to the app already open is a no-op', () => {
    h.ok(
      /if \(screen\.kind === 'app' && screen\.app\.id === id\) return;/.test(launcherRootSrc),
      'openAppLink must return early when the target is already the running app',
    );
  });

  await h.test('app-link: the current screen leaves through its safe exit before the target opens', () => {
    h.ok(
      launcherRootSrc.includes("leaveForLink(linkExitFor(reportTarget != null ? 'sheet' : screen.kind));"),
      'leaveForLink/linkExitFor must run before dispatching the resolved target',
    );
    h.ok(
      /leaveForLink[\s\S]{0,40}=[\s\S]{0,400}leaveFlowStep\(screen\.kind\)/.test(launcherRootSrc),
      'leaveForLink must cancel whatever compose/plan request the current screen owns',
    );
  });

  await h.test('app-link: the resolved target opens through the SAME handlers a tile tap uses', () => {
    h.ok(/onOpen\(resolution\.app\)/.test(launcherRootSrc), 'an "open" resolution calls onOpen, not a second open path');
    h.ok(/onOpenPending\(resolution\.record\)/.test(launcherRootSrc), 'a building/failed resolution calls onOpenPending');
    h.ok(/setScreen\(\{ kind: 'link-missing' \}\)/.test(launcherRootSrc), 'a missing resolution opens the link-missing screen');
  });

  await h.test('app-link: link-missing renders AppLinkMissingScreen with goHome as its one action', () => {
    h.ok(
      launcherRootSrc.includes("<AppLinkMissingScreen onBackToApps={goHome} />"),
      'the link-missing screen must wire onBackToApps to goHome',
    );
  });

  // ── HomeScreen: the App link row and sheet ────────────────────────────────────

  await h.test('app-link: the installed-tile sheet offers App link, opening AppLinkSheet (never a direct action)', () => {
    const row = homeScreenSrc.split('\n').find(l => l.includes('COPY.actionAppLink') && l.includes('SheetRow'));
    h.ok(!!row, 'the App link row must exist on the installed-tile sheet');
    h.ok(!!row && row.includes('setAppLinkTarget'), 'tapping it must open the reveal sheet via setAppLinkTarget');
  });

  await h.test('app-link: the ghost tile sheet never offers App link', () => {
    const ghostSheetStart = homeScreenSrc.indexOf('selectedGhost != null');
    const ghostSheetSlice = homeScreenSrc.slice(ghostSheetStart, ghostSheetStart + 900);
    h.ok(!ghostSheetSlice.includes('COPY.actionAppLink'), 'a ghost tile must not offer the App link action');
  });

  await h.test('app-link: HomeScreen renders AppLinkSheet with the reveal state', () => {
    h.ok(
      /<AppLinkSheet app=\{appLinkTarget\} onClose=\{\(\) => setAppLinkTarget\(null\)\} \/>/.test(homeScreenSrc),
      'AppLinkSheet must be mounted, keyed off appLinkTarget',
    );
  });

  // ── AppLinkSheet: selectable link text, no clipboard dependency ──────────────

  await h.test('app-link sheet: renders the link as selectable text through SheetModal', () => {
    h.ok(sheetSrc.includes('import SheetModal from \'./SheetModal\';'), 'must reuse SheetModal — no second sheet primitive');
    h.ok(/<Text[^>]*selectable[^>]*>\s*\{appLinkFor\(app\.id\)\}/.test(sheetSrc), 'the link itself must be selectable text');
    h.ok(sheetSrc.includes('appLinkSheetLine(app.name)'), 'the one-line explanation must read from copy.ts');
    const thirdParty = [...sheetSrc.matchAll(/from '([^']+)'/g)]
      .map(m => m[1])
      .filter(spec => !spec.startsWith('.') && spec !== 'react' && spec !== 'react-native');
    h.eq(thirdParty, [], 'no clipboard package or other third-party dependency');
  });

  // ── AppLinkMissingScreen: the friendly screen ─────────────────────────────────

  await h.test('app-link missing screen: system back and the one action both go Home', () => {
    h.ok(missingScreenSrc.includes('useSystemBack(onBackToApps);'), 'system back is bound to the same onBackToApps the visible control uses');
    h.ok(!missingScreenSrc.includes('BackHandler'), 'the screen owns no hardware-back listener of its own any more');
    h.ok(
      /onPress=\{onBackToApps\}[\s\S]{0,220}COPY\.appLinkMissingBack/.test(missingScreenSrc),
      'the one action must be labelled from COPY.appLinkMissingBack and call onBackToApps',
    );
  });

  await h.test('app-link missing screen: styled from tokens only, copy from copy.ts', () => {
    h.ok(!/#[0-9a-f]{3,8}\b/i.test(missingScreenSrc), 'no hex colour literal');
    h.ok(/SHELL_PALETTE/.test(missingScreenSrc) && /TYPE_SCALE/.test(missingScreenSrc) && /SPACING/.test(missingScreenSrc), 'tokens only');
    h.ok(
      missingScreenSrc.includes('COPY.appLinkMissingTitle') && missingScreenSrc.includes('COPY.appLinkMissingBody'),
      'title and body must come from COPY',
    );
  });

  await h.test('app-link missing screen: the copy is plain English, no mechanism vocabulary', () => {
    const strings = [COPY.appLinkMissingTitle, COPY.appLinkMissingBody, COPY.appLinkMissingBack];
    for (const str of strings) {
      h.ok(str.trim().length > 0, 'the copy is present');
      h.ok(!/\b(kind|hint|schema|database|storage|realm|lineage)\b/i.test(str), `"${str}" stays plain English`);
    }
  });
}
