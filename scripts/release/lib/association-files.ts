/**
 * Builds the two files ops must serve so the store apps can deliver universal/app links
 * (specs/app-links/spec.md "The release tooling prints the exact association files";
 * store-launch-compliance design D17 "Ops must serve"). Pure builders over already-parsed
 * inputs; reading the two fingerprint files is plain `fs.readFileSync` (no shelling out), so
 * this whole file is safe for `checks/test/release/release-cli.suite.ts` to import directly.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { NativeReleaseConfig } from './native-config';
import { parseFingerprintFile } from './verify-aab';

export const PLAY_SIGNING_FINGERPRINT_PATH = 'release/android-play-signing-cert.sha256';
export const UPLOAD_FINGERPRINT_PATH = 'release/android-upload-cert.sha256';

export interface AasaFile {
  readonly applinks: {
    readonly details: readonly { readonly appIDs: readonly string[]; readonly components: readonly { readonly '/': string }[] }[];
  };
}

/** `{"applinks":{"details":[{"appIDs":["<team>.<app id>"],"components":[{"/":"/a/*"}]}]}}`. */
export function buildAasa(teamId: string, appId: string): AasaFile {
  return { applinks: { details: [{ appIDs: [`${teamId}.${appId}`], components: [{ '/': '/a/*' }] }] } };
}

export interface AssetLinksEntry {
  readonly relation: readonly string[];
  readonly target: {
    readonly namespace: 'android_app';
    readonly package_name: string;
    readonly sha256_cert_fingerprints: readonly string[];
  };
}

/** Play App Signing fingerprint listed first, upload-key fingerprint second (spec, verbatim). */
export function buildAssetLinks(appId: string, playSigningFingerprint: string, uploadFingerprint: string): readonly AssetLinksEntry[] {
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: appId, sha256_cert_fingerprints: [playSigningFingerprint, uploadFingerprint] },
    },
  ];
}

export interface AssociationFiles {
  readonly aasa: AasaFile;
  readonly assetLinks: readonly AssetLinksEntry[];
}

/** Reads and validates a fingerprint file under `repoRoot`; throws, naming the file, when it's missing or malformed. */
function readFingerprintFile(repoRoot: string, relPath: string): string {
  let text: string;
  try {
    text = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
  } catch (err) {
    if ((err as { code?: unknown }).code === 'ENOENT') {
      throw new Error(`association-files: missing fingerprint file ${relPath}`);
    }
    throw err;
  }
  try {
    return parseFingerprintFile(text);
  } catch (err) {
    throw new Error(`association-files: ${relPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Builds both files from `release/whim-release.xcconfig`'s identity plus the two committed
 * fingerprint files under `repoRoot`, Play App Signing first (specs/app-links/spec.md).
 */
export function buildAssociationFiles(repoRoot: string, config: NativeReleaseConfig): AssociationFiles {
  const playSigningFingerprint = readFingerprintFile(repoRoot, PLAY_SIGNING_FINGERPRINT_PATH);
  const uploadFingerprint = readFingerprintFile(repoRoot, UPLOAD_FINGERPRINT_PATH);
  return {
    aasa: buildAasa(config.WHIM_APPLE_TEAM_ID, config.WHIM_APP_ID),
    assetLinks: buildAssetLinks(config.WHIM_APP_ID, playSigningFingerprint, uploadFingerprint),
  };
}
