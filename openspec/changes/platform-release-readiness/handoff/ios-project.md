# ios-project (chain-3 → chain-5)

## Adding a source file to the `Whim` target with the `xcodeproj` gem

Run from `ios/`, with the root Gemfile's gem (`export BUNDLE_PATH=vendor/bundle` first, then
`bundle exec ruby your_script.rb`; `bundle` auto-discovers the Gemfile upward from `ios/`). Never
hand-edit `project.pbxproj` or regenerate it. Pattern for adding a new source file (e.g.
`WhimToneModule.mm`) to the `Whim` group AND its `Sources` build phase:

```ruby
require 'xcodeproj'
project = Xcodeproj::Project.open('Whim.xcodeproj')
target = project.targets.find { |t| t.name == 'Whim' }
whim_group = project.main_group.groups.find { |g| g.display_name == 'Whim' }
file_ref = whim_group.new_reference('Whim/WhimToneModule.mm') # path is repo-relative-to-ios/, like every other file in this group
target.source_build_phase.add_file_reference(file_ref)
project.save
```

For a file that must NOT build (e.g. a resource or config file), stop after `new_reference` —
do not call `add_file_reference`. Re-running against an already-wired project is safe if you
guard with `whim_group.files.find { |f| f.path == '...' }` before creating a new reference (the
same idempotency guard chain-3 used for `Whim.entitlements` and `whim-release.xcconfig`).

## `scripts/release/lib/ios-project.ts` — parsers and check

```ts
export type PlistValue = string | boolean | number | PlistValue[] | { [key: string]: PlistValue };
export function parseXmlPlist(text: string): PlistValue; // Info.plist / PrivacyInfo.xcprivacy / *.entitlements subset: dict, array, string, true/false, integer

export type PbxValue = string | PbxValue[] | { [key: string]: PbxValue };
export function parsePbxproj(text: string): { [key: string]: PbxValue }; // project.pbxproj's OpenStep-plist grammar, root dict
export function extractWhimTargetBuildSettings(pbxprojText: string): { [configName: string]: { [key: string]: PbxValue } }; // keyed "Debug"/"Release"

export interface IosProjectFinding {
  readonly file: string; // repo-relative, e.g. "ios/Whim/Info.plist"
  readonly message: string;
}
export function checkIosProject(repoRoot: string, config: NativeReleaseConfig): IosProjectFinding[]; // empty = passes
```

`checkIosProject` reads exactly `ios/Whim.xcodeproj/project.pbxproj`, `ios/Whim/Info.plist`,
`ios/Whim/Whim.entitlements`, `ios/Whim/PrivacyInfo.xcprivacy` under `repoRoot` — no other files,
no shelling out. It checks (both Debug and Release target configs): `PRODUCT_BUNDLE_IDENTIFIER`
is exactly `"$(WHIM_APP_ID)"`, `TARGETED_DEVICE_FAMILY` is exactly `"1"`; no `*UsageDescription`
key is an empty string; `ITSAppUsesNonExemptEncryption` is exactly `false`; the entitlement's
`com.apple.developer.associated-domains` includes exactly `"applinks:whim.$(WHIM_DOMAIN)"`; the
privacy manifest declares the DiskSpace category with reason `E174.1`, and `NSPrivacyTracking`
is exactly `false`.

## Workspace / scheme / configuration names

Workspace `Whim.xcworkspace`, scheme `Whim`, configurations `Debug` and `Release` (both project-
and target-level XCBuildConfigurations carry those exact `name`s — `extractWhimTargetBuildSettings`
keys its result by them). A working simulator invocation:

```sh
xcodebuild -workspace Whim.xcworkspace -scheme Whim -configuration Release \
  -sdk iphonesimulator -destination 'platform=iOS Simulator,name=<device>,OS=<os>' \
  -derivedDataPath build/DerivedData build
```

## Wiring now in place (chain-5 builds on top of it, doesn't re-add it)

- Project-level Debug/Release `baseConfigurationReference` → `release/whim-release.xcconfig`
  (file ref path `../release/whim-release.xcconfig`, in a `Release` group).
- Target Debug/Release: `PRODUCT_BUNDLE_IDENTIFIER = "$(WHIM_APP_ID)"`, `DEVELOPMENT_TEAM =
  "$(WHIM_APPLE_TEAM_ID)"`, `CODE_SIGN_STYLE = Automatic`, `MARKETING_VERSION =
  "$(WHIM_MARKETING_VERSION)"`, `CURRENT_PROJECT_VERSION = "$(WHIM_BUILD_NUMBER)"`,
  `CODE_SIGN_ENTITLEMENTS = Whim/Whim.entitlements`, `TARGETED_DEVICE_FAMILY = 1`.
- `Whim.entitlements` is a file reference in the `Whim` group only — not in any build phase.
- **Gotcha for any future Swift file:** `AppDelegate.swift` needs no `import React-RCTLinking`
  or similar for `RCTLinkingManager` — it ships inside the prebuilt `React.xcframework`'s
  `React` module (its umbrella header includes `RCTLinkingManager.h`), already imported via
  `import React`. Adding a separate import for it fails with "no such module". This doesn't
  apply to `WhimToneModule.mm` (Objective-C++, uses `#import`, not Swift modules).

## Collected data type identifiers (`PrivacyInfo.xcprivacy`, verbatim)

`NSPrivacyCollectedDataTypeOtherUserContent`, `NSPrivacyCollectedDataTypeDeviceID`, each with
`NSPrivacyCollectedDataTypeLinked = false`, `NSPrivacyCollectedDataTypeTracking = false`,
`NSPrivacyCollectedDataTypePurposes = ["NSPrivacyCollectedDataTypePurposeAppFunctionality"]`.

## Verified (simulator Release build, this machine)

Compile + link succeeded; the linked `.xcent` resolved `application-identifier` to
`2B7K4YLS34.com.anycognition.whim` and `com.apple.developer.associated-domains` to
`["applinks:whim.example.com"]` — the xcconfig macros expand correctly end to end. The build's
overall exit was a **script-phase failure**, not a project-wiring defect: the "Bundle React
Native code and images" phase runs Metro, and Metro cannot resolve packages through this
worktree's symlinked `node_modules` (pre-existing, documented limitation — Metro's crawler
doesn't follow the symlink boundary the way `fs`/Node `require` do). Code signing never ran
because the target build stopped after that phase failed. Re-run from a tree with a real (non-
symlinked) `node_modules`, e.g. the primary tree, to see a full `BUILD SUCCEEDED`.
