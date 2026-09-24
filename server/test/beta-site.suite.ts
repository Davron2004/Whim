/**
 * The /beta pages in the site build (beta-waitlist task 4.4; spec "Signup page and result pages",
 * "Pages-site fonts and assets", "Consent wording is recorded", "Privacy policy covers the
 * waitlist"). Every check reads what `buildSite` actually wrote, from a copy of this checkout's
 * `deploy/site/`. The Caddy routes and CSP are pinned in `deploy-config.suite.ts`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { check, eq, section } from './harness';
import { buildSite, DEPLOY_VALUE_PAGES, type AssociationFilesRunner, type BuildSiteResult } from '../src/site/build';
import { LEGAL_IDENTITY_PATH, LEGAL_PAGES, pageText, renderLegalSite, statedKeepPeriods } from '../src/site/legal-pages';
import { signupNoticeFindings, SIGNUP_PAGE } from '../src/site/notice-check';
import { CURRENT_NOTICE_ID, NOTICES, noticeFingerprint } from '../src/waitlist/notices';
import { WAITLIST_RETENTION_DAYS } from '../src/waitlist/store';
import { TRAP_FIELD } from '../src/routes/beta-signup';
import { MANIFESTS, RELEASED_SNAPSHOT_DIR, diffManifests, keepLimit, latestVersion, type DisclosureManifest } from '../../contract/src/disclosure-manifest';
import { AI_CONSENT_VERSION } from '../../src/host/launcher/release-config';

const ROOT = process.cwd();
const SITE_DIR = path.join(ROOT, 'deploy', 'site');
const SIGNUP_URL = 'https://api.pages.example.test/beta/signup';
const ENV: Record<string, string> = { WHIM_SUPPORT_EMAIL: 'support@pages.example.test', WHIM_BETA_SIGNUP_URL: SIGNUP_URL };
const BETA_PAGES = ['beta.html', 'beta-thanks.html', 'beta-retry.html'] as const;

const noAssociationFiles: AssociationFilesRunner = async () => {
  throw new Error('no fingerprints are committed in the fixture repo, so the runner must not run');
};

// ── Reading built HTML ──────────────────────────────────────────────────────────────────────

interface StartTag {
  readonly name: string;
  readonly attrs: ReadonlyMap<string, string>;
  /** Index just past the tag's `>`. */
  readonly end: number;
}

/** Where the run of characters matching `pattern` starting at `from` ends. */
function skip(text: string, from: number, pattern: RegExp): number {
  let i = from;
  while (i < text.length && pattern.test(text.charAt(i))) i++;
  return i;
}

/** The attribute value starting at `from` (just past `=`), and where it ends. */
function attributeValue(tag: string, from: number): { readonly value: string; readonly next: number } {
  const quote = tag.charAt(from);
  if (quote === '"' || quote === "'") {
    const close = tag.indexOf(quote, from + 1);
    return { value: tag.slice(from + 1, close), next: close + 1 };
  }
  const end = skip(tag, from, /[^\s>]/);
  return { value: tag.slice(from, end), next: end };
}

/** A tag's attributes: `name`, `name=value`, `name="value"`, `name='value'`, names lowercased. */
function attributesOf(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  let i = tag.search(/[\s/>]/);
  while (i !== -1 && i < tag.length) {
    const nameStart = skip(tag, i, /[\s/>]/);
    const nameEnd = skip(tag, nameStart, /[^\s=/>]/);
    if (nameEnd === nameStart) break;
    const { value, next } = tag.charAt(nameEnd) === '=' ? attributeValue(tag, nameEnd + 1) : { value: '', next: nameEnd };
    attrs.set(tag.slice(nameStart, nameEnd).toLowerCase(), value);
    i = next;
  }
  return attrs;
}

/** Every start tag outside `<style>`, in document order. */
function startTags(html: string): StartTag[] {
  const tags: StartTag[] = [];
  let at = html.indexOf('<');
  while (at !== -1) {
    const name = /^<([a-z][a-z0-9-]*)/i.exec(html.slice(at, at + 40))?.[1]?.toLowerCase();
    let next = at + 1;
    if (name !== undefined) {
      const close = html.indexOf('>', at);
      tags.push({ name, attrs: attributesOf(html.slice(at, close + 1)), end: close + 1 });
      next = name === 'style' ? html.indexOf('</style>', close) : close + 1;
    }
    at = html.indexOf('<', next);
  }
  return tags;
}

/** Why `html` could run script: a script element, an inline event handler, a `javascript:` URL. */
function scriptProblems(file: string, html: string): string[] {
  const problems: string[] = [];
  for (const tag of startTags(html)) {
    if (tag.name === 'script') problems.push(`${file} has a <script> element`);
    for (const [name, value] of tag.attrs) {
      if (name.startsWith('on')) problems.push(`${file} has an inline ${name} handler on <${tag.name}>`);
      // eslint-disable-next-line no-script-url -- this detects a script URL in a page; nothing runs it
      if (value.trim().toLowerCase().startsWith('javascript:')) problems.push(`${file} has a javascript: URL in ${name}`);
    }
  }
  return problems;
}

/** The named fields of the one form, and the page's tags. */
interface FormFields {
  readonly tags: readonly StartTag[];
  readonly html: string;
  named(name: string): StartTag[];
}

/** Exactly one field named `name`, or a problem. */
function single(fields: FormFields, name: string): StartTag | string {
  const found = fields.named(name);
  return found.length === 1 ? found[0] : `the form needs exactly one ${name} field, has ${found.length}`;
}

function emailProblems(fields: FormFields): string[] {
  const email = single(fields, 'email');
  if (typeof email === 'string') return [email];
  const problems: string[] = [];
  if (email.name !== 'input' || email.attrs.get('type') !== 'email') problems.push('email is not an <input type="email">');
  if (!email.attrs.has('required')) problems.push('email is not required');
  if (email.attrs.get('maxlength') !== '254') problems.push(`email's maxlength is ${email.attrs.get('maxlength') ?? 'unset'}, not 254`);
  return problems;
}

function platformProblems(fields: FormFields): string[] {
  const radios = fields.named('platform');
  const labelOf = (id: string | undefined): string | undefined => {
    const label = fields.tags.find((tag) => tag.name === 'label' && id !== undefined && tag.attrs.get('for') === id);
    return label === undefined ? undefined : pageText(fields.html.slice(label.end, fields.html.indexOf('</label>', label.end)));
  };
  const choices = radios.map((radio) => `${radio.attrs.get('type')}:${radio.attrs.get('value')}:${labelOf(radio.attrs.get('id'))}`);
  const problems: string[] = [];
  if (choices.join(' ') !== 'radio:ios:iOS radio:android:Android radio:other:Other') problems.push(`the platform choices are ${choices.join(' ')}`);
  if (!radios.some((radio) => radio.attrs.has('required'))) problems.push('no platform radio is required');
  return problems;
}

function optOutProblems(fields: FormFields): string[] {
  const optOut = single(fields, 'updates_opt_out');
  if (typeof optOut === 'string') return [optOut];
  const problems: string[] = [];
  if (optOut.attrs.get('type') !== 'checkbox' || optOut.attrs.get('value') !== '1') problems.push('updates_opt_out is not a checkbox with value 1');
  if (optOut.attrs.has('checked')) problems.push('updates_opt_out is checked by default');
  return problems;
}

function trapProblems(fields: FormFields): string[] {
  const trap = single(fields, TRAP_FIELD);
  if (typeof trap === 'string') return [trap];
  const problems: string[] = [];
  if (trap.name !== 'input' || trap.attrs.get('type') === 'hidden') problems.push(`the ${TRAP_FIELD} trap is type="hidden", which bots skip`);
  for (const [attr, value] of [['tabindex', '-1'], ['autocomplete', 'off'], ['aria-hidden', 'true']] as const) {
    if (trap.attrs.get(attr) !== value) problems.push(`the ${TRAP_FIELD} trap lacks ${attr}="${value}"`);
  }
  return problems;
}

/** The fields a person fills; every other named field in the form is a bot trap. */
const PERSON_FIELDS: readonly string[] = ['email', 'platform', 'updates_opt_out'];
/** Words browser autofill reads as a person's details (Safari's contact card, Chrome's address
 *  profiles): a trap named or labelled with one gets filled for a person, whose signup is dropped. */
const AUTOFILL_WORDS = ['company', 'organization', 'organisation', 'business', 'website', 'url', 'name'] as const;

/** Why a trap field in the form would be autofilled: its name, id or label text holds an autofill word. */
function trapAutofillProblems(html: string): string[] {
  const tags = startTags(html);
  const form = tags.find((tag) => tag.name === 'form');
  if (form === undefined) return ['the page has no form'];
  const formEnd = html.indexOf('</form>', form.end);
  const traps = tags.filter((tag) => tag.end > form.end && tag.end < formEnd && tag.attrs.has('name') && !PERSON_FIELDS.includes(tag.attrs.get('name') ?? ''));
  if (traps.length === 0) return ['the form has no trap field'];
  return traps.flatMap((trap) => {
    const id = trap.attrs.get('id');
    const label = tags.find((tag) => tag.name === 'label' && id !== undefined && tag.attrs.get('for') === id);
    const parts: Array<readonly [string, string]> = [['name', trap.attrs.get('name') ?? ''], ['id', id ?? '']];
    if (label !== undefined) parts.push(['label', pageText(html.slice(label.end, html.indexOf('</label>', label.end)))]);
    return parts.flatMap(([where, text]) =>
      AUTOFILL_WORDS.filter((word) => text.toLowerCase().includes(word)).map((word) => `the trap field's ${where} ${JSON.stringify(text)} holds "${word}", which autofill fills`),
    );
  });
}

/** The form contract (design-brief "Locked: the form contract"), as findings. */
function formContractProblems(html: string, action: string): string[] {
  const tags = startTags(html);
  const forms = tags.filter((tag) => tag.name === 'form');
  if (forms.length !== 1) return [`the page has ${forms.length} forms, not exactly one`];
  const form = forms[0];
  const problems: string[] = [];
  if (form.attrs.get('method')?.toLowerCase() !== 'post') problems.push('the form does not post');
  if (form.attrs.get('action') !== action) problems.push(`the form's action is ${JSON.stringify(form.attrs.get('action'))}, not the signup URL`);
  const enctype = form.attrs.get('enctype') ?? 'application/x-www-form-urlencoded';
  if (enctype !== 'application/x-www-form-urlencoded') problems.push(`the form's enctype is ${enctype}`);

  const formEnd = html.indexOf('</form>', form.end);
  const inForm = tags.filter((tag) => tag.end > form.end && tag.end < formEnd && tag.attrs.has('name'));
  const fields: FormFields = { tags, html, named: (name) => inForm.filter((tag) => tag.attrs.get('name') === name) };
  const names = [...new Set(inForm.map((tag) => tag.attrs.get('name') ?? ''))].sort((a, b) => a.localeCompare(b));
  const expected = [...PERSON_FIELDS, TRAP_FIELD].sort((a, b) => a.localeCompare(b));
  if (names.join(',') !== expected.join(',')) problems.push(`the form's fields are ${names.join(', ')}`);
  return [...problems, ...emailProblems(fields), ...platformProblems(fields), ...optOutProblems(fields), ...trapProblems(fields)];
}

// ── Building ────────────────────────────────────────────────────────────────────────────────

/** A repo holding a copy of this checkout's `deploy/site/`, with `edit` applied to one page. */
function fixtureRepo(edit?: { readonly file: string; readonly from: string; readonly to: string }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-beta-site-repo-'));
  fs.cpSync(SITE_DIR, path.join(dir, 'deploy', 'site'), { recursive: true });
  if (edit !== undefined) {
    const file = path.join(dir, 'deploy', 'site', edit.file);
    const source = fs.readFileSync(file, 'utf8');
    if (!source.includes(edit.from)) throw new Error(`fixture: ${edit.file} no longer contains ${JSON.stringify(edit.from)}`);
    fs.writeFileSync(file, source.replace(edit.from, edit.to));
  }
  return dir;
}

async function build(
  env: Record<string, string>,
  edit?: Parameters<typeof fixtureRepo>[0],
): Promise<{ readonly result: BuildSiteResult; readonly outDir: string; readonly cleanup: () => void }> {
  const repoRoot = fixtureRepo(edit);
  const outDir = path.join(repoRoot, 'out');
  const result = await buildSite({ repoRoot, env, outDir, runAssociationFiles: noAssociationFiles });
  return { result, outDir, cleanup: () => fs.rmSync(repoRoot, { recursive: true, force: true }) };
}

function filesUnder(dir: string, prefix = ''): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    return entry.isDirectory() ? filesUnder(path.join(dir, entry.name), rel) : [rel];
  });
}

async function builtSiteTests(): Promise<void> {
  section('Beta site: the built pages');

  const { result, outDir, cleanup } = await build(ENV);
  try {
    check('the site builds with the signup URL', result.ok, JSON.stringify(result));
    const built = (file: string): string => fs.readFileSync(path.join(outDir, file), 'utf8');

    eq('the built /beta keeps the form contract, posting to the configured signup URL', formContractProblems(built('beta.html'), SIGNUP_URL), []);
    check(
      '  red: the contract check sees a pre-ticked opt-out, a type="hidden" trap and a second form',
      [
        ['updates_opt_out is checked by default', built('beta.html').replace('name="updates_opt_out" value="1"', 'name="updates_opt_out" value="1" checked')],
        ['type="hidden"', built('beta.html').replace(`<input type="text" id="${TRAP_FIELD}"`, `<input type="hidden" id="${TRAP_FIELD}"`)],
        ['2 forms', built('beta.html').replace('</form>', '</form><form method="post" action="/x"></form>')],
      ].every(([needle, html]) => formContractProblems(html, SIGNUP_URL).some((problem) => problem.includes(needle))),
    );

    eq('the /beta trap field is named, id\'d and labelled with no word browser autofill fills', trapAutofillProblems(built('beta.html')), []);
    const trapLabel = /<label for="([^"]+)">[^<]*<\/label><input type="text" id="\1" name="\1"/.exec(built('beta.html'))?.[0] ?? '';
    check('setup: the built /beta carries the trap field as its label and input', trapLabel !== '', trapLabel);
    for (const [what, planted, word] of [
      ['the old company trap', '<label for="company">Company</label><input type="text" id="company" name="company"', 'company'],
      ['a label alone saying organization', `<label for="${TRAP_FIELD}">Your organization</label><input type="text" id="${TRAP_FIELD}" name="${TRAP_FIELD}"`, 'organization'],
      ['an id alone holding url', `<label for="site_url">Leave this empty</label><input type="text" id="site_url" name="${TRAP_FIELD}"`, 'url'],
    ] as const) {
      check(`  red: the autofill check catches ${what}`, trapAutofillProblems(built('beta.html').replace(trapLabel, planted)).some((problem) => problem.includes(`"${word}"`)));
    }

    for (const page of BETA_PAGES) check(`${page} is published and links /privacy`, built(page).includes('href="/privacy"'));
    check('the published /beta names the support address, rendered', built('beta.html').includes(`mailto:${ENV.WHIM_SUPPORT_EMAIL}`) && !built('beta.html').includes('{{'));

    const pages = filesUnder(outDir).filter((file) => file.endsWith('.html'));
    eq('every built page is either a legal page or a deploy-value page', [...pages].sort((a, b) => a.localeCompare(b)), [...LEGAL_PAGES, ...DEPLOY_VALUE_PAGES].sort((a, b) => a.localeCompare(b)));
    eq('no page in the site has a script element, an inline event handler or a javascript: URL', pages.flatMap((file) => scriptProblems(file, built(file))), []);
    eq(
      '  red: a planted onclick, a <script> and a javascript: link are each caught',
      scriptProblems('planted.html', '<p><button onClick="go()">x</button><SCRIPT src="/a.js"></SCRIPT><a href=" JavaScript:go()">y</a></p>'),
      ['planted.html has an inline onclick handler on <button>', 'planted.html has a <script> element', 'planted.html has a javascript: URL in href'],
    );

    const assets = filesUnder(path.join(SITE_DIR, 'assets'));
    check('the checkout has assets to publish', assets.length > 0);
    eq(
      'every file under deploy/site/assets/ is published byte for byte under assets/',
      assets.filter((file) => {
        const published = path.join(outDir, 'assets', file);
        return !fs.existsSync(published) || !fs.readFileSync(path.join(SITE_DIR, 'assets', file)).equals(fs.readFileSync(published));
      }),
      [],
    );
    const referenced = [...new Set(BETA_PAGES.flatMap((page) => [...built(page).matchAll(/url\("(\/assets\/[^"]+)"\)/g)].map((m) => m[1])))];
    check('the beta pages reference fonts under /assets/', referenced.length > 0);
    eq('every /assets/ file a beta page references is in the output', referenced.filter((url) => !fs.existsSync(path.join(outDir, url))), []);
  } finally {
    cleanup();
  }

  section('Beta site: WHIM_BETA_SIGNUP_URL is a required, checked deploy value');

  for (const [what, env, needle] of [
    ['a missing signup URL', { WHIM_SUPPORT_EMAIL: ENV.WHIM_SUPPORT_EMAIL }, 'WHIM_BETA_SIGNUP_URL is required'],
    ['a plain-http signup URL', { ...ENV, WHIM_BETA_SIGNUP_URL: 'http://api.pages.example.test/beta/signup' }, 'WHIM_BETA_SIGNUP_URL must be'],
    ['a signup URL on another path', { ...ENV, WHIM_BETA_SIGNUP_URL: 'https://api.pages.example.test/v1/signup' }, 'WHIM_BETA_SIGNUP_URL must be'],
  ] as const) {
    const failed = await build(env);
    try {
      check(`${what} fails the build, naming it, and publishes nothing`, !failed.result.ok && failed.result.reason.includes(needle) && !fs.existsSync(failed.outDir), JSON.stringify(failed.result));
    } finally {
      failed.cleanup();
    }
  }
}

async function noticeTests(): Promise<void> {
  section('Beta site: the consent wording must be the registered current notice');

  const source = fs.readFileSync(path.join(SITE_DIR, SIGNUP_PAGE), 'utf8');
  eq('the checked-in /beta carries the current notice', signupNoticeFindings(source), []);

  for (const [what, edit] of [
    ['a reworded consent line', { file: SIGNUP_PAGE, from: 'we may occasionally email you about Whim', to: 'we may email you about Whim' }],
    ['a reworded opt-out label', { file: SIGNUP_PAGE, from: '<span>Don\'t email me about Whim updates</span>', to: '<span>No Whim updates, please</span>' }],
  ] as const) {
    const failed = await build(ENV, edit);
    try {
      check(
        `${what} fails the build, naming the unregistered wording, and publishes nothing`,
        !failed.result.ok && failed.result.reason.includes('not registered') && failed.result.reason.includes(edit.to.replace(/<\/?span>/g, '')) && !fs.existsSync(failed.outDir),
        JSON.stringify(failed.result),
      );
    } finally {
      failed.cleanup();
    }
  }

  const reflowed = await build(ENV, { file: SIGNUP_PAGE, from: 'Unless you tick the box above,', to: 'Unless you tick\n        the box above,' });
  try {
    check('reflowing the same words across lines still builds', reflowed.result.ok, JSON.stringify(reflowed.result));
  } finally {
    reflowed.cleanup();
  }
  const otherSupport = await build({ ...ENV, WHIM_SUPPORT_EMAIL: 'help@elsewhere.example.test' });
  try {
    check('a different support address (a deploy value inside the notice) still builds: the notice is read unrendered', otherSupport.result.ok, JSON.stringify(otherSupport.result));
  } finally {
    otherSupport.cleanup();
  }

  const current = NOTICES[CURRENT_NOTICE_ID];
  const older = { 'beta-0': current, [CURRENT_NOTICE_ID]: noticeFingerprint('a later wording') };
  const stale = signupNoticeFindings(source, older, CURRENT_NOTICE_ID);
  check('wording registered under an older id than the one signups record fails, naming both', stale.length === 1 && stale[0].includes('beta-0') && stale[0].includes(CURRENT_NOTICE_ID), stale.join(' / '));
  const bare = signupNoticeFindings(source.replaceAll(' data-notice', ''));
  check('a page with no data-notice element fails', bare.length === 1 && bare[0].includes('no element carries data-notice'), bare.join(' / '));
}

function privacyTests(): void {
  section('Beta site: the privacy policy covers the waitlist, and the app consent stays');

  const identity: unknown = JSON.parse(fs.readFileSync(path.join(ROOT, LEGAL_IDENTITY_PATH), 'utf8'));
  const sources = Object.fromEntries(LEGAL_PAGES.map((page) => [page, fs.readFileSync(path.join(SITE_DIR, page), 'utf8')])) as Parameters<typeof renderLegalSite>[0]['sources'];
  const { pages, findings } = renderLegalSite({ sources, identity });
  eq('the legal-pages check passes with the waitlist in the manifest', findings, []);
  eq('the current manifest publishes the store\'s waitlist retention', keepLimit(MANIFESTS[latestVersion()], 'waitlist')?.days, WAITLIST_RETENTION_DAYS);
  for (const page of ['privacy.html', 'fr/privacy.html'] as const) {
    eq(`${page} states the store's ${WAITLIST_RETENTION_DAYS}-day waitlist retention`, statedKeepPeriods(pages[page]).get('waitlist'), [WAITLIST_RETENTION_DAYS]);
  }
  const shorter = renderLegalSite({ sources: { ...sources, 'privacy.html': sources['privacy.html'].replace('Deleted 730 days after', 'Deleted 365 days after') }, identity });
  check('  red: a policy stating another waitlist period fails the legal-pages check', shorter.findings.some((finding) => finding.includes('waitlist')), shorter.findings.join(' / '));

  const releasedDir = path.join(ROOT, RELEASED_SNAPSHOT_DIR);
  const released = fs.readdirSync(releasedDir).map((file) => Number(/^v(\d+)\.json$/.exec(file)?.[1])).filter((v) => !Number.isNaN(v));
  const newestReleased = Math.max(...released);
  const snapshot = JSON.parse(fs.readFileSync(path.join(releasedDir, `v${newestReleased}.json`), 'utf8')) as DisclosureManifest;
  eq('the app consent version is still the newest released one', [AI_CONSENT_VERSION, latestVersion()], [newestReleased, newestReleased]);
  eq('adding the waitlist widens nothing against that released snapshot', diffManifests(snapshot, MANIFESTS[newestReleased]), []);
  check('  ... although the manifest now lists the waitlist', MANIFESTS[newestReleased].categories.some((category) => category.id === 'waitlist') && !snapshot.categories.some((category) => category.id === 'waitlist'));
}

export async function runBetaSiteTests(): Promise<void> {
  await builtSiteTests();
  await noticeTests();
  privacyTests();
}
