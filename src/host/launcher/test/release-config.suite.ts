/**
 * release-config Node suite (task 1.1/1.5) — locks release-config spec "One domain constant
 * derives every Whim URL" and "The consent version is declared with the release configuration":
 * `RELEASE` derives every URL from `WHIM_DOMAIN`, and no launcher source file other than
 * `release-config.ts` (and this suite itself, whose job is to name the value in order to scan
 * for it — mirrors `theme.suite.ts`'s own self-exclusion) may contain the domain literal or a
 * `whim.` URL literal.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Harness } from './harness';
import { AI_CONSENT_VERSION, RELEASE, WHIM_DOMAIN } from '../release-config';

const LAUNCHER_ROOT = path.join(process.cwd(), 'src/host/launcher');
const RELEASE_CONFIG_TS = path.join(LAUNCHER_ROOT, 'release-config.ts');
const SELF = path.join(LAUNCHER_ROOT, 'test/release-config.suite.ts');

/** Every `.ts`/`.tsx` file under the launcher, recursively (includes `test/`, since a hardcoded
 *  domain literal in a test fixture would be exactly as drift-prone as one in production code). */
function everyLauncherSourceFile(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...everyLauncherSourceFile(full));
    else if (/\.tsx?$/.test(entry.name)) files.push(full);
  }
  return files;
}

// Every derived URL (serverUrl, webHost, webOrigin, privacyPolicyUrl, supportUrl, appLinkBase)
// contains WHIM_DOMAIN as a substring by construction, so one case-insensitive search for the
// domain value catches the literal domain AND any hardcoded derived URL (including a
// differently-cased host, e.g. "WHIM.EXAMPLE.COM") in one pass. It deliberately does NOT match
// the unrelated `whim.<name>:v1` KV-key convention used throughout this codebase (`theme.ts`'s
// THEME_KEY, `server-address.ts`'s SERVER_URL_KEY, `ai-consent.ts`'s CONSENT_KEY, ...), since
// none of those contain the domain text.
const DOMAIN_LITERAL_PATTERN = new RegExp(WHIM_DOMAIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

export async function runReleaseConfigTests(h: Harness): Promise<void> {
  await h.test('release-config: the domain constant is no longer the reserved placeholder', () => {
    h.ok(WHIM_DOMAIN !== 'example.com', 'WHIM_DOMAIN must be the chosen production domain, not the IANA-reserved placeholder (platform-release-readiness task 12.5)');
    h.ok(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(WHIM_DOMAIN), `WHIM_DOMAIN must look like a real domain, got "${WHIM_DOMAIN}"`);
  });

  await h.test('release-config: RELEASE derives every URL from WHIM_DOMAIN', () => {
    h.eq(RELEASE.serverUrl, `https://api.whim.${WHIM_DOMAIN}`, 'serverUrl derives from WHIM_DOMAIN');
    h.eq(RELEASE.webHost, `whim.${WHIM_DOMAIN}`, 'webHost derives from WHIM_DOMAIN');
    h.eq(RELEASE.webOrigin, `https://whim.${WHIM_DOMAIN}`, 'webOrigin derives from WHIM_DOMAIN');
    h.eq(RELEASE.privacyPolicyUrl, `${RELEASE.webOrigin}/privacy`, 'privacyPolicyUrl derives from webOrigin');
    h.eq(RELEASE.supportUrl, `${RELEASE.webOrigin}/support`, 'supportUrl derives from webOrigin');
    h.eq(RELEASE.appLinkBase, `${RELEASE.webOrigin}/a/`, 'appLinkBase derives from webOrigin');
    h.ok(Object.isFrozen(RELEASE), 'RELEASE is frozen');
  });

  await h.test('release-config: AI_CONSENT_VERSION is a positive integer, currently 1', () => {
    h.ok(Number.isInteger(AI_CONSENT_VERSION) && AI_CONSENT_VERSION > 0, 'AI_CONSENT_VERSION must be a positive integer');
    h.eq(AI_CONSENT_VERSION, 1, 'the first shipped consent version is 1');
  });

  await h.test('release-config: no launcher source file other than release-config.ts names the domain or a whim. URL', () => {
    const scanned = everyLauncherSourceFile(LAUNCHER_ROOT);
    // Non-vacuity: the walk itself must actually be walking the launcher, not silently returning
    // an empty or truncated list.
    h.ok(scanned.length > 10, `release-config domain scan walked only ${scanned.length} file(s) — the walk is misconfigured`);
    h.ok(scanned.includes(RELEASE_CONFIG_TS), 'the scan must include release-config.ts itself (to be skipped by path, not silently absent)');

    for (const file of scanned) {
      if (file === RELEASE_CONFIG_TS || file === SELF) continue;
      const text = fs.readFileSync(file, 'utf8');
      const rel = path.relative(process.cwd(), file);
      h.ok(!DOMAIN_LITERAL_PATTERN.test(text), `${rel} contains the release domain "${WHIM_DOMAIN}" (or a URL derived from it) — derive it from release-config.ts's RELEASE instead`);
    }
  });

  // Non-vacuity: the scan pattern actually fires on the shapes it must catch, and does not fire
  // on the unrelated `whim.<name>:v1` KV-key convention.
  await h.test('release-config: the domain scan pattern fires on the shapes it must catch, and only those', () => {
    h.ok(DOMAIN_LITERAL_PATTERN.test(`const x = "${WHIM_DOMAIN}";`), 'domain literal scan matches its own value');
    h.ok(DOMAIN_LITERAL_PATTERN.test(`https://whim.${WHIM_DOMAIN}/a/x`), 'domain scan matches a hardcoded derived URL');
    h.ok(DOMAIN_LITERAL_PATTERN.test(`https://WHIM.${WHIM_DOMAIN.toUpperCase()}/support`), 'domain scan is case-insensitive');
    h.ok(!DOMAIN_LITERAL_PATTERN.test("const CONSENT_KEY = 'whim.ai-consent:v1';"), 'domain scan does not fire on the unrelated whim.<name>:v1 KV-key convention');
  });
}
