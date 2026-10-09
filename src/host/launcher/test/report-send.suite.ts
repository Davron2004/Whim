/**
 * report-send Node suite (store-launch-compliance review fix M6c; spec `content-reporting`, design
 * D13/D14): the rendered Report screen against a scripted server. A reason is required before Send
 * is enabled, a send in flight cannot be sent again, a refusal or failure returns to the same
 * resendable draft, a success shows thanks, and each outcome is logged with its status. The preview
 * shows exactly the body Send posts, and the screen is the report's notice: the phone-ID line, the
 * privacy link, and a thank-you that promises nothing and, on the user's own server, names no
 * company (#153). Plus `sendFailureOutcome`, which names the
 * logged outcome of a failure.
 */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY, reportCodeLine, reportThanksLine } from '../copy';
import ReportScreen from '../ReportScreen';
import { sendFailureOutcome } from '../report-send';
import { sendReport } from '../generation-client';
import { appInfoReader } from '../app-info';
import type { InstalledApp } from '../app-index';
import type { StoreAccess } from '../store-access';
import { GenerationClientError, reportClientOptions } from '../transport-shared';
import { log } from '../../logging';
import { button, press, renderScreen, textOf, unmountScreen, hostType, isHost } from './react-screen';
import { testAppInfo } from './client-fixtures';
import { Linking } from './native-host';
import { RELEASE } from '../release-config';

const APP: InstalledApp = { id: 'timer', name: 'Timer', createdAt: 1, lineageId: 'main', record: { appId: 'timer', name: 'Timer', manifest: { capabilities: [] } } };
const ACCESS = { activeDescription: async () => 'A tea timer', activeSource: async () => 'export default {}' } as unknown as StoreAccess;

/** The include switch: one element, the row, announced as a switch by what it includes. */
const includeRow = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.find((node) => hostType(node) === 'Pressable' && node.props.accessibilityRole === 'switch');

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The last log record with this message, as the seam recorded it. */
const lastLog = (message: string) => log.buffer.snapshot().filter((r) => r.message === message).at(-1)?.fields as Record<string, unknown> | undefined;

export async function runReportSendTests(h: Harness): Promise<void> {
  await h.test('report: Send needs a reason; a refused or failed send returns to the same draft; a sent one shows thanks', async () => {
    const answers: (() => Promise<Response>)[] = [];
    const bodies: unknown[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return answers.shift()!();
    }) as typeof fetch;
    let closed = 0;
    const tree = await renderScreen(React.createElement(ReportScreen, {
      app: APP, access: ACCESS, options: { ...reportClientOptions({ kind: 'absent' }, 'https://server.test', 'device', testAppInfo), fetchImpl }, onLeave: () => { closed++; }, onUpdateRequired: () => {}, legalLanguage: 'en',
    }));
    try {
      await TestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
      await h.throws(() => press(button(tree, COPY.reportSend)), 'Cannot press a disabled control', 'Send is disabled until a reason is chosen');
      h.ok(!textOf(tree.root).includes(COPY.reportPreviewTitle), 'the empty preview stays hidden before a reason is chosen');
      h.ok(textOf(tree.root).includes(reportCodeLine('server.test')), 'the code line is visible before sending');
      h.ok(!textOf(tree.root).includes('Include the code'), 'code has no opt-out');
      await press(button(tree, COPY.reportReasonBroken));
      h.ok(textOf(tree.root).includes(COPY.reportPreviewTitle), 'choosing a reason offers the preview');
      h.eq([includeRow(tree).props.accessibilityLabel, includeRow(tree).props.accessibilityState.checked], [COPY.reportIncludePrompt, true], 'a screen reader announces the prompt switch by what it includes, on');
      await press(includeRow(tree));
      h.eq(includeRow(tree).props.accessibilityState.checked, false, 'and reads it off once flipped');

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
      await press(button(tree, COPY.reportSendBusy));
      h.eq(bodies.length, 3, 'and a tap on it sends nothing more');
      await TestRenderer.act(async () => { finish(json({ reportId: 'r-1' }, 202)); await new Promise((r) => setImmediate(r)); });
      h.eq(bodies.length, 3, 'three sends, from the same draft, with no re-choosing of the reason');
      h.ok(textOf(tree.root).includes(reportThanksLine('server.test')), 'a sent report shows thanks');
      await press(button(tree, COPY.reportThanksDone));
      h.eq(closed, 1, 'Done leaves the screen');
    } finally {
      await unmountScreen(tree);
    }
  });

  await h.test('report: the preview shows exactly the body Send posts, and the screen is the report’s notice', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return json({ reportId: 'r-1' }, 202);
    }) as typeof fetch;
    const tree = await renderScreen(React.createElement(ReportScreen, {
      app: APP, access: ACCESS, options: { ...reportClientOptions({ kind: 'absent' }, 'https://server.test', 'device', testAppInfo), fetchImpl }, onLeave: () => {}, onUpdateRequired: () => {}, legalLanguage: 'en',
    }));
    try {
      await TestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
      await press(button(tree, COPY.reportReasonWrongResult));
      await TestRenderer.act(async () => tree.root.find(isHost('TextInput')).props.onChangeText('  The total is off by one  '));
      h.ok(!textOf(tree.root).includes(COPY.reportFieldReason), 'the preview starts collapsed');
      await press(button(tree, COPY.reportPreviewTitle));
      // Expand the code row, so the preview shows the code itself rather than its size.
      const showMore = tree.root.findAll((node) => hostType(node) === 'Pressable' && node.props.accessibilityLabel === COPY.reportShowMore);
      h.eq(showMore.length, 2, 'the prompt and the code each expand');
      for (const toggle of showMore) await press(toggle);
      const preview = textOf(tree.root);
      h.ok(preview.includes('This phone’s Whim ID goes with your report.'), 'the screen says this phone’s Whim ID goes with the report');
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
      h.ok(thanks.includes(reportThanksLine('server.test')), 'a sent report shows thanks');
      h.ok(!/every report/i.test(thanks), 'with no promise that every report is read');
    } finally {
      await unmountScreen(tree);
    }
  });

  await h.test('report: the recipient line, the code line and the thanks name who gets the report, AnyCognition or the user’s own server (beta-1 D20, #153)', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return json({ reportId: 'r-1' }, 202);
    }) as typeof fetch;
    const cases = [
      [RELEASE.serverUrl, 'AnyCognition'],
      ['https://whim.example.org:8443', 'whim.example.org:8443'],
      // Whim's own server, written differently: the same origin is still AnyCognition.
      [`${RELEASE.serverUrl.replace('https://api.', 'HTTPS://API.')}:443`, 'AnyCognition'],
      // An address with credentials in it never shows them.
      ['https://alice:secret@whim.example.org:8443', 'whim.example.org:8443'],
    ] as const;
    for (const [baseUrl, recipient] of cases) {
      const tree = await renderScreen(React.createElement(ReportScreen, {
        app: APP, access: ACCESS, options: { ...reportClientOptions({ kind: 'absent' }, baseUrl, 'device', testAppInfo), fetchImpl }, onLeave: () => {}, onUpdateRequired: () => {}, legalLanguage: 'en',
      }));
      try {
        await TestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
        await press(button(tree, COPY.reportReasonBroken));
        const line = tree.root.findAll((n) => String(n.type) === 'Text' && textOf(n).includes('goes with your report')).map((n) => textOf(n));
        h.eq(line.length, 1, `${baseUrl}: one line says where the report goes`);
        h.ok(line[0].includes(recipient), `${baseUrl}: it names ${recipient} (got ${line[0]})`);
        h.ok(!/alice|secret|@/.test(line[0]), `${baseUrl}: and never the credentials an address carries`);
        if (recipient === 'AnyCognition') h.ok(!line[0].includes('server you chose'), `${baseUrl}: and no server of the user’s own`);
        else h.ok(line[0].includes('not to AnyCognition'), `${baseUrl}: and says AnyCognition doesn’t get it`);
        const codeLine = tree.root.findAll((n) => String(n.type) === 'Text' && textOf(n).startsWith('Your report includes this app’s code')).map((n) => textOf(n));
        h.eq(codeLine.length, 1, `${baseUrl}: one line says why the code goes`);
        if (recipient === 'AnyCognition') h.ok(/\bwe\b/.test(codeLine[0]), `${baseUrl}: AnyCognition looks into it ("we")`);
        else h.ok(codeLine[0].includes(recipient) && !/\bwe\b|AnyCognition|alice|secret/i.test(codeLine[0]), `${baseUrl}: whoever runs ${recipient} does, not "we" (got ${codeLine[0]})`);
        await press(button(tree, COPY.reportSend));
        h.ok(urls.at(-1)?.startsWith(baseUrl) === true, `${baseUrl}: Send posts to the recipient the line names`);
        const thanks = textOf(tree.root);
        if (recipient === 'AnyCognition') h.ok(thanks.includes('We’ll look into it'), `${baseUrl}: the thanks says we’ll look into it`);
        else h.ok(thanks.includes(recipient) && !/We’ll|AnyCognition|alice|secret/.test(thanks), `${baseUrl}: the thanks names ${recipient} and no company (got ${thanks})`);
      } finally {
        await unmountScreen(tree);
      }
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
