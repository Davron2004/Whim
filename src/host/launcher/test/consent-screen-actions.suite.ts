/**
 * consent-screen-actions Node suite — locks ai-data-consent spec "Permission is explicit and
 * declining keeps installed apps usable": "Its decline action ..., system back, and any other
 * exit SHALL grant nothing".
 *
 * Red-check for a real regression this suite would have caught: review mode with consent off once
 * rendered ONLY its `turnOn` agree button, with no other exit — an iOS user (no hardware back) who
 * declined then opened Settings' AI features row to read the disclosure was stuck agreeing to
 * leave. `hasNonGrantingExit` fails the moment any mode's row set drops its non-granting row.
 */
import { Harness } from './harness';
import { consentScreenActions, hasNonGrantingExit } from '../consent-screen-actions';
import type { ConsentScreenMode } from '../consent-screen-actions';

const MODES: ReadonlyArray<{ name: string; mode: ConsentScreenMode }> = [
  { name: 'ask', mode: { kind: 'ask' } },
  { name: 'review, consent on', mode: { kind: 'review', consentOn: true } },
  { name: 'review, consent off', mode: { kind: 'review', consentOn: false } },
];

export async function runConsentScreenActionsTests(h: Harness): Promise<void> {
  for (const { name, mode } of MODES) {
    await h.test(`${name}: has a non-granting exit`, () => {
      h.ok(hasNonGrantingExit(mode), `${name} offers a row that leaves without granting anything`);
    });

    await h.test(`${name}: at most one row grants`, () => {
      const grantingRows = consentScreenActions(mode).filter((row) => row.grants);
      h.ok(grantingRows.length <= 1, `${name} never offers two rows that both grant`);
    });
  }

  await h.test('ask: agree grants, decline does not', () => {
    const rows = consentScreenActions({ kind: 'ask' });
    h.eq(
      rows,
      [
        { action: 'agree', kind: 'primary', grants: true },
        { action: 'decline', kind: 'plain', grants: false },
      ],
      'ask mode is exactly agree then decline',
    );
  });

  await h.test('review, consent on: neither row grants (keepOn is the safe large button)', () => {
    const rows = consentScreenActions({ kind: 'review', consentOn: true });
    h.eq(
      rows,
      [
        { action: 'keepOn', kind: 'primary', grants: false },
        { action: 'turnOff', kind: 'plain', grants: false },
      ],
      'review-on is exactly keepOn then turnOff, neither granting',
    );
  });

  await h.test('review, consent off: turnOn grants, and a plain-text row leaves without granting', () => {
    const rows = consentScreenActions({ kind: 'review', consentOn: false });
    h.eq(
      rows,
      [
        { action: 'turnOn', kind: 'primary', grants: true },
        { action: 'decline', kind: 'plain', grants: false },
      ],
      'review-off is exactly turnOn then a non-granting decline row',
    );
  });
}
