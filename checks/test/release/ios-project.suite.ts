/**
 * Acceptance for `scripts/release/lib/ios-project.ts` (chain-3, platform-release-readiness).
 * specs/native-release-config/spec.md "Both apps ship under one identity", "The iOS app
 * declares its export, device and permission surface", "The iOS privacy manifest covers linked
 * native code and collected data"; specs/app-links/spec.md "The iOS app delivers universal
 * links to the launcher"; task 4.6.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, assert } from '../harness';
import { checkIosProject } from '../../../scripts/release/lib/ios-project';
import { loadNativeReleaseConfig, type NativeReleaseConfig } from '../../../scripts/release/lib/native-config';

const REPO_ROOT = process.cwd();

const FIXTURE_CONFIG: NativeReleaseConfig = {
  WHIM_APP_ID: 'com.anycognition.whim',
  WHIM_APPLE_TEAM_ID: '2B7K4YLS34',
  WHIM_MARKETING_VERSION: '1.0.0',
  WHIM_BUILD_NUMBER: '1',
  WHIM_DOMAIN: 'example.com',
};

interface PbxprojFixtureOpts {
  debugBundleId?: string;
  releaseBundleId?: string;
  debugFamily?: string;
  releaseFamily?: string;
}

function pbxprojFixture(opts: PbxprojFixtureOpts = {}): string {
  const debugBundleId = opts.debugBundleId ?? '$(WHIM_APP_ID)';
  const releaseBundleId = opts.releaseBundleId ?? '$(WHIM_APP_ID)';
  const debugFamily = opts.debugFamily ?? '1';
  const releaseFamily = opts.releaseFamily ?? '1';
  return `// !$*UTF8*$!
{
	archiveVersion = 1;
	objects = {
		AAAAAAAAAAAAAAAAAAAAAAAA /* Whim */ = {
			isa = PBXNativeTarget;
			buildConfigurationList = BBBBBBBBBBBBBBBBBBBBBBBB;
			name = Whim;
		};
		BBBBBBBBBBBBBBBBBBBBBBBB /* Build configuration list for PBXNativeTarget "Whim" */ = {
			isa = XCConfigurationList;
			buildConfigurations = (
				CCCCCCCCCCCCCCCCCCCCCCCC,
				DDDDDDDDDDDDDDDDDDDDDDDD,
			);
		};
		CCCCCCCCCCCCCCCCCCCCCCCC /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				PRODUCT_BUNDLE_IDENTIFIER = "${debugBundleId}";
				TARGETED_DEVICE_FAMILY = "${debugFamily}";
			};
			name = Debug;
		};
		DDDDDDDDDDDDDDDDDDDDDDDD /* Release */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				PRODUCT_BUNDLE_IDENTIFIER = "${releaseBundleId}";
				TARGETED_DEVICE_FAMILY = "${releaseFamily}";
			};
			name = Release;
		};
	};
	rootObject = AAAAAAAAAAAAAAAAAAAAAAAA;
}
`;
}

interface InfoPlistFixtureOpts {
  itsAppUsesNonExemptEncryption?: boolean;
  emptyUsageDescriptionKey?: string;
}

function infoPlistFixture(opts: InfoPlistFixtureOpts = {}): string {
  const its = opts.itsAppUsesNonExemptEncryption ?? false;
  const usageKeyXml = opts.emptyUsageDescriptionKey
    ? `\n\t<key>${opts.emptyUsageDescriptionKey}</key>\n\t<string></string>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>ITSAppUsesNonExemptEncryption</key>
	<${its}/>${usageKeyXml}
</dict>
</plist>
`;
}

function entitlementsFixture(host = 'applinks:whim.$(WHIM_DOMAIN)'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.developer.associated-domains</key>
	<array>
		<string>${host}</string>
	</array>
</dict>
</plist>
`;
}

interface PrivacyManifestFixtureOpts {
  includeDiskSpace?: boolean;
  tracking?: boolean;
}

function privacyManifestFixture(opts: PrivacyManifestFixtureOpts = {}): string {
  const includeDiskSpace = opts.includeDiskSpace ?? true;
  const tracking = opts.tracking ?? false;
  const diskSpaceEntry = includeDiskSpace
    ? `
		<dict>
			<key>NSPrivacyAccessedAPIType</key>
			<string>NSPrivacyAccessedAPICategoryDiskSpace</string>
			<key>NSPrivacyAccessedAPITypeReasons</key>
			<array>
				<string>E174.1</string>
			</array>
		</dict>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>NSPrivacyAccessedAPITypes</key>
	<array>${diskSpaceEntry}
	</array>
	<key>NSPrivacyCollectedDataTypes</key>
	<array/>
	<key>NSPrivacyTracking</key>
	<${tracking}/>
</dict>
</plist>
`;
}

interface FixtureOverrides {
  pbxproj?: string;
  infoPlist?: string;
  entitlements?: string;
  privacyManifest?: string;
}

/** Writes a minimal-but-complete fixture project under a fresh temp dir and runs `fn` against it, cleaning up after. */
function withFixtureRepo(overrides: FixtureOverrides, fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-ios-project-'));
  try {
    const pbxprojDir = path.join(dir, 'ios/Whim.xcodeproj');
    const whimDir = path.join(dir, 'ios/Whim');
    fs.mkdirSync(pbxprojDir, { recursive: true });
    fs.mkdirSync(whimDir, { recursive: true });
    fs.writeFileSync(path.join(pbxprojDir, 'project.pbxproj'), overrides.pbxproj ?? pbxprojFixture(), 'utf8');
    fs.writeFileSync(path.join(whimDir, 'Info.plist'), overrides.infoPlist ?? infoPlistFixture(), 'utf8');
    fs.writeFileSync(path.join(whimDir, 'Whim.entitlements'), overrides.entitlements ?? entitlementsFixture(), 'utf8');
    fs.writeFileSync(path.join(whimDir, 'PrivacyInfo.xcprivacy'), overrides.privacyManifest ?? privacyManifestFixture(), 'utf8');
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function messagesFor(dir: string): string[] {
  return checkIosProject(dir, FIXTURE_CONFIG).map((f) => `${f.file}: ${f.message}`);
}

export async function run(): Promise<void> {
  await test('ios-project: the real ios/ project passes with zero findings', () => {
    const config = loadNativeReleaseConfig(REPO_ROOT);
    const findings = checkIosProject(REPO_ROOT, config);
    assert(findings.length === 0, `expected no findings against the real repo, got ${JSON.stringify(findings)}`);
  });

  await test('ios-project: a well-formed fixture passes with zero findings (baseline for the defect cases below)', () => {
    withFixtureRepo({}, (dir) => {
      const findings = checkIosProject(dir, FIXTURE_CONFIG);
      assert(findings.length === 0, `expected the baseline fixture to pass, got ${JSON.stringify(findings)}`);
    });
  });

  await test('ios-project: an empty usage-description string fails, naming the key', () => {
    withFixtureRepo({ infoPlist: infoPlistFixture({ emptyUsageDescriptionKey: 'NSLocationWhenInUseUsageDescription' }) }, (dir) => {
      const messages = messagesFor(dir);
      assert(
        messages.some((m) => m.includes('ios/Whim/Info.plist') && m.includes('NSLocationWhenInUseUsageDescription')),
        `expected a finding naming the empty usage-description key, got ${JSON.stringify(messages)}`,
      );
    });
  });

  await test('ios-project: TARGETED_DEVICE_FAMILY = "1,2" fails (iPad included)', () => {
    withFixtureRepo({ pbxproj: pbxprojFixture({ debugFamily: '1,2', releaseFamily: '1,2' }) }, (dir) => {
      const messages = messagesFor(dir);
      assert(
        messages.some((m) => m.includes('project.pbxproj') && m.includes('TARGETED_DEVICE_FAMILY')),
        `expected a TARGETED_DEVICE_FAMILY finding, got ${JSON.stringify(messages)}`,
      );
    });
  });

  await test('ios-project: a literal bundle id fails, distinguished from the "$(WHIM_APP_ID)" macro', () => {
    withFixtureRepo({ pbxproj: pbxprojFixture({ releaseBundleId: 'com.anycognition.whim' }) }, (dir) => {
      const messages = messagesFor(dir);
      assert(
        messages.some((m) => m.includes('project.pbxproj') && m.includes('PRODUCT_BUNDLE_IDENTIFIER') && m.includes('literal')),
        `expected a literal-bundle-id finding for Release, got ${JSON.stringify(messages)}`,
      );
    });
  });

  await test(
    'ios-project: ITSAppUsesNonExemptEncryption = true fails (discriminating: a presence-only check would pass this)',
    () => {
      withFixtureRepo({ infoPlist: infoPlistFixture({ itsAppUsesNonExemptEncryption: true }) }, (dir) => {
        const messages = messagesFor(dir);
        assert(
          messages.some((m) => m.includes('ios/Whim/Info.plist') && m.includes('ITSAppUsesNonExemptEncryption')),
          `expected an ITSAppUsesNonExemptEncryption finding, got ${JSON.stringify(messages)}`,
        );
      });
    },
  );

  await test('ios-project: an entitlement host not built from $(WHIM_DOMAIN) fails', () => {
    withFixtureRepo({ entitlements: entitlementsFixture('applinks:whim.example.com') }, (dir) => {
      const messages = messagesFor(dir);
      assert(
        messages.some((m) => m.includes('Whim.entitlements') && m.includes('literal domain')),
        `expected an entitlement-host finding naming the literal domain, got ${JSON.stringify(messages)}`,
      );
    });
  });

  await test('ios-project: a privacy manifest without the DiskSpace category fails', () => {
    withFixtureRepo({ privacyManifest: privacyManifestFixture({ includeDiskSpace: false }) }, (dir) => {
      const messages = messagesFor(dir);
      assert(
        messages.some((m) => m.includes('PrivacyInfo.xcprivacy') && m.includes('DiskSpace')),
        `expected a missing-DiskSpace finding, got ${JSON.stringify(messages)}`,
      );
    });
  });

  await test('ios-project: a privacy manifest declaring tracking fails', () => {
    withFixtureRepo({ privacyManifest: privacyManifestFixture({ tracking: true }) }, (dir) => {
      const messages = messagesFor(dir);
      assert(
        messages.some((m) => m.includes('PrivacyInfo.xcprivacy') && m.includes('NSPrivacyTracking')),
        `expected an NSPrivacyTracking finding, got ${JSON.stringify(messages)}`,
      );
    });
  });
}
