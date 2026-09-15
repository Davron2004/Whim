/**
 * The domain lockstep: `WHIM_DOMAIN` is declared independently in three places — the native
 * release file, the launcher's `release-config.ts`, and `deploy/defaults.env`'s two derived
 * hosts — and nothing forces them to agree except this check (design D1's lockstep paragraph;
 * specs/native-release-config/spec.md "The native release domain matches the launcher's release
 * domain"). `domainLockstepFinding` and `deployHostLockstepFindings` are pure; `loadDeployDefaults`
 * is the only impure half (a plain `fs` read, no shelling out), never called by the suite.
 */

import fs from 'node:fs';
import path from 'node:path';

export const DEPLOY_DEFAULTS_PATH = 'deploy/defaults.env';

export interface DeployDefaults {
  readonly WHIM_API_HOST: string;
  readonly WHIM_WEB_HOST: string;
}

/** The native release file's and the launcher's `WHIM_DOMAIN` — a message when they disagree, `undefined` when they match. */
export function domainLockstepFinding(native: string, launcher: string): string | undefined {
  if (native === launcher) return undefined;
  return (
    `WHIM_DOMAIN drifted: release/whim-release.xcconfig has "${native}", ` +
    `src/host/launcher/release-config.ts has "${launcher}" — they must name the same domain`
  );
}

/** `deploy/defaults.env`'s two derived hosts against the domain they must be built from (`api.whim.<domain>`, `whim.<domain>`). */
export function deployHostLockstepFindings(domain: string, deploy: DeployDefaults): readonly string[] {
  const findings: string[] = [];
  const expectedApiHost = `api.whim.${domain}`;
  if (deploy.WHIM_API_HOST !== expectedApiHost) {
    findings.push(
      `WHIM_API_HOST drifted: deploy/defaults.env has "${deploy.WHIM_API_HOST}", expected "${expectedApiHost}" (api.whim.<WHIM_DOMAIN>) — they must name the same domain`,
    );
  }
  const expectedWebHost = `whim.${domain}`;
  if (deploy.WHIM_WEB_HOST !== expectedWebHost) {
    findings.push(
      `WHIM_WEB_HOST drifted: deploy/defaults.env has "${deploy.WHIM_WEB_HOST}", expected "${expectedWebHost}" (whim.<WHIM_DOMAIN>) — they must name the same domain`,
    );
  }
  return findings;
}

function parseSimpleEnv(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    values.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  return values;
}

/** Reads and parses `deploy/defaults.env` under `repoRoot` (never called by the suite). */
export function loadDeployDefaults(repoRoot: string): DeployDefaults {
  const text = fs.readFileSync(path.join(repoRoot, DEPLOY_DEFAULTS_PATH), 'utf8');
  const values = parseSimpleEnv(text);
  const apiHost = values.get('WHIM_API_HOST');
  const webHost = values.get('WHIM_WEB_HOST');
  if (!apiHost || !webHost) throw new Error(`${DEPLOY_DEFAULTS_PATH}: missing WHIM_API_HOST or WHIM_WEB_HOST`);
  return { WHIM_API_HOST: apiHost, WHIM_WEB_HOST: webHost };
}
