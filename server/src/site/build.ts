/**
 * server/src/site/build.ts — the Whim pages host site build (public-generation-server chain-15,
 * design D21–D24; specs/server-deployment "The privacy policy and support pages match what the
 * app discloses", "Association files come only from the release tooling"). The legal pages come
 * from `legal-pages.ts` (legal-surface-v2 D7), whose findings refuse the build.
 *
 * Pure/testable pieces only. The real process entry (argv parsing, the real association-files
 * runner over `scripts/release/run.mjs`, stdout, exit codes) is `server/site.mjs`, which bundles
 * this module the way `server/dev.mjs`/`server/admin.mjs` bundle theirs — never imported by a
 * suite, so this module stays free of filesystem/process side effects beyond what `buildSite`
 * itself deliberately performs (temp-dir render + atomic move into `outDir`).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LEGAL_IDENTITY_PATH, LEGAL_PAGES, renderLegalSite, type LegalPage } from './legal-pages';
import { looksLikeEmail, RenderPageError, renderTemplate, type Resolver } from './template';

export { RenderPageError } from './template';

/** The closed placeholder set (design D23's table). Nothing else may appear as `{{NAME}}`. */
export type PlaceholderName =
  | 'WHIM_SUPPORT_EMAIL'
  | 'WHIM_APP_STORE_URL'
  | 'WHIM_PLAY_STORE_URL';

export type PlaceholderValues = { readonly [K in PlaceholderName]?: string };

const REQUIRED_PLACEHOLDERS: ReadonlySet<PlaceholderName> = new Set([
  'WHIM_SUPPORT_EMAIL',
]);
const ALL_PLACEHOLDERS: ReadonlySet<string> = new Set<PlaceholderName>([
  'WHIM_SUPPORT_EMAIL',
  'WHIM_APP_STORE_URL',
  'WHIM_PLAY_STORE_URL',
]);

const STORE_URL_RULES: { readonly [K in 'WHIM_APP_STORE_URL' | 'WHIM_PLAY_STORE_URL']: RegExp } = {
  WHIM_APP_STORE_URL: /^https:\/\/apps\.apple\.com\//,
  WHIM_PLAY_STORE_URL: /^https:\/\/play\.google\.com\//,
};

function placeholderValueProblem(name: PlaceholderName, value: string): string | undefined {
  if (name === 'WHIM_SUPPORT_EMAIL' && !looksLikeEmail(value)) {
    return `${name} must be a valid email address, got ${JSON.stringify(value)}.`;
  }
  if ((name === 'WHIM_APP_STORE_URL' || name === 'WHIM_PLAY_STORE_URL') && !STORE_URL_RULES[name].test(value)) {
    return `${name} must be an https URL on ${name === 'WHIM_APP_STORE_URL' ? 'apps.apple.com' : 'play.google.com'}, got ${JSON.stringify(value)}.`;
  }
  return undefined;
}

function deployValueResolver(values: PlaceholderValues): Resolver {
  return (name) => {
    if (!ALL_PLACEHOLDERS.has(name)) return undefined;
    const placeholder = name as PlaceholderName;
    const value = values[placeholder];
    return {
      value,
      missing: REQUIRED_PLACEHOLDERS.has(placeholder) ? `${placeholder} is required and was not provided.` : undefined,
      invalid: value ? placeholderValueProblem(placeholder, value) : undefined,
    };
  };
}

/**
 * Renders one non-legal page source against a set of deploy-time values (`template.ts` has the
 * syntax). `<!--IF:NAME-->...<!--ENDIF-->` blocks are kept only when `values[NAME]` is a non-empty
 * string (design D23's "store-links block dropped when both store URLs are unset" — each store gets
 * its own single-name block). Every `{{NAME}}` elsewhere is HTML-escaped and substituted; an
 * unknown NAME, a missing/malformed required value, or a leftover `{{` throws `RenderPageError`
 * naming the first offender.
 */
export function renderPage(source: string, values: PlaceholderValues): string {
  const problems: RenderPageError[] = [];
  const rendered = renderTemplate(source, deployValueResolver(values), problems);
  const [first] = problems;
  if (first !== undefined) throw first;
  return rendered;
}

const UPLOAD_FINGERPRINT_RELATIVE_PATH = 'release/android-upload-cert.sha256';
const PLAY_SIGNING_FINGERPRINT_RELATIVE_PATH = 'release/android-play-signing-cert.sha256';

export type AssociationState =
  | { readonly kind: 'present' }
  | { readonly kind: 'absent'; readonly missingPath: string };

/** Both fingerprint files must be committed before the site ships association files (design
 *  D22). Checks the upload fingerprint first — it is always committed first in the release
 *  sequence — so "the first missing fingerprint path" is deterministic. */
export function associationState(repoRoot: string): AssociationState {
  if (!fs.existsSync(path.join(repoRoot, UPLOAD_FINGERPRINT_RELATIVE_PATH))) {
    return { kind: 'absent', missingPath: UPLOAD_FINGERPRINT_RELATIVE_PATH };
  }
  if (!fs.existsSync(path.join(repoRoot, PLAY_SIGNING_FINGERPRINT_RELATIVE_PATH))) {
    return { kind: 'absent', missingPath: PLAY_SIGNING_FINGERPRINT_RELATIVE_PATH };
  }
  return { kind: 'present' };
}

const ASSOCIATION_FILE_NAMES = ['apple-app-site-association', 'assetlinks.json'] as const;

/** Wraps `node scripts/release/run.mjs association-files --out <stageDir>` (injected so a test
 *  never spawns the real release CLI). `stageDir` already exists when called. */
export type AssociationFilesRunner = (stageDir: string) => Promise<{ readonly exitCode: number }>;

export interface BuildSiteOptions {
  readonly repoRoot: string;
  readonly env: NodeJS.ProcessEnv;
  readonly outDir: string;
  readonly runAssociationFiles: AssociationFilesRunner;
}

export type BuildSiteResult =
  | { readonly ok: true; readonly associationState: 'present' }
  | { readonly ok: true; readonly associationState: 'absent'; readonly missingPath: string }
  | { readonly ok: false; readonly reason: string };

/** The pages rendered from deploy values alone; the legal pages come from `renderLegalSite`. */
const DEPLOY_VALUE_PAGES = ['support.html', 'app-link.html', 'not-found.html'] as const;

function siteSource(repoRoot: string, file: string): string {
  return fs.readFileSync(path.join(repoRoot, 'deploy', 'site', file), 'utf8');
}

/** The legal-pages deploy check (legal-surface-v2 D7): the rendered pages, or why none may ship. */
function renderLegalPages(repoRoot: string): { readonly pages: Readonly<Record<LegalPage, string>> } | { readonly reason: string } {
  let identity: unknown;
  try {
    identity = JSON.parse(fs.readFileSync(path.join(repoRoot, LEGAL_IDENTITY_PATH), 'utf8'));
  } catch (e) {
    return { reason: `${LEGAL_IDENTITY_PATH} can't be read as JSON: ${(e as Error).message}` };
  }
  const sources = Object.fromEntries(LEGAL_PAGES.map((page) => [page, siteSource(repoRoot, page)])) as Record<LegalPage, string>;
  const { pages, findings } = renderLegalSite({ sources, identity });
  if (findings.length > 0) {
    const list = findings.map((finding) => `  - ${finding}`).join('\n');
    return { reason: `the legal pages can't be published:\n${list}` };
  }
  return { pages };
}

function writePage(dir: string, file: string, html: string): void {
  const target = path.join(dir, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, html, 'utf8');
}

/** Renders the deploy-value pages into `dir`; the first render error's message, if any. */
function writeDeployValuePages(dir: string, repoRoot: string, values: PlaceholderValues): string | undefined {
  for (const file of DEPLOY_VALUE_PAGES) {
    let rendered: string;
    try {
      rendered = renderPage(siteSource(repoRoot, file), values);
    } catch (e) {
      if (e instanceof RenderPageError) return e.message;
      throw e;
    }
    writePage(dir, file, rendered);
  }
  return undefined;
}

/**
 * Renders every page into a temp directory — the legal pages through the legal-pages deploy check,
 * which refuses the whole build on any finding — adds `.well-known/` association files when
 * `associationState(repoRoot)` is `present` (via the injected runner, copying exactly the two
 * `handoff/release-cli.md` output files byte for byte), and moves the temp directory to `outDir`
 * only on success. Never touches `outDir` on failure. Prints nothing and never calls
 * `process.exit` — `server/site.mjs` owns stdout and the exit code.
 */
export async function buildSite(options: BuildSiteOptions): Promise<BuildSiteResult> {
  const { repoRoot, env, outDir, runAssociationFiles } = options;
  const values: PlaceholderValues = {
    WHIM_SUPPORT_EMAIL: env.WHIM_SUPPORT_EMAIL,
    WHIM_APP_STORE_URL: env.WHIM_APP_STORE_URL,
    WHIM_PLAY_STORE_URL: env.WHIM_PLAY_STORE_URL,
  };

  const legal = renderLegalPages(repoRoot);
  if ('reason' in legal) return { ok: false, reason: legal.reason };

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-site-build-'));
  try {
    for (const page of LEGAL_PAGES) writePage(tempDir, page, legal.pages[page]);
    const renderError = writeDeployValuePages(tempDir, repoRoot, values);
    if (renderError !== undefined) return { ok: false, reason: renderError };

    const state = associationState(repoRoot);
    if (state.kind === 'present') {
      const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-site-assoc-'));
      try {
        const result = await runAssociationFiles(stageDir);
        if (result.exitCode !== 0) {
          return { ok: false, reason: `association-files exited ${result.exitCode}` };
        }
        const producedFiles = fs.readdirSync(stageDir).sort((a, b) => a.localeCompare(b));
        const expectedFiles = [...ASSOCIATION_FILE_NAMES].sort((a, b) => a.localeCompare(b));
        const filesMatch =
          producedFiles.length === expectedFiles.length && producedFiles.every((f, i) => f === expectedFiles[i]);
        if (!filesMatch) {
          return { ok: false, reason: `association-files produced an unexpected file set: ${producedFiles.join(', ') || '(none)'}` };
        }
        const wellKnownDir = path.join(tempDir, '.well-known');
        fs.mkdirSync(wellKnownDir);
        for (const name of ASSOCIATION_FILE_NAMES) {
          fs.copyFileSync(path.join(stageDir, name), path.join(wellKnownDir, name));
        }
      } finally {
        fs.rmSync(stageDir, { recursive: true, force: true });
      }
    }

    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(outDir), { recursive: true });
    fs.renameSync(tempDir, outDir);

    return state.kind === 'present'
      ? { ok: true, associationState: 'present' }
      : { ok: true, associationState: 'absent', missingPath: state.missingPath };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
