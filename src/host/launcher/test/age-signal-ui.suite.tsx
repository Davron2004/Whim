/** The store age check in the rendered launcher (legal-surface-v2 task 9.4; spec store-age-signals):
 *  a data-sending action with the terms step due asks the store first; an approved minor and a phone
 *  with no signal reach the terms step, an unapproved minor gets the parental-approval message and a
 *  user under 13 the 13-and-over message, each with nothing sent and installed apps still working,
 *  and no request ever carries anything about age. */
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import HomeScreen from '../HomeScreen';
import ComposeStep from '../ComposeStep';
import ConsentScreen from '../ConsentScreen';
import MiniAppView from '../MiniAppView';
import TermsScreen from '../TermsScreen';
import AgeScreen from '../AgeScreen';
import { COPY, LEGAL_COPY } from '../copy';
import type { InstalledApp } from '../app-index';
import { termsStatus } from '../terms-acceptance';
import { APP_BUNDLES } from '../../../runtime/generated/app-bundles';
import { button, press, textOf } from './react-screen';
import { json, settle, tap, waitFor, wasSent, withLauncher, type SentRequest, type Tree } from './rendered-launcher';
import { injectedScripts } from './native-host';

const AGE_CHECK_KEY = 'whim.age-check:v1';
const DAY_MS = 24 * 60 * 60 * 1000;

const on = (tree: Tree, type: Parameters<Tree['root']['findAllByType']>[0]) => tree.root.findAllByType(type).length === 1;
const home = (tree: Tree) => tree.root.findByType(HomeScreen);
const blockedShown = (tree: Tree) => on(tree, AgeScreen) && tree.root.findByType(AgeScreen).props.held !== undefined;

/** The Tip Splitter example first-run seeding installs, once Home lists it. */
function tipSplitter(tree: Tree): InstalledApp | undefined {
  return home(tree).props.apps.find((a: InstalledApp) => a.name === 'Tip Splitter');
}

/** Let the running app's page finish loading, so the shell delivers its bundle. */
async function loadAppPage(tree: Tree): Promise<void> {
  await TestRenderer.act(async () => tree.root.find((node) => node.type === 'WebView').props.onLoadEnd());
}

async function describeAnApp(tree: Tree): Promise<void> {
  await TestRenderer.act(async () => home(tree).props.onCreate());
}

const clarifyServer = (r: SentRequest): Response | Promise<Response> =>
  r.path === '/v1/clarify' ? json({ questions: [] }) : new Promise<Response>(() => {});

/** A native reader that answers `signal` and counts how often it was asked. */
function scripted(signal: () => unknown) {
  const reader = { calls: 0, ask: () => { reader.calls++; return Promise.resolve(signal()); } };
  return reader;
}

/** An age check stored `daysAgo` days ago with this outcome, as an earlier launch left it. */
const storedCheck = (outcome: string, daysAgo: number) => (kv: { set: (k: string, v: string) => void }) =>
  kv.set(AGE_CHECK_KEY, JSON.stringify({ outcome, checkedAt: new Date(Date.now() - daysAgo * DAY_MS).toISOString() }));

/** Every header name and every body key, at any depth, of one request. */
function fieldNames(request: SentRequest): string[] {
  const names = [...request.headers.keys()];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value)) { names.push(key); walk(inner); }
    }
  };
  walk(request.body);
  return names;
}

/** A field name that speaks about age: one of its words (split at case changes, `-` and `_`) is an
 *  age word. Word-wise, so `language` or `message` never match. */
function ageField(name: string): boolean {
  const words = name.replaceAll(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[\s_-]+/);
  return words.some((word) => ['age', 'ages', 'birth', 'birthdate', 'dob', 'minor', 'adult', 'outcome', 'checked', 'signal', 'parental'].includes(word));
}

export async function runAgeSignalUiTests(h: Harness): Promise<void> {
  await h.test('age signal: an approved minor continues — the store is asked before the terms step, which then opens as usual', async () => {
    const store = scripted(() => 'minor-approved');
    await withLauncher({ terms: false, consent: false, ageSignal: store.ask, server: clarifyServer }, async ({ tree, kv }) => {
      await describeAnApp(tree);
      await waitFor(() => on(tree, TermsScreen), 'the terms step');
      h.eq(store.calls, 1, 'the store was asked once');
      h.eq(JSON.parse(kv.getString(AGE_CHECK_KEY) ?? 'null').outcome, 'allowed', 'the outcome stored is allowed');
      await press(button(tree, COPY.termsAccept));
      h.ok(on(tree, ConsentScreen), 'and the flow goes on to consent');
    });
  });

  await h.test('age signal: no signal lets the user through — a failing platform API reaches the terms step', async () => {
    await withLauncher({ terms: false, consent: false, ageSignal: () => Promise.reject(new Error('Play services missing')), server: clarifyServer }, async ({ tree }) => {
      await describeAnApp(tree);
      await waitFor(() => on(tree, TermsScreen), 'the terms step');
      h.ok(!on(tree, AgeScreen), 'no age message');
    });
  });

  await h.test('age signal: an unapproved minor is held — the parental-approval message, no terms step, nothing sent, installed apps keep working', async () => {
    await withLauncher({ examples: true, terms: false, consent: false, ageSignal: () => Promise.resolve('minor-not-approved'), server: clarifyServer }, async ({ tree, kv, sent, probes }) => {
      await waitFor(() => on(tree, HomeScreen) && tipSplitter(tree) !== undefined, 'the example apps');
      await describeAnApp(tree);
      await waitFor(() => blockedShown(tree), 'the parental-approval message');
      const text = textOf(tree.root);
      h.ok(text.includes(COPY.ageBlockedTitle) && text.includes(COPY.ageBlockedBody), 'the message says a parent can approve through the store');
      h.ok(!text.includes(COPY.ageUnder13Title), 'not the 13-and-over message');
      h.ok(!on(tree, TermsScreen) && !on(tree, ConsentScreen), 'neither the terms step nor the consent screen opens');
      h.eq(termsStatus(kv).kind, 'absent', 'no terms acceptance is stored');
      await press(button(tree, COPY.ageBack));
      h.ok(on(tree, HomeScreen), 'Back returns Home');
      h.eq([sent.length, probes.length], [0, 0], 'no request was sent, not even a probe');

      injectedScripts.length = 0;
      await TestRenderer.act(async () => home(tree).props.onOpen(tipSplitter(tree)));
      await waitFor(() => on(tree, MiniAppView), 'the example to open');
      await loadAppPage(tree);
      h.ok(injectedScripts.length === 1 && injectedScripts[0].includes(JSON.stringify(APP_BUNDLES['tip-splitter'])), 'an installed app still opens and runs');
    });
  });

  await h.test('age signal: a user under 13 is held — the 13-and-over message, no terms step, nothing sent, installed apps keep working', async () => {
    await withLauncher({ examples: true, terms: false, consent: false, ageSignal: () => Promise.resolve('under-13'), server: clarifyServer }, async ({ tree, kv, sent, probes }) => {
      await waitFor(() => on(tree, HomeScreen) && tipSplitter(tree) !== undefined, 'the example apps');
      await describeAnApp(tree);
      await waitFor(() => blockedShown(tree), 'the 13-and-over message');
      const text = textOf(tree.root);
      h.ok(text.includes(COPY.ageUnder13Title) && text.includes(COPY.ageUnder13Body), 'the message says Whim’s AI features are for people 13 and over');
      h.ok(!text.includes(COPY.ageBlockedTitle) && !text.includes(COPY.ageBlockedBody), 'not the parental-approval message: a parent can’t approve this');
      h.ok(!on(tree, TermsScreen) && !on(tree, ConsentScreen), 'neither the terms step nor the consent screen opens');
      h.eq(JSON.parse(kv.getString(AGE_CHECK_KEY) ?? 'null').outcome, 'blocked', 'only "blocked" is stored');
      await press(button(tree, COPY.ageBack));
      h.ok(on(tree, HomeScreen), 'Back returns Home');
      h.eq([sent.length, probes.length], [0, 0], 'no request was sent, not even a probe');

      injectedScripts.length = 0;
      await TestRenderer.act(async () => home(tree).props.onOpen(tipSplitter(tree)));
      await waitFor(() => on(tree, MiniAppView), 'the example to open');
      await loadAppPage(tree);
      h.ok(injectedScripts.length === 1 && injectedScripts[0].includes(JSON.stringify(APP_BUNDLES['tip-splitter'])), 'an installed app still opens and runs');
    });
  });

  await h.test('age signal: on a French phone the 13-and-over message is French', async () => {
    await withLauncher({ locale: 'fr-CA', terms: false, consent: false, ageSignal: () => Promise.resolve('under-13'), server: clarifyServer }, async ({ tree }) => {
      await describeAnApp(tree);
      await waitFor(() => blockedShown(tree), 'the 13-and-over message');
      const text = textOf(tree.root);
      h.ok(text.includes(LEGAL_COPY.fr.ageUnder13Title) && text.includes(LEGAL_COPY.fr.ageUnder13Body), 'in the French table’s words');
    });
  });

  await h.test('age signal: on a French phone the parental-approval message is French', async () => {
    await withLauncher({ locale: 'fr-CA', terms: false, consent: false, ageSignal: () => Promise.resolve('minor-not-approved'), server: clarifyServer }, async ({ tree }) => {
      await describeAnApp(tree);
      await waitFor(() => blockedShown(tree), 'the parental-approval message');
      const text = textOf(tree.root);
      h.ok(text.includes(LEGAL_COPY.fr.ageBlockedBody) && text.includes(LEGAL_COPY.fr.ageBack), 'in the French table’s words');
    });
  });

  await h.test('age signal: a blocked outcome is asked again at the next attempt, so a parent’s approval lets the user in', async () => {
    const store = scripted(() => 'minor-approved');
    await withLauncher({ terms: false, consent: false, prepare: storedCheck('blocked', 0), ageSignal: store.ask, server: clarifyServer }, async ({ tree }) => {
      await describeAnApp(tree);
      await waitFor(() => on(tree, TermsScreen), 'the terms step');
      h.eq(store.calls, 1, 'the store was asked again');
    });
  });

  await h.test('age signal: after a restart a stored "blocked" is asked again, and the fresh answer picks the message', async () => {
    const store = scripted(() => 'under-13');
    await withLauncher({ terms: false, consent: false, prepare: storedCheck('blocked', 0), ageSignal: store.ask, server: clarifyServer }, async ({ tree }) => {
      await describeAnApp(tree);
      await waitFor(() => blockedShown(tree), 'the held message');
      h.eq(store.calls, 1, 'the store was asked again');
      h.ok(textOf(tree.root).includes(COPY.ageUnder13Title), 'the 13-and-over message, from the fresh answer');
    });
  });

  await h.test('age signal: a recent allowed outcome is not re-asked; one over 30 days old is', async () => {
    const recent = scripted(() => 'adult');
    await withLauncher({ terms: false, consent: false, prepare: storedCheck('allowed', 2), ageSignal: recent.ask, server: clarifyServer }, async ({ tree }) => {
      await describeAnApp(tree);
      h.ok(on(tree, TermsScreen), 'the terms step opens directly');
      h.eq(recent.calls, 0, 'without asking the store');
    });
    const stale = scripted(() => 'adult');
    await withLauncher({ terms: false, consent: false, prepare: storedCheck('allowed', 31), ageSignal: stale.ask, server: clarifyServer }, async ({ tree }) => {
      await describeAnApp(tree);
      await waitFor(() => on(tree, TermsScreen), 'the terms step');
      h.eq(stale.calls, 1, 'a stale outcome is checked again first');
    });
  });

  await h.test('age signal: a store that never answers is given up on after 3 seconds, and the flow goes on to the terms step', async () => {
    await withLauncher({ terms: false, consent: false, ageSignal: () => new Promise<unknown>(() => {}), server: clarifyServer }, async ({ tree, kv, clock }) => {
      await describeAnApp(tree);
      h.ok(on(tree, AgeScreen) && !blockedShown(tree), 'the check is running');
      await TestRenderer.act(async () => clock.fire(3000));
      await waitFor(() => on(tree, TermsScreen), 'the terms step');
      h.eq(JSON.parse(kv.getString(AGE_CHECK_KEY) ?? 'null').outcome, 'allowed', 'the outcome stored is allowed, as for no signal');
    });
  });

  await h.test('age signal: leaving while the store is asked drops its late answer', async () => {
    let answer: (signal: string) => void = () => {};
    const pending = () => new Promise<unknown>((resolve) => { answer = resolve; });
    await withLauncher({ terms: false, consent: false, ageSignal: pending, server: clarifyServer }, async ({ tree }) => {
      await describeAnApp(tree);
      h.ok(on(tree, AgeScreen) && !blockedShown(tree), 'the check is running');
      await press(button(tree, COPY.ageBack));
      h.ok(on(tree, HomeScreen), 'Back returns Home at once');
      await TestRenderer.act(async () => answer('adult'));
      await settle();
      h.ok(on(tree, HomeScreen) && !on(tree, TermsScreen), 'the answer arriving later does not open the terms step');
    });
  });

  await h.test('age signal: nothing about age leaves the phone — requests after an age check carry no age field or value', async () => {
    await withLauncher({ terms: false, consent: false, ageSignal: () => Promise.resolve('minor-approved'), server: clarifyServer }, async ({ tree, kv, sent, probes }) => {
      await describeAnApp(tree);
      await waitFor(() => on(tree, TermsScreen), 'the terms step');
      const checkedAt = JSON.parse(kv.getString(AGE_CHECK_KEY) ?? 'null').checkedAt as string;
      await press(button(tree, COPY.termsAccept));
      await press(button(tree, COPY.consentAgree));
      await TestRenderer.act(async () => tree.root.findByType(ComposeStep).props.onChangeText('A tea timer'));
      await tap(() => tree.root.findByType(ComposeStep).props.onContinue());
      await waitFor(() => wasSent(sent, '/v1/clarify'), 'the clarify request');
      await waitFor(() => probes.length > 0, 'the connectivity probe');
      const requests = [...sent, ...probes.map((headers) => ({ headers, body: null }) as unknown as SentRequest)];
      h.eq(requests.flatMap(fieldNames).filter(ageField), [], 'no header or body field names age');
      const wire = requests.map((r) => `${JSON.stringify([...r.headers.entries()])} ${JSON.stringify(r.body)}`).join('\n');
      for (const value of [checkedAt, 'minor-approved', 'minor']) {
        h.ok(!wire.includes(value), `no request carries "${value}"`);
      }
    });
  });
}
