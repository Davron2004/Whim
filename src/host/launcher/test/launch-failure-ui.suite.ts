/**
 * Launch-failure product copy wiring (task 4.3, linked-apps-data-model chain-3, design D5/D7,
 * shared-storage-acceptance.spec.md §5).
 *
 * `MiniAppView.tsx`/`useMiniAppHost.ts` are not rendered under Node, so this is a static source
 * assertion (mirrors `fork-question-ui.suite.ts`'s idiom): it reads the production files and
 * verifies a pre-delivery `launchApp` refusal (the existing structured error surface,
 * `state.lastError`) is ALSO surfaced as a distinct `launchFailed` flag, that `MiniAppView`
 * renders honest static copy (never the raw `{kind, hint}`) for it with a way back to Home, and
 * that the copy itself passes the product-verbs guard (already exercised by
 * `product-verbs.suite.ts`, which iterates every `COPY` value).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Harness } from './harness';
import { COPY } from '../copy';

export async function runLaunchFailureUiTests(h: Harness): Promise<void> {
  const hostSrc = fs.readFileSync(path.join(process.cwd(), 'src/host/launcher/useMiniAppHost.ts'), 'utf8');
  const viewSrc = fs.readFileSync(path.join(process.cwd(), 'src/host/launcher/MiniAppView.tsx'), 'utf8');

  await h.test('launch-failure: a refused pre-delivery launch sets launchFailed on the SAME branch as lastError', () => {
    const failBranch = hostSrc
      .split('\n')
      .find(l => l.includes('lastError:') && l.includes('launched.error.kind'));
    h.ok(!!failBranch, 'the launchApp refusal branch must exist');
    h.ok(!!failBranch && failBranch.includes('launchFailed: true'), 'the same branch must set launchFailed: true');
  });

  await h.test('launch-failure: a fresh bind() attempt resets launchFailed before opening (no stale copy across launches)', () => {
    h.ok(
      /currentApp: displayName, lastError: null, launchFailed: false/.test(hostSrc),
      'bind() must reset launchFailed alongside lastError at the start of every attempt',
    );
  });

  await h.test('launch-failure: MiniAppView renders honest static copy for launchFailed, never the raw error', () => {
    h.ok(viewSrc.includes('host.state.launchFailed'), 'MiniAppView must branch on host.state.launchFailed');
    h.ok(viewSrc.includes('COPY.launchFailedTitle') && viewSrc.includes('COPY.launchFailedBody'), 'must render the static COPY strings, not lastError/hint/kind');
    h.ok(!/\{host\.state\.lastError\}/.test(viewSrc), 'must never interpolate the raw structured lastError string into the UI');
  });

  await h.test('launch-failure: the failure screen offers a way back to Home', () => {
    h.ok(
      /onPress=\{onExit\}[\s\S]{0,80}COPY\.launchFailedBack/.test(viewSrc),
      'the failure screen must wire a back-to-Home action labeled with COPY.launchFailedBack',
    );
  });

  await h.test('launch-failure: the copy carries no mechanism vocabulary (kind/hint/schema/database/storage)', () => {
    const strings = [COPY.launchFailedTitle, COPY.launchFailedBody, COPY.launchFailedBack];
    const forbidden = [/\bkind\b/i, /\bhint\b/i, /\bschema\b/i, /\bdatabase\b/i, /\bstorage\b/i, /\bclone\b/i, /\blink\b/i];
    for (const str of strings) {
      for (const bad of forbidden) {
        h.ok(!bad.test(str), `"${str}" must not contain forbidden term ${bad}`);
      }
    }
  });
}
