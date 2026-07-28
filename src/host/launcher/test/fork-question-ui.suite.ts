/**
 * Fork-question sheet wiring (task 3.2, linked-apps-data-model chain-2, design D4).
 *
 * `HomeScreen.tsx`/`LauncherRoot.tsx` are not rendered under Node, so this is a static source
 * assertion (mirrors `dev-probe-back-button.suite.ts`'s idiom): it reads the production files
 * and verifies the Fork tap opens the share-vs-fresh sheet, that each answer threads
 * `{ shareData }` through to `access.fork`, and that no shortcut calls `onFork` directly from
 * the long-press action sheet.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Harness } from './harness';

export async function runForkQuestionUiTests(h: Harness): Promise<void> {
  const homeScreenSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/host/launcher/HomeScreen.tsx'),
    'utf8',
  );
  const launcherRootSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/host/launcher/LauncherRoot.tsx'),
    'utf8',
  );

  await h.test('fork-question: the action-sheet Fork row opens the share-vs-fresh sheet, not onFork directly', () => {
    const forkRowLine = homeScreenSrc
      .split('\n')
      .find(l => l.includes('COPY.actionFork') && l.includes('SheetRow'));
    h.ok(!!forkRowLine, 'the action-sheet Fork row must exist');
    h.ok(
      !!forkRowLine && forkRowLine.includes('setForkTarget') && !forkRowLine.includes('onFork('),
      'the Fork tap must open the share-vs-fresh sheet (setForkTarget), never call onFork directly',
    );
  });

  await h.test('fork-question: "use the same saved data" threads shareData: true', () => {
    h.ok(
      /COPY\.forkShareData[\s\S]{0,120}onFork\(a, \{ shareData: true \}\)/.test(homeScreenSrc),
      'the forkShareData row must call onFork(a, { shareData: true })',
    );
  });

  await h.test('fork-question: "start fresh" threads shareData: false', () => {
    h.ok(
      /COPY\.forkStartFresh[\s\S]{0,120}onFork\(a, \{ shareData: false \}\)/.test(homeScreenSrc),
      'the forkStartFresh row must call onFork(a, { shareData: false })',
    );
  });

  await h.test('fork-question: LauncherRoot forwards opts verbatim into access.fork', () => {
    h.ok(
      launcherRootSrc.includes('await access.fork(app, undefined, opts);'),
      'LauncherRoot.onFork must forward its opts parameter into access.fork(app, undefined, opts)',
    );
  });
}
