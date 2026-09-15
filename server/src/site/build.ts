/**
 * server/src/site/build.ts — the Whim pages host site build (public-generation-server chain-15,
 * design D21–D24; specs/server-deployment "The privacy policy and support pages match what the
 * app discloses", "Association files come only from the release tooling").
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

/** The closed placeholder set (design D23's table). Nothing else may appear as `{{NAME}}`. */
export type PlaceholderName =
  | 'WHIM_SUPPORT_EMAIL'
  | 'WHIM_ENGINEER_MODEL'
  | 'WHIM_REWRITE_MODEL'
  | 'WHIM_APP_STORE_URL'
  | 'WHIM_PLAY_STORE_URL';

export type PlaceholderValues = { readonly [K in PlaceholderName]?: string };

const REQUIRED_PLACEHOLDERS: ReadonlySet<PlaceholderName> = new Set([
  'WHIM_SUPPORT_EMAIL',
  'WHIM_ENGINEER_MODEL',
  'WHIM_REWRITE_MODEL',
]);
const ALL_PLACEHOLDERS: ReadonlySet<string> = new Set<PlaceholderName>([
  'WHIM_SUPPORT_EMAIL',
  'WHIM_ENGINEER_MODEL',
  'WHIM_REWRITE_MODEL',
  'WHIM_APP_STORE_URL',
  'WHIM_PLAY_STORE_URL',
]);

/** Deliberately not a single backtracking-prone regex (sonarjs `super-linear-regex`): split on
 *  `@` and check each side has no whitespace and the domain has an interior `.`. */
function looksLikeEmail(value: string): boolean {
  const at = value.indexOf('@');
  if (at <= 0 || at === value.length - 1 || value.indexOf('@', at + 1) !== -1) return false;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (/\s/.test(local) || /\s/.test(domain)) return false;
  const dot = domain.lastIndexOf('.');
  return dot > 0 && dot < domain.length - 1;
}
const STORE_URL_RULES: { readonly [K in 'WHIM_APP_STORE_URL' | 'WHIM_PLAY_STORE_URL']: RegExp } = {
  WHIM_APP_STORE_URL: /^https:\/\/apps\.apple\.com\//,
  WHIM_PLAY_STORE_URL: /^https:\/\/play\.google\.com\//,
};

/** Thrown by `renderPage`, naming the exact offending placeholder (or `'{{'` for a leftover
 *  marker) — never a batch, so a build failure names one thing. */
export class RenderPageError extends Error {
  constructor(
    public readonly placeholder: string,
    message: string,
  ) {
    super(message);
    this.name = 'RenderPageError';
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function validatePlaceholderValue(name: PlaceholderName, value: string): void {
  if (name === 'WHIM_SUPPORT_EMAIL' && !looksLikeEmail(value)) {
    throw new RenderPageError(name, `${name} must be a valid email address, got ${JSON.stringify(value)}.`);
  }
  if (name === 'WHIM_APP_STORE_URL' || name === 'WHIM_PLAY_STORE_URL') {
    if (!STORE_URL_RULES[name].test(value)) {
      throw new RenderPageError(
        name,
        `${name} must be an https URL on ${name === 'WHIM_APP_STORE_URL' ? 'apps.apple.com' : 'play.google.com'}, got ${JSON.stringify(value)}.`,
      );
    }
  }
}

const IF_BLOCK_RE = /<!--IF:([A-Z0-9_]+)-->([\s\S]*?)<!--ENDIF-->/g;
const PLACEHOLDER_RE = /\{\{([A-Z0-9_]+)\}\}/g;

/**
 * Renders one page source against a set of deploy-time values. `<!--IF:NAME-->...<!--ENDIF-->`
 * blocks are kept only when `values[NAME]` is a non-empty string (design D23's "store-links
 * block dropped when both store URLs are unset" — each store gets its own single-name block, so
 * "both unset" drops both without a combined-condition mechanism). Every `{{NAME}}` elsewhere is
 * HTML-escaped and substituted; an unknown NAME, a missing/malformed required value, or a
 * leftover `{{` after substitution throws `RenderPageError` naming the offender.
 */
export function renderPage(source: string, values: PlaceholderValues): string {
  let working = source.replace(IF_BLOCK_RE, (_match, name: string, inner: string) => {
    if (!ALL_PLACEHOLDERS.has(name)) {
      throw new RenderPageError(name, `unknown placeholder {{${name}}} in an IF block.`);
    }
    const value = values[name as PlaceholderName];
    return value ? inner : '';
  });

  working = working.replace(PLACEHOLDER_RE, (_match, name: string) => {
    if (!ALL_PLACEHOLDERS.has(name)) {
      throw new RenderPageError(name, `unknown placeholder {{${name}}}.`);
    }
    const placeholder = name as PlaceholderName;
    const value = values[placeholder];
    if (value === undefined || value === '') {
      if (REQUIRED_PLACEHOLDERS.has(placeholder)) {
        throw new RenderPageError(placeholder, `${placeholder} is required and was not provided.`);
      }
      return '';
    }
    validatePlaceholderValue(placeholder, value);
    return escapeHtml(value);
  });

  if (working.includes('{{')) {
    throw new RenderPageError('{{', 'a placeholder marker was left unrendered.');
  }
  return working;
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

const PAGE_FILES = ['privacy.html', 'support.html', 'app-link.html', 'not-found.html'] as const;

/**
 * Renders the four pages into a temp directory, adds `.well-known/` association files when
 * `associationState(repoRoot)` is `present` (via the injected runner, copying exactly the two
 * `handoff/release-cli.md` output files byte for byte), and moves the temp directory to `outDir`
 * only on success. Never touches `outDir` on failure. Prints nothing and never calls
 * `process.exit` — `server/site.mjs` owns stdout and the exit code.
 */
export async function buildSite(options: BuildSiteOptions): Promise<BuildSiteResult> {
  const { repoRoot, env, outDir, runAssociationFiles } = options;
  const values: PlaceholderValues = {
    WHIM_SUPPORT_EMAIL: env.WHIM_SUPPORT_EMAIL,
    WHIM_ENGINEER_MODEL: env.WHIM_ENGINEER_MODEL,
    WHIM_REWRITE_MODEL: env.WHIM_REWRITE_MODEL,
    WHIM_APP_STORE_URL: env.WHIM_APP_STORE_URL,
    WHIM_PLAY_STORE_URL: env.WHIM_PLAY_STORE_URL,
  };

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-site-build-'));
  try {
    for (const file of PAGE_FILES) {
      const source = fs.readFileSync(path.join(repoRoot, 'deploy', 'site', file), 'utf8');
      let rendered: string;
      try {
        rendered = renderPage(source, values);
      } catch (e) {
        if (e instanceof RenderPageError) return { ok: false, reason: e.message };
        throw e;
      }
      fs.writeFileSync(path.join(tempDir, file), rendered, 'utf8');
    }

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
