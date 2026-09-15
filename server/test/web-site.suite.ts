/**
 * Whim pages host site acceptance (public-generation-server chain-15, design D21–D24).
 * Scaffolded here by chain-15 itself (task 16.4), invoked from `runDeployConfigTests()`.
 *
 * Covers specs/server-deployment "The privacy policy and support pages match what the app
 * discloses" (the D23 parity tripwire and retention lockstep) and "Association files come only
 * from the release tooling" (the `.well-known` present/absent build states) at the `build.ts`
 * layer. The Caddy route table itself is chain-12's tripwire.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { caught, check, eq, section } from './harness';
import {
  associationState,
  buildSite,
  renderPage,
  RenderPageError,
  type AssociationFilesRunner,
} from '../src/site/build';
import { COPY } from '../../src/host/launcher/copy';
import { loadServerConfig } from '../src/config';

const REPO_ROOT = path.resolve(process.cwd());
const SITE_DIR = path.join(REPO_ROOT, 'deploy', 'site');

function readPage(name: string): string {
  return fs.readFileSync(path.join(SITE_DIR, name), 'utf8');
}

// `Record<string, string>` (rather than the closed `PlaceholderValues` type) so these fixtures
// also satisfy `buildSite`'s `env: NodeJS.ProcessEnv` parameter without a cast.
const FIXTURE_VALUES: Record<string, string> = {
  WHIM_SUPPORT_EMAIL: 'support@anycognition.ca',
  WHIM_ENGINEER_MODEL: 'anthropic/claude-sonnet',
  WHIM_REWRITE_MODEL: 'anthropic/claude-haiku',
};

const FIXTURE_VALUES_WITH_STORES: Record<string, string> = {
  ...FIXTURE_VALUES,
  WHIM_APP_STORE_URL: 'https://apps.apple.com/app/whim/id123456789',
  WHIM_PLAY_STORE_URL: 'https://play.google.com/store/apps/details?id=com.anycognition.whim',
};

/** Strips HTML tags with a small state machine rather than a `<[^>]*>` regex (sonarjs flags
 *  that pattern's backtracking on adversarial input). */
function stripTags(html: string): string {
  let out = '';
  let inTag = false;
  for (const ch of html) {
    if (ch === '<') {
      inTag = true;
      out += ' ';
    } else if (ch === '>') {
      inTag = false;
    } else if (!inTag) {
      out += ch;
    }
  }
  return out;
}

/** Tags stripped, entities decoded, whitespace collapsed, curly and straight apostrophes
 *  compared as the same character (design D23's parity rule normalization). */
function normalizeForParity(html: string): string {
  return stripTags(html)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** The D23 allowlist — screen chrome, not disclosure. Everything else starting with `consent`
 *  must appear verbatim in the rendered policy, denying by default. */
const CONSENT_ALLOWLIST: ReadonlySet<string> = new Set([
  'consentTitle',
  'consentOutdatedLine',
  'consentAgree',
  'consentDecline',
  'consentReviewKeepOn',
  'consentReviewTurnOff',
  'consentReviewTurnOn',
]);

/** The tripwire itself: every `copy` key starting with `consent`, except `allowlist`, must
 *  appear verbatim (after normalization) in `normalizedPolicy`. Returns the missing key names. */
function missingConsentDisclosures(
  copy: Readonly<Record<string, string>>,
  allowlist: ReadonlySet<string>,
  normalizedPolicy: string,
): string[] {
  const missing: string[] = [];
  for (const [key, value] of Object.entries(copy)) {
    if (!key.startsWith('consent') || allowlist.has(key)) continue;
    if (!normalizedPolicy.includes(normalizeForParity(value))) missing.push(key);
  }
  return missing;
}

function extractDays(pattern: RegExp, text: string): number | undefined {
  const match = pattern.exec(text);
  return match ? Number(match[1]) : undefined;
}

export async function runWebSiteTests(): Promise<void> {
  section('Web site: parity and retention');

  const renderedPolicy = renderPage(readPage('privacy.html'), FIXTURE_VALUES);
  const normalizedPolicy = normalizeForParity(renderedPolicy);

  const missing = missingConsentDisclosures(COPY, CONSENT_ALLOWLIST, normalizedPolicy);
  eq('privacy.html quotes every non-allowlisted consent key verbatim', missing, []);

  const config = loadServerConfig({});
  eq(
    'privacy.html states the report retention as loadServerConfig({})\'s default',
    extractDays(/deleted after (\d+) days/, normalizedPolicy),
    config.reportRetentionDays,
  );
  eq(
    'privacy.html states the ledger retention as loadServerConfig({})\'s default',
    extractDays(/kept for (\d+) days/, normalizedPolicy),
    config.ledgerRetentionDays,
  );

  section('Web site: discriminating red-checks');

  {
    // A policy missing consentWhatSentDevice's text must fail.
    const policyWithoutDeviceLine = normalizedPolicy.replace(
      normalizeForParity(COPY.consentWhatSentDevice),
      '',
    );
    const redMissing = missingConsentDisclosures(COPY, CONSENT_ALLOWLIST, policyWithoutDeviceLine);
    eq('dropping the anonymous-ID line fails naming consentWhatSentDevice', redMissing, ['consentWhatSentDevice']);
  }

  {
    // A COPY fixture with an extra un-quoted consent key must fail against the real (denies by
    // default) rule — not against a variant that only checks a hand-kept list of known keys.
    const copyWithNewKey = { ...COPY, consentWhatSentReports: 'A new disclosure line, never quoted anywhere.' };
    const redMissing = missingConsentDisclosures(copyWithNewKey, CONSENT_ALLOWLIST, normalizedPolicy);
    eq('an unquoted new consent key fails naming itself', redMissing, ['consentWhatSentReports']);

    // The weaker variant a hand-kept key list would produce: it never even looks at the new key,
    // so it reports nothing missing — which is exactly the failure mode the real rule avoids.
    const HAND_KEPT_KEYS = ['consentLead', 'consentWhatSentTitle', 'consentWhatSentRequest'];
    const handKeptMissing = HAND_KEPT_KEYS.filter(
      (key) => !normalizedPolicy.includes(normalizeForParity((copyWithNewKey as Record<string, string>)[key]!)),
    );
    check(
      'a hand-kept key list (the rejected weaker variant) misses the new key entirely',
      handKeptMissing.length === 0,
    );
  }

  {
    // A policy saying 30 days must fail the retention lockstep.
    const policyWith30Days = normalizedPolicy.replace(/deleted after 90 days/, 'deleted after 30 days');
    eq(
      'a policy claiming 30-day report retention no longer matches the 90-day default',
      extractDays(/deleted after (\d+) days/, policyWith30Days) === config.reportRetentionDays,
      false,
    );
  }

  section('Web site: renderPage placeholder rules');

  eq('renderPage substitutes and escapes required values', renderPage('{{WHIM_SUPPORT_EMAIL}}', FIXTURE_VALUES), 'support@anycognition.ca');

  {
    const err = await caught(() => {
      renderPage('{{WHIM_NOT_A_REAL_PLACEHOLDER}}', FIXTURE_VALUES);
    });
    check(
      'an unknown placeholder fails naming itself',
      err instanceof RenderPageError && err.placeholder === 'WHIM_NOT_A_REAL_PLACEHOLDER',
    );
  }

  {
    const err = await caught(() => {
      renderPage('{{WHIM_SUPPORT_EMAIL}}', {});
    });
    check(
      'a missing required value fails naming itself',
      err instanceof RenderPageError && err.placeholder === 'WHIM_SUPPORT_EMAIL',
    );
  }

  {
    const err = await caught(() => {
      renderPage('{{WHIM_SUPPORT_EMAIL}}', { ...FIXTURE_VALUES, WHIM_SUPPORT_EMAIL: 'not-an-email' });
    });
    check(
      'a malformed required value fails naming itself',
      err instanceof RenderPageError && err.placeholder === 'WHIM_SUPPORT_EMAIL',
    );
  }

  {
    const err = await caught(() => {
      renderPage('{{WHIM_SUPPORT_EMAIL', FIXTURE_VALUES);
    });
    check('a leftover {{ marker fails', err instanceof RenderPageError && err.placeholder === '{{');
  }

  eq(
    'renderPage HTML-escapes a value containing <',
    renderPage('{{WHIM_ENGINEER_MODEL}}', { ...FIXTURE_VALUES, WHIM_ENGINEER_MODEL: '<script>alert(1)</script>' }),
    '&lt;script&gt;alert(1)&lt;/script&gt;',
  );

  section('Web site: app-link store links');

  const appLinkSource = readPage('app-link.html');
  const appLinkWithoutStores = renderPage(appLinkSource, FIXTURE_VALUES);
  check('with no store URLs, app-link.html has no store links', !appLinkWithoutStores.includes('class="stores"'));

  const appLinkWithStores = renderPage(appLinkSource, FIXTURE_VALUES_WITH_STORES);
  check(
    'with both store URLs, app-link.html links both stores',
    appLinkWithStores.includes(FIXTURE_VALUES_WITH_STORES.WHIM_APP_STORE_URL) &&
      appLinkWithStores.includes(FIXTURE_VALUES_WITH_STORES.WHIM_PLAY_STORE_URL),
  );

  section('Web site: no script in any rendered page');

  for (const file of ['privacy.html', 'support.html', 'app-link.html', 'not-found.html']) {
    const rendered = renderPage(readPage(file), FIXTURE_VALUES_WITH_STORES).toLowerCase();
    check(`${file} contains no <script`, !rendered.includes('<script'));
  }

  section('Web site: associationState');

  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-assoc-neither-'));
    try {
      eq('neither fingerprint file: absent, naming the upload path', associationState(dir), {
        kind: 'absent',
        missingPath: 'release/android-upload-cert.sha256',
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-assoc-upload-only-'));
    try {
      fs.mkdirSync(path.join(dir, 'release'));
      fs.writeFileSync(path.join(dir, 'release', 'android-upload-cert.sha256'), 'AA:BB\n');
      eq('upload fingerprint only: absent, naming the play-signing path', associationState(dir), {
        kind: 'absent',
        missingPath: 'release/android-play-signing-cert.sha256',
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-assoc-both-'));
    try {
      fs.mkdirSync(path.join(dir, 'release'));
      fs.writeFileSync(path.join(dir, 'release', 'android-upload-cert.sha256'), 'AA:BB\n');
      fs.writeFileSync(path.join(dir, 'release', 'android-play-signing-cert.sha256'), 'CC:DD\n');
      eq('both fingerprints: present', associationState(dir), { kind: 'present' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  section('Web site: today\'s real checkout');

  eq(
    'the real repo has neither fingerprint committed today, so the build reports PENDING',
    associationState(REPO_ROOT),
    { kind: 'absent', missingPath: 'release/android-upload-cert.sha256' },
  );

  section('Web site: buildSite');

  function fakeRepoRoot(withFingerprints: boolean): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-buildsite-repo-'));
    fs.mkdirSync(path.join(dir, 'deploy', 'site'), { recursive: true });
    for (const file of ['privacy.html', 'support.html', 'app-link.html', 'not-found.html']) {
      fs.copyFileSync(path.join(SITE_DIR, file), path.join(dir, 'deploy', 'site', file));
    }
    if (withFingerprints) {
      fs.mkdirSync(path.join(dir, 'release'));
      fs.writeFileSync(path.join(dir, 'release', 'android-upload-cert.sha256'), 'AA:BB\n');
      fs.writeFileSync(path.join(dir, 'release', 'android-play-signing-cert.sha256'), 'CC:DD\n');
    }
    return dir;
  }

  const neverCalledRunner: AssociationFilesRunner = async () => {
    throw new Error('runAssociationFiles should not be called when a fingerprint is missing');
  };

  {
    const repoRoot = fakeRepoRoot(false);
    const outDir = path.join(os.tmpdir(), `whim-buildsite-out-absent-${process.pid}`);
    try {
      const result = await buildSite({ repoRoot, env: FIXTURE_VALUES, outDir, runAssociationFiles: neverCalledRunner });
      eq('no fingerprints: build succeeds reporting absent', result, {
        ok: true,
        associationState: 'absent',
        missingPath: 'release/android-upload-cert.sha256',
      });
      check('no fingerprints: outDir has no .well-known', !fs.existsSync(path.join(outDir, '.well-known')));
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }

  {
    const repoRoot = fakeRepoRoot(true);
    const outDir = path.join(os.tmpdir(), `whim-buildsite-out-present-${process.pid}`);
    const aasaBytes = Buffer.from('{"applinks":{"details":[]}}');
    const assetLinksBytes = Buffer.from('[{"relation":[]}]');
    const successRunner: AssociationFilesRunner = async (stageDir) => {
      fs.writeFileSync(path.join(stageDir, 'apple-app-site-association'), aasaBytes);
      fs.writeFileSync(path.join(stageDir, 'assetlinks.json'), assetLinksBytes);
      return { exitCode: 0 };
    };
    try {
      const result = await buildSite({ repoRoot, env: FIXTURE_VALUES, outDir, runAssociationFiles: successRunner });
      eq('both fingerprints + a successful runner: build succeeds reporting present', result, {
        ok: true,
        associationState: 'present',
      });
      check(
        'the AASA file is copied byte for byte',
        fs.readFileSync(path.join(outDir, '.well-known', 'apple-app-site-association')).equals(aasaBytes),
      );
      check(
        'the assetlinks file is copied byte for byte',
        fs.readFileSync(path.join(outDir, '.well-known', 'assetlinks.json')).equals(assetLinksBytes),
      );
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }

  {
    const repoRoot = fakeRepoRoot(true);
    const outDir = path.join(os.tmpdir(), `whim-buildsite-out-failing-${process.pid}`);
    const failingRunner: AssociationFilesRunner = async () => ({ exitCode: 1 });
    try {
      const result = await buildSite({ repoRoot, env: FIXTURE_VALUES, outDir, runAssociationFiles: failingRunner });
      check('a non-zero runner exit fails the build', !result.ok);
      check('a failed build leaves no outDir', !fs.existsSync(outDir));
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }

  {
    const repoRoot = fakeRepoRoot(true);
    const outDir = path.join(os.tmpdir(), `whim-buildsite-out-wrongfiles-${process.pid}`);
    const wrongFilesRunner: AssociationFilesRunner = async (stageDir) => {
      fs.writeFileSync(path.join(stageDir, 'apple-app-site-association'), 'x');
      fs.writeFileSync(path.join(stageDir, 'extra-file.txt'), 'y');
      return { exitCode: 0 };
    };
    try {
      const result = await buildSite({ repoRoot, env: FIXTURE_VALUES, outDir, runAssociationFiles: wrongFilesRunner });
      check('an unexpected file set fails the build', !result.ok);
      check('a failed build (wrong file set) leaves no outDir', !fs.existsSync(outDir));
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }

  {
    const repoRoot = fakeRepoRoot(false);
    const outDir = path.join(os.tmpdir(), `whim-buildsite-out-missing-env-${process.pid}`);
    try {
      const result = await buildSite({ repoRoot, env: {}, outDir, runAssociationFiles: neverCalledRunner });
      check('a missing required env value fails the build', !result.ok);
      check('a failed build (missing env) leaves no outDir', !fs.existsSync(outDir));
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }
}
