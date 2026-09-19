/**
 * settings-sections Node suite (task 3.6) — locks app-launcher spec "Settings groups its controls
 * into titled sections, with the server address under Advanced": Advanced renders collapsed by
 * default and open only while a non-blank override is saved.
 */

import { Harness } from './harness';
import { advancedInitiallyOpen } from '../settings-sections';

export async function runSettingsSectionsTests(h: Harness): Promise<void> {
  await h.test('advancedInitiallyOpen: no saved override collapses Advanced', () => {
    h.eq(advancedInitiallyOpen(undefined), false, 'unset -> collapsed');
    h.eq(advancedInitiallyOpen(''), false, 'blank -> collapsed');
    h.eq(advancedInitiallyOpen('   '), false, 'whitespace-only -> collapsed');
  });

  await h.test('advancedInitiallyOpen: a saved override renders Advanced already open', () => {
    h.eq(advancedInitiallyOpen('192.168.1.20:4000'), true, 'a saved override -> open');
  });
}
