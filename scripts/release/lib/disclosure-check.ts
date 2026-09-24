/**
 * The disclosure release check's impure half (legal-surface-v2 design D3): reads the frozen
 * snapshots under `contract/disclosure/released/` and hands them, with the live manifests,
 * `AI_CONSENT_VERSION` and the launcher's what's-new lines, to the pure
 * `disclosureReleaseFindings`. The fast gate (`checks/test/release/disclosure.suite.ts`), the
 * release preflight and `deploy/deploy.sh` (through the `disclosure-check` CLI command) all call
 * `checkDisclosureRelease`, so the three can't disagree.
 */

import fs from 'node:fs';
import path from 'node:path';
import { RELEASED_SNAPSHOT_DIR, disclosureReleaseFindings, type DisclosureManifest } from '../../../contract/src/disclosure-manifest';
import { AI_CONSENT_VERSION } from '../../../src/host/launcher/release-config';
import { CONSENT_WHATS_NEW } from '../../../src/host/launcher/copy';

declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readdirSync(path: string): string[];
}

const SNAPSHOT_FILE = /^v([1-9]\d*)\.json$/;
const MANIFEST_LISTS = ['categories', 'roles', 'purposes', 'uses', 'promises'] as const;

export interface ReleasedSnapshots {
  readonly released: Readonly<Record<number, DisclosureManifest>>;
  /** Snapshot files that couldn't be read as a manifest, one line each. */
  readonly findings: readonly string[];
}

function isManifestShaped(value: unknown): value is DisclosureManifest {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return MANIFEST_LISTS.every((key) => Array.isArray(record[key]));
}

function parseSnapshot(text: string): DisclosureManifest | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return isManifestShaped(parsed) ? parsed : undefined;
    // eslint-disable-next-line no-restricted-syntax -- intentional: an unparseable snapshot is reported by the caller as a finding naming the file
  } catch {
    return undefined;
  }
}

/** Every `v<N>.json` under `RELEASED_SNAPSHOT_DIR` in `repoRoot`, parsed. */
export function loadReleasedSnapshots(repoRoot: string): ReleasedSnapshots {
  const dir = path.join(repoRoot, RELEASED_SNAPSHOT_DIR);
  if (!fs.existsSync(dir)) return { released: {}, findings: [`${RELEASED_SNAPSHOT_DIR} is missing; it holds every released manifest version`] };
  const released: Record<number, DisclosureManifest> = {};
  const findings: string[] = [];
  for (const file of fs.readdirSync(dir)) {
    const match = SNAPSHOT_FILE.exec(file);
    if (match === null) continue;
    const manifest = parseSnapshot(fs.readFileSync(path.join(dir, file), 'utf8'));
    if (manifest === undefined) findings.push(`${RELEASED_SNAPSHOT_DIR}/${file} is not a manifest snapshot`);
    else released[Number(match[1])] = manifest;
  }
  return { released, findings };
}

/** Every reason this checkout must not ship under the re-consent rule; empty when it may. The
 *  manifests and bump reasons are the live `MANIFESTS` and `BUMP_REASONS` (the check's defaults). */
export function checkDisclosureRelease(repoRoot: string): readonly string[] {
  const { released, findings } = loadReleasedSnapshots(repoRoot);
  return [...findings, ...disclosureReleaseFindings({ released, consentVersion: AI_CONSENT_VERSION, whatsNew: CONSENT_WHATS_NEW })];
}
