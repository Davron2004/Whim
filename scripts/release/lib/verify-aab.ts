/**
 * Verifies a store AAB before upload (design D12 "verify-aab"; specs/store-release-pipeline/
 * spec.md "Only a verified store AAB is uploaded"). This is the last guard before an upload
 * that can't be undone, so the tool-driven half (shelling to `keytool`/`bundletool`) is kept
 * separate from the pure `aabFindings(facts, expected)` that decides pass/refuse — the suite
 * exercises only the pure half, never the shell-outs (chains.md's suite-portability rule).
 *
 * Manifest tool: `aapt2 dump xmltree --file base/manifest/AndroidManifest.xml <aab>` cannot
 * read a real Android App Bundle — measured against a production `.aab` on this machine, it
 * fails "could not identify format of APK" (aapt2 wants an APK's binary-XML container, not an
 * AAB's protobuf-XML module zip). `bundletool dump manifest --bundle=<aab>` prints the decoded
 * manifest as plain XML instead, so that's the tool this file shells to — verified end to end
 * against bundletool 1.18.3 (a real signed AAB, matching and mismatching `--build`), see
 * handoff/release-cli.md.
 */

import { execFileSync } from 'node:child_process';

// ── Fingerprint file parsing (pure) ─────────────────────────────────────────────────────────

export class FingerprintFileError extends Error {}

const FINGERPRINT_PATTERN = /^([0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/;

/** Parses a "32 colon-separated hex bytes" SHA-256 fingerprint file, normalized to uppercase. */
export function parseFingerprintFile(text: string): string {
  const trimmed = text.trim();
  if (!FINGERPRINT_PATTERN.test(trimmed)) {
    throw new FingerprintFileError('expected 32 colon-separated hex bytes (a SHA-256 fingerprint), e.g. from "keytool -list -v"');
  }
  return trimmed.toUpperCase();
}

// ── Facts gathered by shelling to keytool / bundletool (impure — never called by the suite) ──

/** The Android manifest facts `verify-aab` checks: package name, version code, debuggable. */
export interface AabManifestFacts {
  readonly packageName: string | undefined;
  readonly versionCode: number | undefined;
  readonly debuggable: boolean;
}

const BUNDLETOOL_BINARY = process.env.WHIM_BUNDLETOOL ?? 'bundletool';

/** `bundletool dump manifest --bundle=<aabPath>`, parsed as plain XML attributes. */
export function getAabManifestFacts(aabPath: string): AabManifestFacts {
  const xml = execFileSync(BUNDLETOOL_BINARY, ['dump', 'manifest', `--bundle=${aabPath}`], { encoding: 'utf8' });
  const packageMatch = /\spackage="([^"]*)"/.exec(xml);
  const versionCodeMatch = /android:versionCode="([^"]*)"/.exec(xml);
  const debuggableMatch = /android:debuggable="([^"]*)"/.exec(xml);
  return {
    packageName: packageMatch?.[1],
    versionCode: versionCodeMatch ? Number(versionCodeMatch[1]) : undefined,
    debuggable: debuggableMatch?.[1] === 'true',
  };
}

/** `keytool -printcert -jarfile <aabPath>`'s SHA-256 signer fingerprint (an AAB is a signed jar/zip). */
export function getAabSignerFingerprint(aabPath: string): string {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- intentional: verify-aab runs inside the repo's own release toolchain, which always has a trustworthy `keytool` on PATH (ships with any JDK)
  const output = execFileSync('keytool', ['-printcert', '-jarfile', aabPath], { encoding: 'utf8' });
  const match = /SHA256:\s*([0-9A-Fa-f:]+)/.exec(output);
  if (!match) {
    throw new Error(`keytool -printcert -jarfile ${aabPath}: could not find a SHA256 fingerprint in its output`);
  }
  return match[1].toUpperCase();
}

// ── aabFindings: pure, over already-gathered facts ──────────────────────────────────────────

export interface AabFacts {
  readonly manifest: AabManifestFacts;
  readonly signerFingerprint: string;
}

export interface AabExpected {
  readonly packageName: string;
  readonly versionCode: number;
  readonly signerFingerprint: string;
}

export interface AabFinding {
  readonly reason: string;
}

/**
 * Checks `facts` against `expected` per specs/store-release-pipeline/spec.md "Only a verified
 * store AAB is uploaded": not debuggable, matching package name, matching version code, signed
 * with the expected fingerprint. Every finding names both the expected and the actual value.
 */
export function aabFindings(facts: AabFacts, expected: AabExpected): readonly AabFinding[] {
  const findings: AabFinding[] = [];

  if (facts.manifest.debuggable) {
    findings.push({ reason: 'the manifest declares android:debuggable="true"; a store build must not be debuggable' });
  }
  if (facts.manifest.packageName !== expected.packageName) {
    findings.push({ reason: `package is ${JSON.stringify(facts.manifest.packageName)}, expected ${JSON.stringify(expected.packageName)}` });
  }
  if (facts.manifest.versionCode !== expected.versionCode) {
    findings.push({ reason: `version code is ${JSON.stringify(facts.manifest.versionCode)}, expected ${expected.versionCode}` });
  }
  if (facts.signerFingerprint.toUpperCase() !== expected.signerFingerprint.toUpperCase()) {
    findings.push({ reason: `signed with SHA-256 ${facts.signerFingerprint}, expected ${expected.signerFingerprint}` });
  }

  return findings;
}
