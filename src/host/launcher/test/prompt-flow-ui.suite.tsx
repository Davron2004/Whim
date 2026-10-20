/** The making sheet driven through the rendered launcher: describe → plan → making → ready, against
 *  a scripted server. Covers what the shell decides between the pages: when a request is sent, what it
 *  carries, which request closing a page cancels, where a response lands, what the draft keeps, and
 *  what the making page shows while the stream runs. */
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import HomeScreen from '../HomeScreen';
import { DescribePage } from '../DescribePage';
import { PlanPage } from '../PlanPage';
import MakingPage from '../MakingPage';
import ReadyPage from '../ReadyPage';
import FailurePage from '../FailurePage';
import MiniAppView from '../MiniAppView';
import { MakingSheet } from '../MakingSheet';
import { PendingBuildStore, type PendingBuildRecord } from '../pending-builds';
import { TextArea } from '../../ui/TextField';
import { COPY } from '../copy';
import { StoreAccess } from '../store-access';
import { RunJournalStore } from '../run-journal';
import { AppIndex, type InstalledApp } from '../app-index';
import { grantConsent, revokeConsent } from '../ai-consent';
import { Share, holdModalDismissals, modalPresentations } from './native-host';
import { chooseRow, longPress, pressToastAction, toastOf } from './home-rig';
import { streamResponse } from './client-fixtures';
import { androidBack, button, isHost, press, textOf } from './react-screen';
import { buildIt, composeAndContinue, hasInstalled, json, makingSheetOpen, onHome, planLoaded, questionsLanded, resultEvent, settle, sseStream, tap, waitFor, wasSent, withLauncher, type SentRequest, type Tree } from './rendered-launcher';

const QUESTION = { id: 'alert', question: 'How should it tell you?', options: ['Sound', 'Buzz'], select: 'one', other: false };
const APP: InstalledApp = { id: 'timer', name: 'Timer', createdAt: 1, lineageId: 'main', record: { appId: 'timer', name: 'Timer', manifest: { capabilities: [] } } };

/** The rewrite requests among `sent`. */
const rewritesIn = (sent: readonly SentRequest[]) => sent.filter((r) => r.path === '/v1/rewrite');
/** The name of the app a request says it concerns. */
const appNameOf = (request: SentRequest): string | undefined => (request.body?.app as { name?: string } | undefined)?.name;
const on = (tree: Tree, type: Parameters<Tree['root']['findAllByType']>[0]) => tree.root.findAllByType(type).length === 1;
const home = (tree: Tree) => tree.root.findByType(HomeScreen);
const plan = (tree: Tree) => tree.root.findByType(PlanPage).props.screen;
const textInput = (tree: Tree) => tree.root.find((n) => String(n.type) === 'TextInput');
const chip = (tree: Tree, label: string) => tree.root.find((n) => String(n.type) === 'Pressable' && n.props.accessibilityLabel === label);
const checked = (node: TestRenderer.ReactTestInstance) => node.props.accessibilityState?.checked === true;
/** The modals the system has on screen: mounted hosts that are not hidden. */
const presentedModals = (tree: Tree) => tree.root.findAll(isHost('Modal')).filter((modal) => modal.props.visible === true);

/** Describe `text` and continue through a zero-question clarify to a loaded plan. */
async function composeToPlan(tree: Tree, text: string): Promise<void> {
  await composeAndContinue(tree, text);
  await waitFor(() => planLoaded(tree), 'the plan to load');
}

/** Make it through a zero-question clarify and an empty plan, leaving the generate stream open. */
export async function startBuild(tree: Tree, text: string): Promise<void> {
  await composeToPlan(tree, text);
  await buildIt(tree);
  await waitFor(() => on(tree, MakingPage), 'the making page');
}

/** A server whose clarify asks nothing, whose rewrite echoes, and whose every generation is a
 *  stream the test drives; `streams` holds them in request order. */
export function streamingServer(streams: ReturnType<typeof sseStream>[]) {
  return (r: SentRequest) => {
    if (r.path === '/v1/clarify') return json({ questions: [] });
    if (r.path === '/v1/rewrite') return json({ rewrittenPrompt: String(r.body?.prompt), plan: [] });
    const stream = sseStream(r.signal);
    streams.push(stream);
    return stream.response;
  };
}

/** A promise the test resolves by hand. */
function held<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

export async function runPromptFlowUiTests(h: Harness): Promise<void> {
  await h.test('sheet: the composer opens Describe with the field set to focus and Continue waiting for words; nothing is sent', async () => {
    await withLauncher({ server: streamingServer([]) }, async ({ tree, paths }) => {
      h.ok(onHome(tree), 'Home to start with');
      await TestRenderer.act(async () => home(tree).props.onCreate());
      h.ok(makingSheetOpen(tree) && on(tree, DescribePage), 'the making sheet is open on Describe');
      h.ok(textOf(tree.root).includes(COPY.composeHeadline), 'asking what it should do');
      h.eq(tree.root.findByType(TextArea).props.autoFocus, true, 'with the field focused as it opens');
      h.eq(button(tree, COPY.flowContinue).props.disabled, true, 'Continue waits for words');
      h.eq(paths(), [], 'and nothing has been sent');
    });
  });

  await h.test('flow: nothing is made until Make it, which sends one generation with the answers; Continue sent exactly one clarify, and the rewrite went at once with every question delegated', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({
      server: (r: SentRequest) => {
        if (r.path === '/v1/clarify') return json({ questions: [QUESTION] });
        if (r.path === '/v1/rewrite') return json({ rewrittenPrompt: 'A tea timer that buzzes', plan: [] });
        return streamingServer(streams)(r);
      },
    }, async ({ tree, paths, sent }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => questionsLanded(tree), 'the question');
      await waitFor(() => planLoaded(tree), 'the plan');
      await settle();
      h.eq(paths(), ['/v1/clarify', '/v1/rewrite'], 'Continue sent one clarify, and the rewrite followed at once; nothing else');
      h.eq(sent.find((r) => r.path === '/v1/rewrite')?.body?.clarifications, [{ id: 'alert', question: QUESTION.question, choices: [], decide: true }], 'the rewrite delegated the question');
      await press(chip(tree, 'Buzz'));
      await settle();
      h.eq(paths(), ['/v1/clarify', '/v1/rewrite'], 'answering sends nothing: the plan was written without the answer');
      await buildIt(tree);
      await settle();
      h.eq(paths(), ['/v1/clarify', '/v1/rewrite', '/v1/generate'], 'Make it sends the one generation request');
      const generate = sent.find((r) => r.path === '/v1/generate');
      h.eq(generate?.body?.prompt, 'A tea timer that buzzes', 'generation makes the rewritten prompt');
      h.eq(generate?.body?.clarifications, [{ id: 'alert', question: QUESTION.question, choices: ['Buzz'] }], 'with the answer given on the plan page');
      streams[0].push(resultEvent('Tea Timer'));
      streams[0].end();
      await waitFor(() => on(tree, ReadyPage), 'the delivered app to land on the ready page');
      h.eq(paths().filter((p) => p === '/v1/generate').length, 1, 'and no second generation was started');
    });
  });

  await h.test('flow: the build prompt is the rewrite’s string until a row is edited, then it is assembled from the rows', async () => {
    for (const edit of [false, true]) {
      const streams: ReturnType<typeof sseStream>[] = [];
      const rewritten = 'A tea timer.  \nWith an odd   gap';
      await withLauncher({
        server: (r: SentRequest) => (r.path === '/v1/rewrite' ? json({ rewrittenPrompt: rewritten, plan: [{ label: 'Timer', text: 'Counts down.' }, { label: 'Alert', text: 'Buzzes.' }] }) : streamingServer(streams)(r)),
      }, async ({ tree, sent }) => {
        await composeToPlan(tree, 'A tea timer');
        if (edit) {
          await press(button(tree, 'Alert, Buzzes.'));
          await TestRenderer.act(async () => textInput(tree).props.onChangeText('Chimes.'));
          await press(button(tree, COPY.planRowSave));
        }
        await buildIt(tree);
        await waitFor(() => streams.length === 1, 'the generation request');
        const prompt = sent.find((r) => r.path === '/v1/generate')?.body?.prompt;
        if (edit) h.eq(prompt, 'Timer: Counts down.\nAlert: Chimes.', 'an edited plan is assembled from its current rows');
        else h.ok(prompt === rewritten, 'an unedited plan is the rewrite’s string, byte for byte');
        streams[0].end();
      });
    }
  });

  await h.test('flow: a plan that arrives as one string renders one row', async () => {
    await withLauncher({ server: (r) => (r.path === '/v1/clarify' ? json({ questions: [] }) : json({ rewrittenPrompt: 'A tea timer with a bell' })) }, async ({ tree }) => {
      await composeToPlan(tree, 'A tea timer');
      h.eq(plan(tree).rows, [{ label: '', text: 'A tea timer with a bell' }], 'one unlabelled row');
      h.eq(tree.root.findAll((n) => String(n.type) === 'Pressable' && n.props.accessibilityHint === COPY.planRowEditHint).length, 1, 'and one row to tap');
    });
  });

  for (const leave of ['clarify', 'rewrite'] as const) {
    await h.test(`flow: closing the sheet while the ${leave} is in flight aborts that request, and the late answer cannot reopen anything`, async () => {
      const clarify = held<Response>();
      const rewrite = held<Response>();
      await withLauncher({
        server: (r) => (r.path === '/v1/clarify' ? clarify.promise : rewrite.promise),
      }, async ({ tree, sent }) => {
        await composeAndContinue(tree, 'A tea timer');
        if (leave === 'rewrite') {
          await TestRenderer.act(async () => { clarify.resolve(json({ questions: [QUESTION] })); });
          await waitFor(() => questionsLanded(tree) && wasSent(sent, '/v1/rewrite'), 'the rewrite to start');
        }
        const own = sent.find((r) => r.path === (leave === 'clarify' ? '/v1/clarify' : '/v1/rewrite'));
        h.eq(own?.signal?.aborted, false, 'the request is live while its page is showing');
        await press(button(tree, COPY.sheetClose));
        h.eq(own?.signal?.aborted, true, `closing aborts the ${leave} request`);
        h.ok(onHome(tree), 'the sheet is closed');
        await TestRenderer.act(async () => {
          clarify.resolve(json({ questions: [QUESTION] }));
          rewrite.resolve(json({ rewrittenPrompt: 'late', plan: [] }));
        });
        await settle();
        h.ok(onHome(tree), 'a late response leaves the user on Home');
        h.eq(tree.root.findAllByType(FailurePage).length, 0, 'and an abandoned request never shows a failure');
      });
    });
  }

  await h.test('draft: closing on Plan keeps the words, answers and edits; the composer reads Continue; reopening restores them and sends the abandoned rewrite again', async () => {
    const rewrite = held<Response>();
    let rewrites = 0;
    await withLauncher({
      server: (r) => {
        if (r.path === '/v1/clarify') return json({ questions: [QUESTION, { ...QUESTION, id: 'extra', question: 'Which sound?', options: ['Bell', 'Chime'] }] });
        rewrites++;
        return rewrites === 1 ? rewrite.promise : json({ rewrittenPrompt: 'A tea timer', plan: [{ label: 'Timer', text: 'Counts down.' }] });
      },
    }, async ({ tree, sent }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => questionsLanded(tree) && wasSent(sent, '/v1/rewrite'), 'the questions and the rewrite');
      await press(chip(tree, 'Buzz'));
      await press(chip(tree, 'Chime'));
      const first = sent.find((r) => r.path === '/v1/rewrite');
      await press(button(tree, COPY.sheetClose));
      h.eq(first?.signal?.aborted, true, 'the abandoned rewrite was aborted');
      h.ok(onHome(tree), 'the sheet is closed');
      h.eq(home(tree).props.draft, 'A tea timer', 'Home is handed the draft');
      h.ok(textOf(tree.root).includes('Continue “A tea timer”'), 'and the composer reads Continue with the start of the words');
      await TestRenderer.act(async () => home(tree).props.onCreate());
      h.ok(on(tree, PlanPage) && makingSheetOpen(tree), 'the composer brings the Plan page back');
      h.eq([plan(tree).text, plan(tree).answers.alert.choices, plan(tree).answers.extra.choices], ['A tea timer', ['Buzz'], ['Chime']], 'with the same words and answers');
      await waitFor(() => planLoaded(tree), 'the plan to be written again');
      h.eq(sent.filter((r) => r.path === '/v1/rewrite').length, 2, 'the rewrite was sent again, and the clarify was not');
      h.eq(sent.filter((r) => r.path === '/v1/clarify').length, 1, 'the questions came back without asking');
      rewrite.resolve(json({ rewrittenPrompt: 'late', plan: [] }));
    });
  });

  await h.test('draft: closing on Plan after editing a row keeps the edit, and reopening shows it with no request sent again', async () => {
    await withLauncher({
      server: (r) => (r.path === '/v1/clarify' ? json({ questions: [QUESTION] }) : json({ rewrittenPrompt: 'A tea timer', plan: [{ label: 'Timer', text: 'Counts down.' }] })),
    }, async ({ tree, paths }) => {
      await composeToPlan(tree, 'A tea timer');
      await press(chip(tree, 'Buzz'));
      await press(button(tree, 'Timer, Counts down.'));
      await TestRenderer.act(async () => textInput(tree).props.onChangeText('Counts down in minutes.'));
      await press(button(tree, COPY.planRowSave));
      await press(button(tree, COPY.sheetClose));
      h.ok(textOf(tree.root).includes('Continue “A tea timer”'), 'the composer offers to continue');
      await TestRenderer.act(async () => home(tree).props.onCreate());
      h.eq(plan(tree).rows, [{ label: 'Timer', text: 'Counts down in minutes.', edited: true }], 'the edited row is back, marked Edited');
      h.eq([plan(tree).edited, checked(chip(tree, 'Buzz'))], [true, true], 'with the edit flag and the answer');
      h.ok(textOf(button(tree, 'Timer, Counts down in minutes., Edited')).includes(COPY.planRowEdited), 'and the row still says Edited after the draft was closed and restored');
      h.eq(paths(), ['/v1/clarify', '/v1/rewrite'], 'and nothing was sent again');
    });
  });

  await h.test('draft: closing on Describe keeps the words; emptying them, or making, clears the draft; a draft is kept per app', async () => {
    await withLauncher({ apps: [APP], server: streamingServer([]) }, async ({ tree }) => {
      await TestRenderer.act(async () => home(tree).props.onCreate());
      await TestRenderer.act(async () => tree.root.findByType(DescribePage).props.onChangeText('A tea timer'));
      await press(button(tree, COPY.sheetClose));
      h.eq(home(tree).props.draft, 'A tea timer', 'words typed and closed are a draft');
      await TestRenderer.act(async () => home(tree).props.onPromptAgain(APP));
      h.eq(tree.root.findByType(DescribePage).props.text, '', 'changing an app starts from its own, empty, draft');
      await TestRenderer.act(async () => tree.root.findByType(DescribePage).props.onChangeText('Add laps'));
      await press(button(tree, COPY.sheetClose));
      h.eq(home(tree).props.draft, 'A tea timer', 'the composer still shows the new-app draft');
      await TestRenderer.act(async () => home(tree).props.onPromptAgain(APP));
      h.eq(tree.root.findByType(DescribePage).props.text, 'Add laps', 'and the app’s own draft comes back for it');
      await press(button(tree, COPY.sheetClose));
      await TestRenderer.act(async () => home(tree).props.onCreate());
      await TestRenderer.act(async () => tree.root.findByType(DescribePage).props.onChangeText(''));
      await press(button(tree, COPY.sheetClose));
      h.eq(home(tree).props.draft, undefined, 'emptied words are no draft');
    });
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree }) => {
      await composeToPlan(tree, 'A tea timer');
      await press(button(tree, COPY.sheetClose));
      h.eq(home(tree).props.draft, 'A tea timer', 'closing on Plan left a draft');
      await TestRenderer.act(async () => home(tree).props.onCreate());
      await buildIt(tree);
      await waitFor(() => on(tree, MakingPage), 'the making page');
      await press(button(tree, COPY.sheetClose));
      h.eq(home(tree).props.draft, undefined, 'Make it spent the draft: the words are a run now');
      streams[0].end();
    });
  });

  await h.test('sheet: Back on Plan returns to Describe with the words and answers kept, and Continue returns to the same plan without asking again', async () => {
    await withLauncher({ server: (r) => (r.path === '/v1/clarify' ? json({ questions: [QUESTION] }) : json({ rewrittenPrompt: 'A tea timer', plan: [] })) }, async ({ tree, paths }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => planLoaded(tree), 'the plan');
      await press(chip(tree, 'Sound'));
      await press(button(tree, COPY.backLabel));
      h.eq([on(tree, DescribePage), tree.root.findByType(DescribePage).props.text], [true, 'A tea timer'], 'Describe, with the words');
      await tap(() => tree.root.findByType(DescribePage).props.onContinue());
      h.ok(on(tree, PlanPage) && checked(chip(tree, 'Sound')), 'Continue brings the same plan back, with the answer');
      h.eq(paths(), ['/v1/clarify', '/v1/rewrite'], 'with no new request');
      await press(button(tree, COPY.backLabel));
      await TestRenderer.act(async () => tree.root.findByType(DescribePage).props.onChangeText('A coffee timer'));
      await tap(() => tree.root.findByType(DescribePage).props.onContinue());
      await waitFor(() => planLoaded(tree), 'the new plan');
      h.eq(paths(), ['/v1/clarify', '/v1/rewrite', '/v1/clarify', '/v1/rewrite'], 'new words are a new idea: asked afresh');
    });
  });

  await h.test('sheet: Android back, as the sheet’s Modal delivers it, closes Describe keeping the draft, on Plan goes back to Describe first, and on Making leaves the run running', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, sent }) => {
      await composeToPlan(tree, 'A tea timer');
      await androidBack(tree);
      h.ok(on(tree, DescribePage), 'back on Plan returns to Describe');
      h.eq(tree.root.findByType(DescribePage).props.text, 'A tea timer', 'with the words kept');
      await androidBack(tree);
      h.ok(onHome(tree) && home(tree).props.draft === 'A tea timer', 'back on Describe closes the sheet and keeps the draft');
      await TestRenderer.act(async () => home(tree).props.onCreate());
      await tap(() => tree.root.findByType(DescribePage).props.onContinue());
      await waitFor(() => on(tree, PlanPage) && planLoaded(tree), 'the same plan, back');
      await buildIt(tree);
      await waitFor(() => on(tree, MakingPage), 'the making page');
      const generate = sent.find((r) => r.path === '/v1/generate');
      await androidBack(tree);
      h.ok(onHome(tree), 'back on Making closes the sheet');
      h.eq(generate?.signal?.aborted, false, 'without stopping the run');
      streams[0].end();
    });
  });

  await h.test('sheet: Android back on Plan with a row being edited cancels that edit, keeps every saved row, and only the next back leaves for Describe', async () => {
    await withLauncher({
      server: (r) => (r.path === '/v1/clarify' ? json({ questions: [] }) : json({ rewrittenPrompt: 'A tea timer', plan: [{ label: 'Timer', text: 'Counts down.' }, { label: 'Alert', text: 'Buzzes.' }] })),
    }, async ({ tree }) => {
      await composeToPlan(tree, 'A tea timer');
      await press(button(tree, 'Timer, Counts down.'));
      await TestRenderer.act(async () => textInput(tree).props.onChangeText('Counts down in minutes.'));
      await press(button(tree, COPY.planRowSave));
      await press(button(tree, 'Alert, Buzzes.'));
      await TestRenderer.act(async () => textInput(tree).props.onChangeText('Half-typed and never saved'));
      await androidBack(tree);
      h.ok(on(tree, PlanPage), 'back with a row open stays on the plan page');
      h.eq(tree.root.findAll((n) => String(n.type) === 'TextInput').length, 0, 'and closes the open edit');
      h.eq(plan(tree).rows.map((row: { text: string }) => row.text), ['Counts down in minutes.', 'Buzzes.'], 'the saved row keeps its text and the unsaved one is untouched');
      await androidBack(tree);
      h.ok(on(tree, DescribePage), 'the next back leaves for Describe');
      await tap(() => tree.root.findByType(DescribePage).props.onContinue());
      h.eq(plan(tree).rows.map((row: { text: string }) => row.text), ['Counts down in minutes.', 'Buzzes.'], 'and Continue brings the plan back with the saved edit');
    });
  });

  await h.test('draft: reopening a change draft sends and shows the app as it is now, not as it was when the draft was kept; a deleted app takes its draft with it', async () => {
    const first = held<Response>();
    let rewrites = 0;
    await withLauncher({
      apps: [APP],
      server: (r) => {
        if (r.path === '/v1/clarify') return json({ questions: [] });
        rewrites++;
        return rewrites === 1 ? first.promise : json({ rewrittenPrompt: 'Timer with laps', plan: [] });
      },
    }, async ({ tree, kv, sent }) => {
      await TestRenderer.act(async () => home(tree).props.onPromptAgain(APP));
      await TestRenderer.act(async () => tree.root.findByType(DescribePage).props.onChangeText('Add laps'));
      await tap(() => tree.root.findByType(DescribePage).props.onContinue());
      await waitFor(() => wasSent(sent, '/v1/rewrite'), 'the first rewrite');
      await press(button(tree, COPY.sheetClose));
      new AppIndex(kv).put({ ...APP, name: 'Stopwatch' });
      await TestRenderer.act(async () => home(tree).props.onPromptAgain(APP));
      await waitFor(() => rewritesIn(sent).length === 2, 'the rewrite, sent again');
      h.eq(rewritesIn(sent).map(appNameOf), ['Timer', 'Stopwatch'], 'the request sent after reopening carries the app’s current name');
      h.eq(tree.root.findByType(PlanPage).props.editing.name, 'Stopwatch', 'and the page is handed the current app');
      h.ok(textOf(tree.root).includes('Changing Stopwatch'), 'whose name heads it');
      await press(button(tree, COPY.sheetClose));
      new AppIndex(kv).remove(APP.id);
      await TestRenderer.act(async () => home(tree).props.onPromptAgain(APP));
      h.ok(on(tree, DescribePage), 'with the app gone, the draft is not restored');
      h.eq(tree.root.findByType(DescribePage).props.text, '', 'and starts empty');
      first.resolve(json({ rewrittenPrompt: 'late', plan: [] }));
    });
  });

  await h.test('flow: two fast taps on Continue send exactly one clarify, and two on Make it start exactly one run', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, sent }) => {
      await TestRenderer.act(async () => home(tree).props.onCreate());
      await TestRenderer.act(async () => tree.root.findByType(DescribePage).props.onChangeText('A tea timer'));
      const continueTap = tree.root.findByType(DescribePage).props.onContinue;
      await tap(() => { continueTap(); return continueTap(); });
      await waitFor(() => planLoaded(tree), 'the plan');
      h.eq(sent.filter((r) => r.path === '/v1/clarify').length, 1, 'the second tap, before the page changed, sent nothing');
      h.eq(sent.filter((r) => r.path === '/v1/clarify' && r.signal?.aborted).length, 0, 'and the first request was never aborted by a second one');
      const makeTap = tree.root.findByType(PlanPage).props.onMake;
      await tap(() => { makeTap(); return makeTap(); });
      await waitFor(() => on(tree, MakingPage), 'the making page');
      h.eq(sent.filter((r) => r.path === '/v1/generate').length, 1, 'one generation was started');
      streams[0].end();
    });
  });

  await h.test('flow: a Make it that cannot send takes nothing — the plan stays, and the next Make it on it starts the run', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    // The shell mounts with no grant, so nothing it has cached can stand in for the stored one.
    await withLauncher({ consent: false, server: streamingServer(streams) }, async ({ tree, kv, sent }) => {
      grantConsent(kv, '2026-09-18T12:00:00.000Z');
      await composeToPlan(tree, 'A tea timer');
      revokeConsent(kv);
      await buildIt(tree);
      await settle();
      h.eq([on(tree, PlanPage), sent.filter((r) => r.path === '/v1/generate').length], [true, 0], 'with the grant gone, Make it sends nothing and the plan stays');
      grantConsent(kv, '2026-09-18T12:00:00.000Z');
      await buildIt(tree);
      await waitFor(() => on(tree, MakingPage), 'the making page');
      h.eq(sent.filter((r) => r.path === '/v1/generate').length, 1, 'with the grant back, the same plan’s Make it starts the one run');
      streams[0].end();
    });
  });

  await h.test('draft: asking to change an app that has gone opens the new-app Describe, not a page for the app that is no longer there', async () => {
    await withLauncher({ apps: [APP], server: streamingServer([]) }, async ({ tree, kv }) => {
      await TestRenderer.act(async () => home(tree).props.onCreate());
      await TestRenderer.act(async () => tree.root.findByType(DescribePage).props.onChangeText('A dice roller'));
      await press(button(tree, COPY.sheetClose));
      await TestRenderer.act(async () => home(tree).props.onPromptAgain(APP));
      await TestRenderer.act(async () => tree.root.findByType(DescribePage).props.onChangeText('Add laps'));
      await press(button(tree, COPY.sheetClose));
      new AppIndex(kv).remove(APP.id);
      await TestRenderer.act(async () => home(tree).props.onPromptAgain(APP));
      const page = tree.root.findByType(DescribePage);
      h.eq(page.props.editing, undefined, 'the page changes no app');
      h.ok(textOf(tree.root).includes(COPY.composeHeadline) && !textOf(tree.root).includes('Changing Timer'), 'it asks what the new app should do, and names no app');
      h.eq(page.props.text, 'A dice roller', 'and carries the new-app draft, as the composer would: the words kept for the app that went are gone with it');
      await press(button(tree, COPY.sheetClose));
      h.eq(home(tree).props.draft, 'A dice roller', 'closing it keeps the new-app draft');
    });
  });

  await h.test('menu: Change it and Customize tile from a tile’s menu present their sheet only after the menu’s modal has dismissed, and the system refuses nothing', async () => {
    const sheets: [string, (tree: Tree) => boolean][] = [
      [COPY.actionChangeIt, (tree) => presentedModals(tree).some((modal) => modal.findAllByType(DescribePage).length === 1)],
      [COPY.actionCustomize, (tree) => presentedModals(tree).some((modal) => textOf(modal).includes(COPY.customizeTitle))],
    ];
    for (const [row, sheetUp] of sheets) {
      await withLauncher({ apps: [APP], server: streamingServer([]) }, async ({ tree }) => {
        const refused = modalPresentations.refused;
        await longPress(tree, 'Timer');
        h.eq(presentedModals(tree).length, 1, `${row}: the menu is the one modal up`);
        const release = holdModalDismissals();
        try {
          await chooseRow(tree, row);
          await settle();
          h.eq([sheetUp(tree), presentedModals(tree).length], [false, 0], `${row}: the menu is still dismissing: no sheet is presented`);
          await TestRenderer.act(async () => release());
          await waitFor(() => sheetUp(tree), `${row}: its sheet, once the menu has gone`);
          h.eq([presentedModals(tree).length, tree.root.findAll(isHost('Modal')).length], [1, 1], `${row}: alone`);
          h.eq(modalPresentations.refused - refused, 0, `${row}: the system refused no presentation`);
        } finally {
          release();
        }
      });
    }
  });

  await h.test('menu: Share link opens the system share sheet once the menu has gone, never under it', async () => {
    await withLauncher({ apps: [APP], server: streamingServer([]) }, async ({ tree }) => {
      Share.shared.splice(0);
      await longPress(tree, 'Timer');
      const release = holdModalDismissals();
      try {
        await chooseRow(tree, COPY.actionShareLink);
        h.eq(Share.shared.length, 0, 'the menu is still dismissing: nothing is handed to the share sheet');
        await TestRenderer.act(async () => release());
        h.eq(Share.shared.length, 1, 'once it has gone, the link is');
      } finally {
        release();
      }
    });
  });

  await h.test('sheet: closing on Making leaves the run going, and its tile reopens that run’s page', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, sent }) => {
      await startBuild(tree, 'A tea timer');
      streams[0].push({ type: 'stage', stage: 'generate', status: 'start' });
      await waitFor(() => tree.root.findByType(MakingPage).props.stage === 'generate', 'the stage');
      await press(button(tree, COPY.sheetClose));
      h.ok(onHome(tree), 'the sheet collapses into the tile');
      h.eq(sent.find((r) => r.path === '/v1/generate')?.signal?.aborted, false, 'the run keeps going');
      h.eq(home(tree).props.pending.map((p: { state: string }) => p.state), ['building'], 'as a building tile');
      await TestRenderer.act(async () => home(tree).props.onOpenPending(home(tree).props.pending[0]));
      h.ok(makingSheetOpen(tree) && tree.root.findByType(MakingPage).props.stage === 'generate', 'tapping the tile reopens the page, where the run is');
      streams[0].end();
    });
  });

  await h.test('sheet: two runs never cross — each tile reopens only its own run’s steps and place in line', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree }) => {
      await startBuild(tree, 'A tea timer');
      await press(button(tree, COPY.sheetClose));
      await startBuild(tree, 'A coffee timer');
      await press(button(tree, COPY.sheetClose));
      streams[0].push({ type: 'queued', position: 3 });
      streams[1].push({ type: 'stage', stage: 'check', status: 'start' });
      await waitFor(() => home(tree).props.pending.length === 2, 'both tiles');
      const [first, second] = [...home(tree).props.pending].sort((a: { createdAt: number }, b: { createdAt: number }) => a.createdAt - b.createdAt);
      await TestRenderer.act(async () => home(tree).props.onOpenPending(second));
      await waitFor(() => tree.root.findByType(MakingPage).props.stage === 'check', 'the second run’s stage');
      h.eq([tree.root.findByType(MakingPage).props.stage, tree.root.findByType(MakingPage).props.queuedPosition], ['check', undefined], 'the second run’s page shows only its own steps');
      await press(button(tree, COPY.sheetClose));
      await TestRenderer.act(async () => home(tree).props.onOpenPending(first));
      await waitFor(() => tree.root.findByType(MakingPage).props.queuedPosition === 3, 'the first run’s place in line');
      h.eq([tree.root.findByType(MakingPage).props.stage, tree.root.findByType(MakingPage).props.queuedPosition], [null, 3], 'the first run’s page shows its own place in line and none of the second’s steps');
      streams.forEach((stream) => stream.end());
    });
  });

  await h.test('flow: Prompt again sends the app’s name and current description with clarify and rewrite, even when the description resolves after Continue', async () => {
    const original = StoreAccess.prototype.activeDescription;
    try {
      const late = held<string | undefined>();
      StoreAccess.prototype.activeDescription = () => late.promise;
      const clarify = held<Response>();
      await withLauncher({
        apps: [APP],
        server: (r) => (r.path === '/v1/clarify' ? clarify.promise : json({ rewrittenPrompt: 'Timer with laps', plan: [] })),
      }, async ({ tree, sent }) => {
        await TestRenderer.act(async () => home(tree).props.onPromptAgain(APP));
        await TestRenderer.act(async () => tree.root.findByType(DescribePage).props.onChangeText('Add laps'));
        await tap(() => tree.root.findByType(DescribePage).props.onContinue());
        h.eq(sent[0]?.body?.app, { name: 'Timer' }, 'clarify, sent before the description resolved, carries the app’s name');
        await TestRenderer.act(async () => { late.resolve('  A stopwatch for tea  '); });
        await TestRenderer.act(async () => { clarify.resolve(json({ questions: [] })); });
        await waitFor(() => wasSent(sent, '/v1/rewrite'), 'the rewrite request');
        h.eq(sent.find((r) => r.path === '/v1/rewrite')?.body?.app, { name: 'Timer', description: 'A stopwatch for tea' },
          'the rewrite carries the description that resolved while clarify was in flight, trimmed');
      });
      const early = held<string | undefined>();
      StoreAccess.prototype.activeDescription = () => early.promise;
      await withLauncher({ apps: [APP], server: () => json({ questions: [] }) }, async ({ tree, sent }) => {
        await TestRenderer.act(async () => home(tree).props.onPromptAgain(APP));
        await TestRenderer.act(async () => { early.resolve('A stopwatch for tea'); });
        await TestRenderer.act(async () => tree.root.findByType(DescribePage).props.onChangeText('Add laps'));
        await tap(() => tree.root.findByType(DescribePage).props.onContinue());
        h.eq(sent[0]?.body?.app, { name: 'Timer', description: 'A stopwatch for tea' }, 'a description resolved before Continue rides with clarify');
      });
    } finally {
      StoreAccess.prototype.activeDescription = original;
    }
  });

  for (const from of ['clarify', 'rewrite'] as const) {
    await h.test(`flow: a busy-server refusal of the ${from} lands back on Describe with the words and the hint`, async () => {
      await withLauncher({
        server: (r) => (from === 'clarify' || r.path === '/v1/rewrite')
          ? json({ error: 'server_busy', hint: 'Whim is busy right now.' }, 429)
          : json({ questions: [] }),
      }, async ({ tree }) => {
        await composeAndContinue(tree, 'A dice roller');
        await waitFor(() => textOf(tree.root).includes('Whim is busy right now.') && on(tree, DescribePage), 'the refusal to land');
        h.eq(tree.root.findAllByType(PlanPage).length, 0, 'not on a page that did not send it');
        h.eq(tree.root.findByType(DescribePage).props.text, 'A dice roller', 'the user’s words are kept');
        h.eq(tree.root.findByType(DescribePage).props.notice?.tone, 'neutral', 'as an availability notice');
        await TestRenderer.act(async () => tree.root.findByType(DescribePage).props.onChangeText('A dice roller for two'));
        h.ok(textOf(tree.root).includes('Whim is busy right now.'), 'which retyping does not clear: it is not about the words');
      });
    });
  }

  await h.test('flow: a refusal of the words themselves lands on Describe and clears when they change', async () => {
    await withLauncher({ server: () => json({ error: 'content_policy', hint: 'That is not something Whim makes.' }, 422) }, async ({ tree }) => {
      await composeAndContinue(tree, 'A dice roller');
      await waitFor(() => on(tree, DescribePage) && textOf(tree.root).includes('That is not something Whim makes.'), 'the refusal to land');
      h.eq(tree.root.findByType(DescribePage).props.notice?.tone, 'danger', 'as a notice about the words');
      await TestRenderer.act(async () => tree.root.findByType(DescribePage).props.onChangeText('A different dice roller'));
      h.ok(!textOf(tree.root).includes('That is not something Whim makes.'), 'retyping clears it');
    });
  });

  await h.test('flow: a clarify the phone cannot reach stays on the plan page with the sentence and Try again, and Try again asks again', async () => {
    let clarifies = 0;
    await withLauncher({
      server: (r) => {
        if (r.path === '/v1/clarify') {
          clarifies++;
          return clarifies === 1 ? new Response('upstream down', { status: 500 }) : json({ questions: [] });
        }
        return json({ rewrittenPrompt: 'A dice roller', plan: [] });
      },
    }, async ({ tree, paths }) => {
      await composeAndContinue(tree, 'A dice roller');
      await waitFor(() => on(tree, PlanPage) && plan(tree).problem !== undefined, 'the notice');
      h.eq(tree.root.findAllByType(FailurePage).length, 0, 'never the failure page');
      await tap(() => button(tree, COPY.planTryAgain).props.onPress());
      await waitFor(() => planLoaded(tree), 'the plan after trying again');
      h.eq(paths(), ['/v1/clarify', '/v1/clarify', '/v1/rewrite'], 'Try again sent the clarify once more, and then the rewrite');
    });
  });

  await h.test('flow: the build screen shows stages, never streamed text or diagnostic detail', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree }) => {
      await startBuild(tree, 'A tea timer');
      streams[0].push({ type: 'stage', stage: 'generate', status: 'start' });
      streams[0].push({ type: 'token', text: 'SENTINEL_TOKEN_TEXT' });
      streams[0].push({ type: 'thinking', chars: 40 });
      streams[0].push({ type: 'diagnostic', diagnostic: { kind: 'type', symbol: 'SENTINEL_SYMBOL', message: 'SENTINEL_MESSAGE', hint: 'SENTINEL_HINT' } });
      streams[0].push({ type: 'stage', stage: 'check', status: 'start' });
      await waitFor(() => tree.root.findByType(MakingPage).props.stage === 'check', 'the stages to reach the screen');
      const shown = textOf(tree.root);
      for (const secret of ['SENTINEL_TOKEN_TEXT', 'SENTINEL_SYMBOL', 'SENTINEL_MESSAGE', 'SENTINEL_HINT']) {
        h.ok(!shown.includes(secret), `the build screen never shows "${secret}"`);
      }
    });
  });

  await h.test('flow: back on Making leaves the run going; delivered with the sheet closed, Home says it is ready and opens it, and the journal is the app’s last-run report', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, sent, kv }) => {
      await startBuild(tree, 'A tea timer');
      streams[0].push({ type: 'stage', stage: 'generate', status: 'start' });
      await waitFor(() => tree.root.findByType(MakingPage).props.stage === 'generate', 'the stage');
      const generate = sent.find((r) => r.path === '/v1/generate');
      await androidBack(tree);
      h.ok(onHome(tree), 'back closes the sheet');
      h.eq(generate?.signal?.aborted, false, 'and never cancels the run');
      h.eq(home(tree).props.pending.map((p: { state: string }) => p.state), ['building'], 'the run shows as a tile being made');
      streams[0].push({ type: 'token', text: 'abc' });
      streams[0].push({ type: 'token', text: 'defg' });
      streams[0].push(resultEvent('Tea Timer'));
      streams[0].end();
      await waitFor(() => hasInstalled(tree, 'Tea Timer'), 'the detached run to deliver');
      h.ok(onHome(tree) && !makingSheetOpen(tree), 'the user stays on Home: no page opens over it');
      h.eq(toastOf(tree), { message: 'Tea Timer is ready', action: COPY.actionOpen }, 'a toast says it is ready, with Open');
      h.eq(home(tree).props.pending, [], 'and the tile being made is gone');
      const delivered = home(tree).props.apps.find((a: InstalledApp) => a.name === 'Tea Timer') as InstalledApp;
      const report = new RunJournalStore(kv).getLastRun(delivered.id) ?? [];
      h.eq(report.at(-1)?.kind, 'terminal', 'the journal became the delivered app’s last-run report, ending in its terminal entry');
      h.eq(report.at(-1)?.aggregates, { chars: 7, tokens: 2 }, 'which flushes the final output counts, too recent for any throttled entry');
      h.eq(kv.getAllKeys().filter((k) => k.startsWith('journal:')), [], 'and no attempt journal is left behind');
      await pressToastAction(tree);
      await waitFor(() => tree.root.findAllByType(MiniAppView).length === 1, 'the app to open');
      h.eq(tree.root.findByType(MiniAppView).props.installedApp.id, delivered.id, 'Open opens the app that was made');
    });
  });

  await h.test('flow: delivered with the sheet open, Ready shows the app, and Open it launches it', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree }) => {
      await startBuild(tree, 'A tea timer');
      streams[0].push(resultEvent('Tea Timer'));
      streams[0].end();
      await waitFor(() => on(tree, ReadyPage), 'the Ready page');
      h.eq(tree.root.findByType(ReadyPage).props.words, 'A tea timer', 'with the person’s words');
      h.eq(toastOf(tree), null, 'and no toast: the person is looking at it');
      h.eq(tree.root.findAllByType(MiniAppView).length, 0, 'nothing runs before it is opened');
      await press(button(tree, COPY.readyOpen));
      await waitFor(() => tree.root.findAllByType(MiniAppView).length === 1, 'the app to open');
      h.eq(tree.root.findByType(MiniAppView).props.installedApp.name, 'Tea Timer', 'Open it opens the delivered app');
    });
  });

  await h.test('flow: Stop ends the run at once and leaves a stopped tile, which reopens as stopped with Try again; Try again runs it as the same tile', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, sent, kv }) => {
      await startBuild(tree, 'A tea timer');
      streams[0].push({ type: 'stage', stage: 'generate', status: 'start' });
      await waitFor(() => tree.root.findByType(MakingPage).props.stage === 'generate', 'the stage');
      await press(button(tree, COPY.actionStop));
      h.eq(sent.find((r) => r.path === '/v1/generate')?.signal?.aborted, true, 'the request is aborted at once');
      h.ok(onHome(tree) && !makingSheetOpen(tree), 'the sheet closes onto Home');
      const [stopped] = home(tree).props.pending as PendingBuildRecord[];
      h.eq([home(tree).props.pending.length, stopped?.state, stopped?.stopped], [1, 'interrupted', true], 'a stopped tile stays');
      h.ok(kv.getString(`journal:${stopped.id}`) != null, 'with its journal, for What happened');
      await TestRenderer.act(async () => home(tree).props.onOpenPending(stopped));
      const page = tree.root.findByType(FailurePage);
      h.eq(page.props.kind, 'stopped', 'the tile reopens as stopped');
      h.ok(textOf(page).includes(COPY.failureStopped) && !textOf(page).includes(COPY.interruptedBuildReason), 'saying the person stopped it, not that Whim closed');
      await press(button(tree, COPY.actionTryAgain));
      await waitFor(() => streams.length === 2 && on(tree, MakingPage), 'the run again');
      h.eq(home(tree).props.pending.map((p: PendingBuildRecord) => [p.id, p.state]), [[stopped.id, 'building']], 'as the same tile, building again');
      streams[1].end();
    });
  });

  await h.test('flow: Stop on a change ends it and leaves the app as it was, with no tile', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ examples: true, server: streamingServer(streams) }, async ({ tree, sent }) => {
      await waitFor(() => onHome(tree) && hasInstalled(tree, 'Tip Splitter'), 'the example apps');
      const app = (home(tree).props.apps as InstalledApp[]).find((a) => a.name === 'Tip Splitter')!;
      const before = (home(tree).props.apps as InstalledApp[]).map((a) => a.id);
      await TestRenderer.act(async () => home(tree).props.onPromptAgain(app));
      await TestRenderer.act(async () => tree.root.findByType(DescribePage).props.onChangeText('Add a tip slider'));
      await tap(() => tree.root.findByType(DescribePage).props.onContinue());
      await waitFor(() => planLoaded(tree), 'the plan');
      await buildIt(tree);
      await waitFor(() => wasSent(sent, '/v1/generate') && on(tree, MakingPage), 'the making page');
      h.ok(textOf(tree.root).includes('Changing Tip Splitter'), 'a change says so');
      await press(button(tree, COPY.actionStop));
      h.eq(home(tree).props.pending, [], 'no tile is left for a stopped change');
      h.eq((home(tree).props.apps as InstalledApp[]).map((a) => a.id), before, 'and the apps are as they were');
    });
  });

  await h.test('sheet: the Making page keeps one key from Make it to the run’s end, and a second run’s page starts at its own beginning', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree }) => {
      const keys: string[] = [];
      await composeToPlan(tree, 'A tea timer');
      await buildIt(tree);
      keys.push(String(sheetPageKey(tree)));
      await waitFor(() => on(tree, MakingPage), 'the making page');
      keys.push(String(sheetPageKey(tree)));
      streams[0].push({ type: 'stage', stage: 'check', status: 'start' });
      await waitFor(() => tree.root.findByType(MakingPage).props.stage === 'check', 'the first run’s stage');
      keys.push(String(sheetPageKey(tree)));
      // #131: a second run started while the first is still checking.
      await press(button(tree, COPY.sheetClose));
      await startBuild(tree, 'A coffee timer');
      const second = tree.root.findByType(MakingPage).props;
      h.ok(String(sheetPageKey(tree)) !== keys[0], 'the second run has its own key');
      h.eq([second.stage, second.words, second.repairAttempt], [null, 'A coffee timer', undefined], 'and its page shows its own start, not the first run’s check');
      await press(button(tree, COPY.sheetClose));
      const first = (home(tree).props.pending as PendingBuildRecord[]).find((p) => p.prompt === 'A tea timer')!;
      await TestRenderer.act(async () => home(tree).props.onOpenPending(first));
      keys.push(String(sheetPageKey(tree)));
      streams[0].push(resultEvent('Tea Timer'));
      streams[0].end();
      await waitFor(() => on(tree, ReadyPage), 'the first run’s Ready page');
      keys.push(String(sheetPageKey(tree)));
      h.eq(new Set(keys).size, 1, `the first run’s pages share one key from the first frame to Ready (got ${keys.join(', ')})`);
      h.ok(keys[0].startsWith('run:') && keys[0] !== 'run:starting', 'and it is the run’s own id');
      streams[1].end();
    });
  });

  await h.test('flow: a stream cut partway says the connection was lost, never suggests rewording, and Try again waits for the phone to be back online (#151)', async () => {
    const net: { up: boolean; cut?: () => void } = { up: true };
    await withLauncher(cuttingServer(net), async ({ tree, clock }) => {
      await startBuild(tree, 'A tea timer');
      await waitFor(() => tree.root.findByType(MakingPage).props.stage === 'generate' && net.cut != null, 'the run under way');
      net.up = false;
      net.cut!();
      await waitFor(() => on(tree, FailurePage), 'the failure page');
      const page = () => tree.root.findByType(FailurePage);
      h.eq(page().props.kind, 'connection', 'the run ended in a lost connection');
      h.ok(textOf(page()).includes(COPY.failureConnection), 'and says so');
      h.ok(!textOf(page()).includes(COPY.failureChangeDescription) && !/describing it differently/i.test(textOf(page())), 'never suggesting the words were the problem');
      await waitFor(() => page().props.offline === true, 'the phone to be known offline');
      h.ok(textOf(page()).includes(COPY.failureOfflineNotice), 'the page says Try again waits for the connection');
      await h.throws(() => press(button(tree, COPY.actionTryAgain)), 'disabled', 'and Try again is off');
      net.up = true;
      await TestRenderer.act(async () => { clock.fireWithin(30_000); });
      await waitFor(() => page().props.offline === false, 'the phone to be back online');
      h.ok(!textOf(page()).includes(COPY.failureOfflineNotice), 'the notice goes');
      await press(button(tree, COPY.actionTryAgain));
      h.ok(!on(tree, FailurePage), 'and Try again runs it again');
    });
  });

  await h.test('flow: a run the network cut stores a lost connection as its cause', async () => {
    const net: { up: boolean; cut?: () => void } = { up: true };
    await withLauncher(cuttingServer(net), async ({ tree, kv }) => {
      await startBuild(tree, 'A tea timer');
      await waitFor(() => tree.root.findByType(MakingPage).props.stage === 'generate' && net.cut != null, 'the run under way');
      net.cut!();
      await waitFor(() => on(tree, FailurePage), 'the failure page');
      h.eq(new PendingBuildStore(kv).list().map((r) => r.failure?.cause), ['connection'], 'the record says the connection was lost, not only its sentence');
    });
  });

  await h.test('flow: a plan the phone cannot reach says so as a connection problem, never as a failed build, and stays with Try again', async () => {
    await withLauncher({
      server: (r) => (r.path === '/v1/clarify' ? Promise.reject(new TypeError('Network request failed')) : json({ rewrittenPrompt: 'A dice roller', plan: [] })),
    }, async ({ tree }) => {
      await composeAndContinue(tree, 'A dice roller');
      await waitFor(() => on(tree, PlanPage) && plan(tree).problem !== undefined, 'the notice');
      h.eq(plan(tree).problem, { request: 'clarify', reason: COPY.planOffline, offline: true }, 'the page keeps the words and says the server could not be reached');
      h.ok(!/went wrong|building/i.test(textOf(tree.root)), 'nothing claims a build went wrong');
      h.eq(tree.root.findAllByType(FailurePage).length, 0, 'and it is not the failure page');
      h.ok(button(tree, COPY.planTryAgain) != null, 'Try again is there');
    });
  });
}

/** A server whose generate stream sends one stage and is then cut by the network, as a phone
 *  going offline mid-run sees it; `net.up` also answers the connectivity probe. */
function cuttingServer(net: { up: boolean; cut?: () => void }) {
  const encoder = new TextEncoder();
  return {
    health: () => {
      if (!net.up) throw new TypeError('Network request failed');
      return json({ service: 'whim-server' });
    },
    server: (r: SentRequest) => {
      if (r.path === '/v1/clarify') return json({ questions: [] });
      if (r.path === '/v1/rewrite') return json({ rewrittenPrompt: String(r.body?.prompt), plan: [] });
      const body = new ReadableStream<Uint8Array>({
        start: (controller) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'stage', stage: 'generate', status: 'start' })}\n\n`));
          net.cut = () => controller.error(new TypeError('Network request failed'));
        },
      });
      return streamResponse(body, { headers: { 'Content-Type': 'text/event-stream' } });
    },
  };
}

/** The key the making sheet shows its page under (`null` while it is closed). */
function sheetPageKey(tree: Tree): string | null {
  return tree.root.findByType(MakingSheet).props.content?.key ?? null;
}
