/**
 * report-send Node suite (store-launch-compliance review fix M6c; spec `content-reporting`, design
 * D13/D14): the rendered `ReportSheet` against a scripted server. A reason is required before Send
 * is enabled, a send in flight cannot be sent again, a refusal or failure returns to the same
 * resendable draft, a success shows thanks, and each outcome is logged with its status. The preview
 * shows exactly the body Send posts, and the sheet is the report's notice: the phone-ID line, the
 * privacy link, and a thank-you that promises nothing. Plus `sendFailureOutcome`, which names the
 * logged outcome of a failure.
 */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY } from '../copy';
import ReportSheet from '../ReportSheet';
import { sendFailureOutcome } from '../report-send';
import { sendReport } from '../generation-client';
import { appInfoReader } from '../app-info';
import type { InstalledApp } from '../app-index';
import type { StoreAccess } from '../store-access';
import { GenerationClientError, reportClientOptions } from '../transport-shared';
import { log } from '../../logging';
import { button, press, renderScreen, textOf, unmountScreen } from './react-screen';
import { testAppInfo } from './client-fixtures';
import { Linking } from './native-host';
import { RELEASE } from '../release-config';

const APP: InstalledApp = { id: 'timer', name: 'Timer', createdAt: 1, lineageId: 'main', record: { appId: 'timer', name: 'Timer', manifest: { capabilities: [] } } };
const ACCESS = { activeDescription: async () => 'A tea timer', activeSource: async () => 'export default {}' } as unknown as StoreAccess;

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The last log record with this message, as the seam recorded it. */
const lastLog = (message: string) => log.buffer.snapshot().filter((r) => r.message === message).at(-1)?.fields as Record<string, unknown> | undefined;

export async function runReportSendTests(h: Harness): Promise<void> {
  await h.test('report sheet: Send needs a reason; a refused or failed send returns to the same draft; a sent one shows thanks', async () => {
    const answers: (() => Promise<Response>)[] = [];
    const bodies: unknown[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return answers.shift()!();
    }) as typeof fetch;
    let closed = 0;
    const tree = await renderScreen(React.createElement(ReportSheet, {
      app: APP, access: ACCESS, options: { ...reportClientOptions({ kind: 'absent' }, 'https://server.test', 'device', testAppInfo), fetchImpl }, onClose: () => { closed++; }, onUpdateRequired: () => {}, legalLanguage: 'en',
    }));
    try {
      await TestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
      await h.throws(() => press(button(tree, COPY.reportSend)), 'Cannot press a disabled control', 'Send is disabled until a reason is chosen');
      h.ok(!textOf(tree.root).includes(COPY.reportPreviewTitle), 'the empty preview stays hidden before a reason is chosen');
      h.ok(textOf(tree.root).includes(COPY.reportCodeDisclosure), 'the code disclosure is visible before sending');
      h.ok(!textOf(tree.root).includes('Include the code'), 'code has no opt-out');
      await press(button(tree, COPY.reportReasonBroken));
      h.ok(textOf(tree.root).includes(COPY.reportPreviewTitle), 'choosing a reason reveals the preview');
      await TestRenderer.act(async () => tree.root.findByType('Switch').props.onValueChange(false));

      answers.push(async () => json({ error: 'payload_too_large', hint: 'That report is too large to send.' }, 413));
      await press(button(tree, COPY.reportSend));
      h.eq((bodies[0] as { reason?: string }).reason, 'broken', 'the chosen reason is sent');
      h.ok(!('prompt' in (bodies[0] as object)), 'the prompt switch removes only the prompt');
      h.eq((bodies[0] as { source?: string }).source, 'export default {}', 'the active version’s code is sent');
      h.ok(textOf(tree.root).includes(COPY.reportTooLarge), 'a size refusal offers the remaining prompt option');
      h.eq(lastLog('report refused')?.outcome, 'payload_too_large', 'and is logged with its refusal code');

      answers.push(async () => json({ error: 'internal_error', hint: 'Something went wrong on our side. Please try again.' }, 500));
      await press(button(tree, COPY.reportSend));
      h.ok(textOf(tree.root).includes(COPY.reportSendFailedGeneric), 'an unrecognised failure shows the generic notice');
      h.eq(lastLog('report failed')?.outcome, '500', 'and is logged with the status the server answered');

      let finish!: (response: Response) => void;
      answers.push(() => new Promise<Response>((resolve) => { finish = resolve; }));
      await press(button(tree, COPY.reportSend));
      h.ok(textOf(tree.root).includes(COPY.reportSendBusy), 'while sending, the button says so');
      await h.throws(() => press(button(tree, COPY.reportSendBusy)), 'Cannot press a disabled control', 'and cannot send again');
      await TestRenderer.act(async () => { finish(json({ reportId: 'r-1' }, 202)); await new Promise((r) => setImmediate(r)); });
      h.eq(bodies.length, 3, 'three sends, from the same draft, with no re-choosing of the reason');
      h.ok(textOf(tree.root).includes(COPY.reportThanksTitle), 'a sent report shows thanks');
      await press(button(tree, COPY.reportThanksDone));
      h.eq(closed, 1, 'Done closes the sheet');
    } finally {
      await unmountScreen(tree);
    }
  });

  await h.test('report sheet: the preview shows exactly the body Send posts, and the sheet is the report’s notice', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return json({ reportId: 'r-1' }, 202);
    }) as typeof fetch;
    const tree = await renderScreen(React.createElement(ReportSheet, {
      app: APP, access: ACCESS, options: { ...reportClientOptions({ kind: 'absent' }, 'https://server.test', 'device', testAppInfo), fetchImpl }, onClose: () => {}, onUpdateRequired: () => {}, legalLanguage: 'en',
    }));
    try {
      await TestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
      await press(button(tree, COPY.reportReasonWrongResult));
      await TestRenderer.act(async () => tree.root.findByType('TextInput').props.onChangeText('  The total is off by one  '));
      // Expand the code row, so the preview shows the code itself rather than its size.
      const showMore = tree.root.findAll((node) => node.type === 'TouchableOpacity' && textOf(node) === COPY.reportShowMore);
      for (const toggle of showMore) await press(toggle);
      const preview = textOf(tree.root);
      h.ok(preview.includes(COPY.reportDeviceIdLine), 'the sheet says this phone’s Whim ID goes with the report, to AnyCognition');
      const opened = Linking.opened.length;
      await press(button(tree, COPY.privacyPolicyLabel));
      h.eq(Linking.opened.slice(opened), [RELEASE.privacyPolicyUrl], 'and carries a privacy policy link');
      h.ok(!/anonymous/i.test(preview), 'no line calls the ID anonymous');

      await press(button(tree, COPY.reportSend));
      const body = bodies[0] ?? {};
      h.eq(Object.keys(body).sort((a, b) => a.localeCompare(b)), ['appName', 'note', 'prompt', 'reason', 'source'], 'the body carries the five previewed fields');
      h.eq(body.reason, 'wrong_result', 'the reason sent is the pill chosen');
      for (const field of ['note', 'appName', 'prompt', 'source'] as const) {
        h.ok(typeof body[field] === 'string' && preview.includes(body[field] as string), `the ${field} sent is the ${field} the preview showed`);
      }
      h.eq(body.note, 'The total is off by one', 'the note the preview showed was already the trimmed note');
      const thanks = textOf(tree.root);
      h.ok(thanks.includes(COPY.reportThanksTitle), 'a sent report shows thanks');
      h.ok(!/every report/i.test(thanks), 'with no promise that every report is read');
    } finally {
      await unmountScreen(tree);
    }
  });

  await h.test('sendFailureOutcome: an HTTP status the server answered with is logged verbatim, never as network', () => {
    const err = new GenerationClientError('http', { status: 413 });
    h.eq(sendFailureOutcome(err), '413', 'a real HTTP status is logged verbatim');
  });

  // N7b: sendFailureOutcome only checked `kind === 'http'`, so a device_id 400 (a real status the
  // server answered with) was mislabelled as 'network'.
  await h.test('sendFailureOutcome: a device_id status the server answered with is also logged verbatim, never as network', () => {
    const err = new GenerationClientError('device_id', { status: 400, hint: 'This device could not be identified.' });
    h.eq(sendFailureOutcome(err), '400', 'a device_id error is a real answered status, not a network failure');
  });

  await h.test('sendFailureOutcome: a genuine transport failure logs as network', () => {
    h.eq(
      sendFailureOutcome(new GenerationClientError('network', { hint: 'fetch failed' })),
      'network',
      'a genuine network-level failure logs as network',
    );
    h.eq(sendFailureOutcome(new Error('boom')), 'network', 'an unrecognised thrown value logs as network');
  });

  // request-envelope: a report whose envelope could not be built never left the phone.
  await h.test('sendFailureOutcome: a report that could not be built logs as client, never as network', async () => {
    let fetched = 0;
    const fetchImpl = (async () => { fetched++; return json({ reportId: 'r-1' }, 202); }) as typeof fetch;
    const missingModule = appInfoReader('ios', () => null);
    const options = { ...reportClientOptions({ kind: 'absent' }, 'https://server.test', 'device', missingModule), fetchImpl };
    const err = await sendReport(options, { reason: 'broken' }).then(() => undefined, (e: unknown) => e);
    h.eq(fetched, 0, 'nothing was sent');
    h.eq(sendFailureOutcome(err), 'client', 'so the outcome does not claim the network failed');
  });
}
