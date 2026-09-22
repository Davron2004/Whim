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
  developmentTeam?: string;
  marketingVersion?: string;
  currentProjectVersion?: string;
  codeSignEntitlements?: string;
  debugProjectXcconfigPath?: string;
  releaseProjectXcconfigPath?: string;
  includeSceneDelegateFileReference?: boolean;
  includeSceneDelegateSourceMembership?: boolean;
}

function pbxprojFixture(opts: PbxprojFixtureOpts = {}): string {
  const debugBundleId = opts.debugBundleId ?? '$(WHIM_APP_ID)';
  const releaseBundleId = opts.releaseBundleId ?? '$(WHIM_APP_ID)';
  const debugFamily = opts.debugFamily ?? '1';
  const releaseFamily = opts.releaseFamily ?? '1';
  const developmentTeam = opts.developmentTeam ?? '$(WHIM_APPLE_TEAM_ID)';
  const marketingVersion = opts.marketingVersion ?? '$(WHIM_MARKETING_VERSION)';
  const currentProjectVersion = opts.currentProjectVersion ?? '$(WHIM_BUILD_NUMBER)';
  const codeSignEntitlements = opts.codeSignEntitlements ?? 'Whim/Whim.entitlements';
  const debugProjectXcconfigPath = opts.debugProjectXcconfigPath ?? '../release/whim-release.xcconfig';
  const releaseProjectXcconfigPath = opts.releaseProjectXcconfigPath ?? '../release/whim-release.xcconfig';
  const includeSceneDelegateFileReference = opts.includeSceneDelegateFileReference ?? true;
  const includeSceneDelegateSourceMembership = opts.includeSceneDelegateSourceMembership ?? true;
  const sceneDelegateFileReference = includeSceneDelegateFileReference
    ? '\n\t\tMMMMMMMMMMMMMMMMMMMMMMMM /* SceneDelegate.swift */ = {isa = PBXFileReference; path = Whim/SceneDelegate.swift; };'
    : '';
  const sceneDelegateSourceMembership = includeSceneDelegateSourceMembership
    ? '\n\t\tLLLLLLLLLLLLLLLLLLLLLLLL /* SceneDelegate.swift in Sources */ = {isa = PBXBuildFile; fileRef = MMMMMMMMMMMMMMMMMMMMMMMM; };'
    : '';
  const sourceFiles = includeSceneDelegateSourceMembership ? 'LLLLLLLLLLLLLLLLLLLLLLLL,' : '';
  return `// !$*UTF8*$!
{
	archiveVersion = 1;
	objects = {
		AAAAAAAAAAAAAAAAAAAAAAAA /* Whim */ = {
			isa = PBXNativeTarget;
			buildConfigurationList = BBBBBBBBBBBBBBBBBBBBBBBB;
			buildPhases = (KKKKKKKKKKKKKKKKKKKKKKKK,);
			name = Whim;
		};
		KKKKKKKKKKKKKKKKKKKKKKKK /* Sources */ = {
			isa = PBXSourcesBuildPhase;
			files = (${sourceFiles});
		};${sceneDelegateSourceMembership}${sceneDelegateFileReference}
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
				DEVELOPMENT_TEAM = "${developmentTeam}";
				MARKETING_VERSION = "${marketingVersion}";
				CURRENT_PROJECT_VERSION = "${currentProjectVersion}";
				CODE_SIGN_ENTITLEMENTS = ${codeSignEntitlements};
			};
			name = Debug;
		};
		DDDDDDDDDDDDDDDDDDDDDDDD /* Release */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				PRODUCT_BUNDLE_IDENTIFIER = "${releaseBundleId}";
				TARGETED_DEVICE_FAMILY = "${releaseFamily}";
				DEVELOPMENT_TEAM = "${developmentTeam}";
				MARKETING_VERSION = "${marketingVersion}";
				CURRENT_PROJECT_VERSION = "${currentProjectVersion}";
				CODE_SIGN_ENTITLEMENTS = ${codeSignEntitlements};
			};
			name = Release;
		};
		EEEEEEEEEEEEEEEEEEEEEEEE /* Project object */ = {
			isa = PBXProject;
			buildConfigurationList = FFFFFFFFFFFFFFFFFFFFFFFF;
		};
		FFFFFFFFFFFFFFFFFFFFFFFF /* Build configuration list for PBXProject "Whim" */ = {
			isa = XCConfigurationList;
			buildConfigurations = (
				GGGGGGGGGGGGGGGGGGGGGGGG,
				HHHHHHHHHHHHHHHHHHHHHHHH,
			);
		};
		GGGGGGGGGGGGGGGGGGGGGGGG /* Debug */ = {
			isa = XCBuildConfiguration;
			baseConfigurationReference = IIIIIIIIIIIIIIIIIIIIIIII;
			buildSettings = {
			};
			name = Debug;
		};
		HHHHHHHHHHHHHHHHHHHHHHHH /* Release */ = {
			isa = XCBuildConfiguration;
			baseConfigurationReference = JJJJJJJJJJJJJJJJJJJJJJJJ;
			buildSettings = {
			};
			name = Release;
		};
		IIIIIIIIIIIIIIIIIIIIIIII /* whim-release.xcconfig */ = {isa = PBXFileReference; path = "${debugProjectXcconfigPath}"; };
		JJJJJJJJJJJJJJJJJJJJJJJJ /* whim-release.xcconfig */ = {isa = PBXFileReference; path = "${releaseProjectXcconfigPath}"; };
	};
	rootObject = EEEEEEEEEEEEEEEEEEEEEEEE;
}
`;
}

interface InfoPlistFixtureOpts {
  itsAppUsesNonExemptEncryption?: boolean;
  emptyUsageDescriptionKey?: string;
  includeSceneManifest?: boolean;
  supportsMultipleScenes?: boolean;
  sceneClassName?: string;
  sceneDelegateClassName?: string;
  sceneConfigurationCount?: number;
}

function infoPlistFixture(opts: InfoPlistFixtureOpts = {}): string {
  const its = opts.itsAppUsesNonExemptEncryption ?? false;
  const includeSceneManifest = opts.includeSceneManifest ?? true;
  const supportsMultipleScenes = opts.supportsMultipleScenes ?? false;
  const sceneClassName = opts.sceneClassName ?? 'UIWindowScene';
  const sceneDelegateClassName = opts.sceneDelegateClassName ?? '$(PRODUCT_MODULE_NAME).SceneDelegate';
  const sceneConfigurationCount = opts.sceneConfigurationCount ?? 1;
  const usageKeyXml = opts.emptyUsageDescriptionKey
    ? `\n\t<key>${opts.emptyUsageDescriptionKey}</key>\n\t<string></string>`
    : '';
  const sceneConfiguration = `
\t\t\t<dict>
\t\t\t\t<key>UISceneClassName</key>
\t\t\t\t<string>${sceneClassName}</string>
\t\t\t\t<key>UISceneDelegateClassName</key>
\t\t\t\t<string>${sceneDelegateClassName}</string>
\t\t\t</dict>`;
  const sceneManifest = includeSceneManifest
    ? `
\t<key>UIApplicationSceneManifest</key>
\t<dict>
\t\t<key>UISupportsMultipleScenes</key>
\t\t<${supportsMultipleScenes}/>
\t\t<key>UISceneConfigurations</key>
\t\t<dict>
\t\t\t<key>UIWindowSceneSessionRoleApplication</key>
\t\t\t<array>${sceneConfiguration.repeat(sceneConfigurationCount)}
\t\t\t</array>
\t\t</dict>
\t</dict>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>ITSAppUsesNonExemptEncryption</key>
	<${its}/>${usageKeyXml}${sceneManifest}
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

interface MutationCase {
  readonly name: string;
  readonly overrides: FixtureOverrides;
  /** Every one of these substrings must appear together on at least one finding message. */
  readonly expect: readonly string[];
}

const MUTATION_CASES: readonly MutationCase[] = [
  {
    name: 'a missing UIApplicationSceneManifest fails before a no-scene lifecycle build reaches UIKit',
    overrides: { infoPlist: infoPlistFixture({ includeSceneManifest: false }) },
    expect: ['Info.plist', 'UIApplicationSceneManifest'],
  },
  {
    name: 'a scene manifest that permits multiple scenes fails',
    overrides: { infoPlist: infoPlistFixture({ supportsMultipleScenes: true }) },
    expect: ['UISupportsMultipleScenes'],
  },
  {
    name: 'a non-UIWindowScene application configuration fails',
    overrides: { infoPlist: infoPlistFixture({ sceneClassName: 'UIScene' }) },
    expect: ['UISceneClassName', 'UIWindowScene'],
  },
  {
    name: 'a scene configuration with a wrong delegate class fails',
    overrides: { infoPlist: infoPlistFixture({ sceneDelegateClassName: '$(PRODUCT_MODULE_NAME).OtherSceneDelegate' }) },
    expect: ['UISceneDelegateClassName', 'SceneDelegate'],
  },
  {
    name: 'more than one application scene configuration fails',
    overrides: { infoPlist: infoPlistFixture({ sceneConfigurationCount: 2 }) },
    expect: ['exactly one UIWindowSceneSessionRoleApplication'],
  },
  {
    name: 'SceneDelegate.swift missing from the Whim Sources phase fails',
    overrides: { pbxproj: pbxprojFixture({ includeSceneDelegateSourceMembership: false }) },
    expect: ['SceneDelegate.swift', 'Sources build phase'],
  },
  {
    name: 'an empty usage-description string fails, naming the key',
    overrides: { infoPlist: infoPlistFixture({ emptyUsageDescriptionKey: 'NSLocationWhenInUseUsageDescription' }) },
    expect: ['ios/Whim/Info.plist', 'NSLocationWhenInUseUsageDescription'],
  },
  {
    name: 'TARGETED_DEVICE_FAMILY = "1,2" fails (iPad included)',
    overrides: { pbxproj: pbxprojFixture({ debugFamily: '1,2', releaseFamily: '1,2' }) },
    expect: ['project.pbxproj', 'TARGETED_DEVICE_FAMILY'],
  },
  {
    name: 'a literal DEVELOPMENT_TEAM fails, distinguished from the macro',
    overrides: { pbxproj: pbxprojFixture({ developmentTeam: FIXTURE_CONFIG.WHIM_APPLE_TEAM_ID }) },
    expect: ['project.pbxproj', 'DEVELOPMENT_TEAM', 'literal'],
  },
  {
    name: 'a literal MARKETING_VERSION fails',
    overrides: { pbxproj: pbxprojFixture({ marketingVersion: FIXTURE_CONFIG.WHIM_MARKETING_VERSION }) },
    expect: ['project.pbxproj', 'MARKETING_VERSION'],
  },
  {
    name: 'a literal CURRENT_PROJECT_VERSION fails',
    overrides: { pbxproj: pbxprojFixture({ currentProjectVersion: FIXTURE_CONFIG.WHIM_BUILD_NUMBER }) },
    expect: ['project.pbxproj', 'CURRENT_PROJECT_VERSION'],
  },
  {
    name: 'a wrong CODE_SIGN_ENTITLEMENTS path fails',
    overrides: { pbxproj: pbxprojFixture({ codeSignEntitlements: 'Whim/Other.entitlements' }) },
    expect: ['project.pbxproj', 'CODE_SIGN_ENTITLEMENTS', 'Other.entitlements'],
  },
  {
    name: 'the Debug project-level baseConfigurationReference not resolving to whim-release.xcconfig fails',
    overrides: { pbxproj: pbxprojFixture({ debugProjectXcconfigPath: '../release/some-other.xcconfig' }) },
    expect: ['project.pbxproj', 'Debug project-level baseConfigurationReference'],
  },
  {
    name: 'the Release project-level baseConfigurationReference not resolving to whim-release.xcconfig fails',
    overrides: { pbxproj: pbxprojFixture({ releaseProjectXcconfigPath: '../release/some-other.xcconfig' }) },
    expect: ['project.pbxproj', 'Release project-level baseConfigurationReference'],
  },
  {
    name: 'a literal bundle id fails, distinguished from the "$(WHIM_APP_ID)" macro',
    overrides: { pbxproj: pbxprojFixture({ releaseBundleId: 'com.anycognition.whim' }) },
    expect: ['project.pbxproj', 'PRODUCT_BUNDLE_IDENTIFIER', 'literal'],
  },
  {
    name: 'ITSAppUsesNonExemptEncryption = true fails (discriminating: a presence-only check would pass this)',
    overrides: { infoPlist: infoPlistFixture({ itsAppUsesNonExemptEncryption: true }) },
    expect: ['ios/Whim/Info.plist', 'ITSAppUsesNonExemptEncryption'],
  },
  {
    name: 'an entitlement host not built from $(WHIM_DOMAIN) fails',
    overrides: { entitlements: entitlementsFixture('applinks:whim.example.com') },
    expect: ['Whim.entitlements', 'literal domain'],
  },
  {
    name: 'a privacy manifest without the DiskSpace category fails',
    overrides: { privacyManifest: privacyManifestFixture({ includeDiskSpace: false }) },
    expect: ['PrivacyInfo.xcprivacy', 'DiskSpace'],
  },
  {
    name: 'a privacy manifest declaring tracking fails',
    overrides: { privacyManifest: privacyManifestFixture({ tracking: true }) },
    expect: ['PrivacyInfo.xcprivacy', 'NSPrivacyTracking'],
  },
];

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

  for (const c of MUTATION_CASES) {
    await test(`ios-project: ${c.name}`, () => {
      withFixtureRepo(c.overrides, (dir) => {
        const messages = messagesFor(dir);
        assert(
          messages.some((message) => c.expect.every((token) => message.includes(token))),
          `expected a finding matching [${c.expect.join(', ')}], got ${JSON.stringify(messages)}`,
        );
      });
    });
  }
}
