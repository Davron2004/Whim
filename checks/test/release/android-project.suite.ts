/**
 * Acceptance for `scripts/release/lib/android-project.ts` (chain-4, platform-release-readiness).
 * specs/app-links/spec.md "The Android app verifies and delivers app links";
 * specs/native-release-config/spec.md "Store builds carry no cleartext exception" as beta-1 D20
 * amends it (cleartext at the base, no per-host rules); task 5.6.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, assert } from '../harness';
import {
  checkAndroidProject,
  ANDROID_MANIFEST_PATH,
  ANDROID_MAIN_NETWORK_CONFIG_PATH,
  ANDROID_MAIN_ACTIVITY_PATH,
} from '../../../scripts/release/lib/android-project';

const REPO_ROOT = process.cwd();

function writeFile(root: string, relPath: string, content: string): void {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'whim-android-project-'));
}

/** The real manifest's `MainActivity` configChanges, so the fixture starts from what ships. */
const REAL_CONFIG_CHANGES = (() => {
  const text = fs.readFileSync(path.join(REPO_ROOT, ANDROID_MANIFEST_PATH), 'utf8');
  const found = /android:configChanges="([^"]*)"/.exec(text);
  if (found === null) throw new Error(`no android:configChanges in ${ANDROID_MANIFEST_PATH}`);
  return found[1];
})();

/** `REAL_CONFIG_CHANGES` without `change`, so a case drops exactly one flag. */
function configChangesWithout(change: string): string {
  return REAL_CONFIG_CHANGES.split('|').filter((c) => c !== change).join('|');
}

/** `linkActivity` moves the app-link filter off the launcher activity onto a sibling activity. */
function manifest(opts: { autoVerify: boolean; host: string; linkActivity?: string; configChanges?: string }): string {
  const linkFilter = [
    `        <intent-filter${opts.autoVerify ? ' android:autoVerify="true"' : ''}>`,
    '            <action android:name="android.intent.action.VIEW" />',
    '            <category android:name="android.intent.category.DEFAULT" />',
    '            <category android:name="android.intent.category.BROWSABLE" />',
    '            <data',
    '              android:scheme="https"',
    `              android:host="${opts.host}"`,
    '              android:pathPrefix="/a/" />',
    '        </intent-filter>',
  ];
  return [
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
    '    <application android:name=".MainApplication">',
    '      <activity',
    '        android:name=".MainActivity"',
    '        android:launchMode="singleTask"',
    '        android:screenOrientation="portrait"',
    `        android:configChanges="${opts.configChanges ?? REAL_CONFIG_CHANGES}"`,
    '        android:exported="true">',
    '        <intent-filter>',
    '            <action android:name="android.intent.action.MAIN" />',
    '            <category android:name="android.intent.category.LAUNCHER" />',
    '        </intent-filter>',
    ...(opts.linkActivity === undefined ? linkFilter : []),
    '      </activity>',
    ...(opts.linkActivity === undefined
      ? []
      : [`      <activity android:name="${opts.linkActivity}" android:exported="true">`, ...linkFilter, '      </activity>']),
    '    </application>',
    '</manifest>',
    '',
  ].join('\n');
}

const VALID_MANIFEST = manifest({ autoVerify: true, host: '${whimWebHost}' });

const MAIN_NETWORK_CONFIG = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<network-security-config>',
  '    <base-config cleartextTrafficPermitted="true"/>',
  '</network-security-config>',
  '',
].join('\n');

/** The pre-D20 store config: cleartext to no host, so a user's LAN server is unreachable. */
const MAIN_NETWORK_CONFIG_WITHOUT_CLEARTEXT = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<network-security-config>',
  '    <base-config cleartextTrafficPermitted="false"/>',
  '</network-security-config>',
  '',
].join('\n');

/** Cleartext to a fixed host list only, as the deleted dev config did: it carries a cleartext permit, but
 *  an arbitrary LAN IP stays unreachable. */
const MAIN_NETWORK_CONFIG_WITH_HOST_LIST = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<network-security-config>',
  '    <base-config cleartextTrafficPermitted="false"/>',
  '    <domain-config cleartextTrafficPermitted="true">',
  '        <domain includeSubdomains="false">10.0.2.2</domain>',
  '    </domain-config>',
  '</network-security-config>',
  '',
].join('\n');

/** Cleartext at the base, then refused again for one host by a <domain-config>. */
const MAIN_NETWORK_CONFIG_WITH_OVERRIDE = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<network-security-config>',
  '    <base-config cleartextTrafficPermitted="true"/>',
  '    <domain-config cleartextTrafficPermitted="false">',
  '        <domain includeSubdomains="false">192.168.1.20</domain>',
  '    </domain-config>',
  '</network-security-config>',
  '',
].join('\n');

/** The real `MainActivity.kt`, so the fixture starts from what ships. */
const REAL_MAIN_ACTIVITY = fs.readFileSync(path.join(REPO_ROOT, ANDROID_MAIN_ACTIVITY_PATH), 'utf8');
const SCRIM_OFF = /^.*\.isNavigationBarContrastEnforced\s*=\s*false.*$/gm;
/** The activity clearing its own window, in `onCreate`. */
const ACTIVITY_CLEAR_CALL = /^ *clearNavigationBarScrim\(window\)\n/m;
/** Every call starting the dialog walk (the activity's frames and each dialog's). */
const DIALOG_WALK_CALLS = /^ *clearDialogNavigationBarScrims\(\)\n/gm;
/** The dialog walk clearing a dialog's window. */
const DIALOG_CLEAR_CALLS = /^ *clearNavigationBarScrim\(dialogWindow\)\n/gm;
/** The window listing handing over to the walk. */
const WALK_FROM_LISTING = /^ *if \(unwatched\) watchDialogScrims\(window\.decorView\)\n/m;
/** The listing skipping a window once its dialog is watched. */
const SKIP_WATCHED = / \|\| root in scrimWatched\)/;
/** The dialog's pre-draw listener starting the walk again after clearing its window (the nested-sheet fix). */
const DIALOG_LISTENER_WALK = /(\n *matchNavigationBarToShellScheme\(dialogBars\)\n) *clearDialogNavigationBarScrims\(\)\n/;
/** The dialog's pre-draw listener clearing its window again (React Native turns the scrim back on). */
const DIALOG_LISTENER_CLEAR = /(addOnPreDrawListener \{\n) *clearNavigationBarScrim\(dialogWindow\)\n/;
/** The walk following a host into its dialog, where nested hosts live. */
const WALK_INTO_DIALOG = /^ *watchDialogScrims\(decor\)\n/m;
/** The activity's pre-draw listener matching the navigation bar's icons to the status bar's. */
const ACTIVITY_LISTENER_MATCH = /^ *matchNavigationBarToStatusBar\(activityBars\)\n/m;
/** The value `matchNavigationBarToStatusBar` gives the navigation bar: the status bar's. */
const MATCH_FROM_STATUS = /val light = bars\.isAppearanceLightStatusBars\n/;
/** The dialog's pre-draw listener putting its navigation bar in the shell's scheme, before the walk. */
const DIALOG_LISTENER_SHELL = /(\n *clearNavigationBarScrim\(dialogWindow\)\n) *matchNavigationBarToShellScheme\(dialogBars\)\n(?= *clearDialogNavigationBarScrims)/;
/** The start of `onConfigurationChanged`, where 21g's night-mode icon line sat. */
const CONFIGURATION_CHANGED = /(super\.onConfigurationChanged\(newConfig\)\n)/;
/** The scrim walk's time budget, and the clock it is read against. */
const WALK_BUDGET = /const val SCRIM_WALK_MS = \d+L/;
const WALK_CLOCK = /SystemClock\.uptimeMillis\(\)/;
/** The activity's pre-draw listener starting the walk, and the end of that listener. */
const ACTIVITY_LISTENER_WALK = /(mirrorBarAppearance\(\)\n) *clearDialogNavigationBarScrims\(\)\n( *true\n *\}\n)/;

/** `REAL_MAIN_ACTIVITY` with `pattern` replaced; throws when the pattern no longer matches, so a
 *  case can't pass vacuously after `MainActivity.kt` is reworded. */
function mainActivityWith(pattern: RegExp, replacement: string): string {
  const changed = REAL_MAIN_ACTIVITY.replace(pattern, replacement);
  if (changed === REAL_MAIN_ACTIVITY) throw new Error(`${pattern} no longer matches ${ANDROID_MAIN_ACTIVITY_PATH}`);
  return changed;
}

function writeValidFixture(root: string): void {
  writeFile(root, ANDROID_MANIFEST_PATH, VALID_MANIFEST);
  writeFile(root, ANDROID_MAIN_NETWORK_CONFIG_PATH, MAIN_NETWORK_CONFIG);
  writeFile(root, ANDROID_MAIN_ACTIVITY_PATH, REAL_MAIN_ACTIVITY);
}

export async function run(): Promise<void> {
  await test('android-project: the real Android project passes checkAndroidProject', () => {
    const findings = checkAndroidProject(REPO_ROOT);
    assert(findings.length === 0, `expected no findings in the real project, got ${JSON.stringify(findings)}`);
  });

  await test('android-project: a well-formed temp fixture passes', () => {
    const dir = makeTempDir();
    try {
      writeValidFixture(dir);
      const findings = checkAndroidProject(dir);
      assert(findings.length === 0, `expected no findings on a valid fixture, got ${JSON.stringify(findings)}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const mutationCases: readonly {
    name: string;
    file: string;
    content: () => string;
    expectFile: string;
    matches: RegExp;
  }[] = [
    {
      name: 'a VIEW intent-filter without autoVerify fails',
      file: ANDROID_MANIFEST_PATH,
      content: () => manifest({ autoVerify: false, host: '${whimWebHost}' }),
      expectFile: ANDROID_MANIFEST_PATH,
      matches: /autoVerify/,
    },
    {
      name: 'an app-link filter on an activity other than the launcher fails',
      file: ANDROID_MANIFEST_PATH,
      content: () => manifest({ autoVerify: true, host: '${whimWebHost}', linkActivity: '.LinkActivity' }),
      expectFile: ANDROID_MANIFEST_PATH,
      matches: /VIEW intent-filter/,
    },
    {
      name: 'a literal host instead of the ${whimWebHost} placeholder fails',
      file: ANDROID_MANIFEST_PATH,
      content: () => manifest({ autoVerify: true, host: 'whim.example.com' }),
      expectFile: ANDROID_MANIFEST_PATH,
      matches: /host/,
    },
    {
      name: 'a MainActivity that does not handle fontScale fails',
      file: ANDROID_MANIFEST_PATH,
      content: () => manifest({ autoVerify: true, host: '${whimWebHost}', configChanges: configChangesWithout('fontScale') }),
      expectFile: ANDROID_MANIFEST_PATH,
      matches: /configChanges must include fontScale/,
    },
    {
      name: 'a MainActivity that does not handle uiMode fails',
      file: ANDROID_MANIFEST_PATH,
      content: () => manifest({ autoVerify: true, host: '${whimWebHost}', configChanges: configChangesWithout('uiMode') }),
      expectFile: ANDROID_MANIFEST_PATH,
      matches: /configChanges must include uiMode/,
    },
    {
      name: 'a MainActivity that handles density in place fails',
      file: ANDROID_MANIFEST_PATH,
      content: () => manifest({ autoVerify: true, host: '${whimWebHost}', configChanges: `${REAL_CONFIG_CHANGES}|density` }),
      expectFile: ANDROID_MANIFEST_PATH,
      matches: /must not include density/,
    },
    {
      name: 'a MainActivity that leaves the navigation bar contrast scrim on fails',
      file: ANDROID_MAIN_ACTIVITY_PATH,
      content: () => REAL_MAIN_ACTIVITY.replace(SCRIM_OFF, ''),
      expectFile: ANDROID_MAIN_ACTIVITY_PATH,
      matches: /isNavigationBarContrastEnforced = false/,
    },
    {
      name: 'a MainActivity whose scrim-off line is commented out fails',
      file: ANDROID_MAIN_ACTIVITY_PATH,
      content: () => REAL_MAIN_ACTIVITY.replace(SCRIM_OFF, (line) => `// ${line}`),
      expectFile: ANDROID_MAIN_ACTIVITY_PATH,
      matches: /isNavigationBarContrastEnforced = false/,
    },
    {
      name: 'a MainActivity whose scrim-off line is block-commented fails',
      file: ANDROID_MAIN_ACTIVITY_PATH,
      content: () => REAL_MAIN_ACTIVITY.replace(SCRIM_OFF, (line) => `/* ${line} */`),
      expectFile: ANDROID_MAIN_ACTIVITY_PATH,
      matches: /isNavigationBarContrastEnforced = false/,
    },
    {
      name: 'a MainActivity that never clears the activity window fails (the clearing function still defined and used for dialogs)',
      file: ANDROID_MAIN_ACTIVITY_PATH,
      content: () => REAL_MAIN_ACTIVITY.replace(ACTIVITY_CLEAR_CALL, ''),
      expectFile: ANDROID_MAIN_ACTIVITY_PATH,
      matches: /onCreate must call clearNavigationBarScrim\(window\)/,
    },
    {
      name: 'a MainActivity whose activity-window clear is block-commented fails',
      file: ANDROID_MAIN_ACTIVITY_PATH,
      content: () => REAL_MAIN_ACTIVITY.replace(ACTIVITY_CLEAR_CALL, (line) => `/* ${line.trimEnd()} */\n`),
      expectFile: ANDROID_MAIN_ACTIVITY_PATH,
      matches: /onCreate must call clearNavigationBarScrim\(window\)/,
    },
    {
      name: 'a MainActivity whose activity-window clear sits in a nested block comment fails (discriminating: a stripper that ends a comment at the first */ leaves the call in)',
      file: ANDROID_MAIN_ACTIVITY_PATH,
      content: () => REAL_MAIN_ACTIVITY.replace(ACTIVITY_CLEAR_CALL, (line) => `/* /* old */ ${line.trimEnd()} */\n`),
      expectFile: ANDROID_MAIN_ACTIVITY_PATH,
      matches: /onCreate must call clearNavigationBarScrim\(window\)/,
    },
    {
      name: 'a MainActivity that never starts the dialog walk fails',
      file: ANDROID_MAIN_ACTIVITY_PATH,
      content: () => REAL_MAIN_ACTIVITY.replace(DIALOG_WALK_CALLS, ''),
      expectFile: ANDROID_MAIN_ACTIVITY_PATH,
      matches: /onCreate must add a pre-draw listener to the activity's window that calls clearDialogNavigationBarScrims/,
    },
    {
      name: 'a MainActivity whose dialog walk start is block-commented fails',
      file: ANDROID_MAIN_ACTIVITY_PATH,
      content: () => REAL_MAIN_ACTIVITY.replace(DIALOG_WALK_CALLS, (line) => `/* ${line.trimEnd()} */\n`),
      expectFile: ANDROID_MAIN_ACTIVITY_PATH,
      matches: /onCreate must add a pre-draw listener to the activity's window that calls clearDialogNavigationBarScrims/,
    },
    {
      name: 'a MainActivity whose dialog walk clears no dialog window fails',
      file: ANDROID_MAIN_ACTIVITY_PATH,
      content: () => REAL_MAIN_ACTIVITY.replace(DIALOG_CLEAR_CALLS, ''),
      expectFile: ANDROID_MAIN_ACTIVITY_PATH,
      matches: /watchDialogScrims must add a pre-draw listener to each dialog that calls clearNavigationBarScrim/,
    },
    {
      name: 'a MainActivity whose window listing never walks to the dialogs fails',
      file: ANDROID_MAIN_ACTIVITY_PATH,
      content: () => REAL_MAIN_ACTIVITY.replace(WALK_FROM_LISTING, ''),
      expectFile: ANDROID_MAIN_ACTIVITY_PATH,
      matches: /clearDialogNavigationBarScrims, listing/,
    },
    {
      name: 'a MainActivity whose listing stops walking for a window once it has listed it, watched or not, fails (a preallocated Modal\'s dialog shows before its host is in the tree)',
      file: ANDROID_MAIN_ACTIVITY_PATH,
      content: () => mainActivityWith(SKIP_WATCHED, ' || root in scrimUnwatchedChecks)'),
      expectFile: ANDROID_MAIN_ACTIVITY_PATH,
      matches: /clearDialogNavigationBarScrims must keep walking for a window until its dialog is in scrimWatched/,
    },
    {
      name: 'a MainActivity whose dialog listener no longer walks fails (the activity\'s listener still does: a sheet opened from a sheet keeps its band)',
      file: ANDROID_MAIN_ACTIVITY_PATH,
      content: () => mainActivityWith(DIALOG_LISTENER_WALK, '$1'),
      expectFile: ANDROID_MAIN_ACTIVITY_PATH,
      matches: /watchDialogScrims must add a pre-draw listener to each dialog that calls clearDialogNavigationBarScrims/,
    },
    {
      name: 'a MainActivity whose walk no longer follows a host into its dialog fails (it still recurses into children)',
      file: ANDROID_MAIN_ACTIVITY_PATH,
      content: () => mainActivityWith(WALK_INTO_DIALOG, ''),
      expectFile: ANDROID_MAIN_ACTIVITY_PATH,
      matches: /watchDialogScrims must walk on into each dialog's decor view/,
    },
    {
      name: 'a MainActivity whose dialog listener no longer clears the dialog fails (the first-show clear stays: React Native turns the scrim back on)',
      file: ANDROID_MAIN_ACTIVITY_PATH,
      content: () => mainActivityWith(DIALOG_LISTENER_CLEAR, '$1'),
      expectFile: ANDROID_MAIN_ACTIVITY_PATH,
      matches: /watchDialogScrims must add a pre-draw listener to each dialog that calls clearNavigationBarScrim/,
    },
    {
      name: 'a MainActivity that walks once in onCreate instead of before each frame fails',
      file: ANDROID_MAIN_ACTIVITY_PATH,
      content: () => mainActivityWith(ACTIVITY_LISTENER_WALK, '$1$2    clearDialogNavigationBarScrims()\n'),
      expectFile: ANDROID_MAIN_ACTIVITY_PATH,
      matches: /onCreate must add a pre-draw listener to the activity's window that calls clearDialogNavigationBarScrims/,
    },
    {
      name: 'a MainActivity whose listing walks on only for windows that are already watched fails (the inversion: `root !in scrimWatched`)',
      file: ANDROID_MAIN_ACTIVITY_PATH,
      content: () => mainActivityWith(SKIP_WATCHED, ' || root !in scrimWatched)'),
      expectFile: ANDROID_MAIN_ACTIVITY_PATH,
      matches: /clearDialogNavigationBarScrims must keep walking for a window until its dialog is in scrimWatched/,
    },
    {
      name: 'a MainActivity whose walk budget is 1 ms fails (21i\'s skip-once bug again: the walk ends before a preallocated Modal\'s host is inserted)',
      file: ANDROID_MAIN_ACTIVITY_PATH,
      content: () => mainActivityWith(WALK_BUDGET, 'const val SCRIM_WALK_MS = 1L'),
      expectFile: ANDROID_MAIN_ACTIVITY_PATH,
      matches: /must declare const val SCRIM_WALK_MS of at least 1000 ms/,
    },
    {
      name: 'a MainActivity whose walk budget sits just under the floor fails',
      file: ANDROID_MAIN_ACTIVITY_PATH,
      content: () => mainActivityWith(WALK_BUDGET, 'const val SCRIM_WALK_MS = 999L'),
      expectFile: ANDROID_MAIN_ACTIVITY_PATH,
      matches: /must declare const val SCRIM_WALK_MS of at least 1000 ms/,
    },
    {
      name: 'a MainActivity that budgets the walk by counting checks instead of the clock fails (several windows drawing spend a count in a fraction of a second)',
      file: ANDROID_MAIN_ACTIVITY_PATH,
      content: () => mainActivityWith(WALK_CLOCK, '++scrimChecks'),
      expectFile: ANDROID_MAIN_ACTIVITY_PATH,
      matches: /clearDialogNavigationBarScrims must budget each unwatched window by time/,
    },
    {
      name: 'a MainActivity whose activity listener no longer matches the navigation bar to the status bar fails (white icons on a light frame over a dark phone)',
      file: ANDROID_MAIN_ACTIVITY_PATH,
      content: () => mainActivityWith(ACTIVITY_LISTENER_MATCH, ''),
      expectFile: ANDROID_MAIN_ACTIVITY_PATH,
      matches: /onCreate must add a pre-draw listener to the activity's window that calls matchNavigationBarToStatusBar/,
    },
    {
      name: 'a MainActivity whose activity match takes the shell\'s scheme instead of the status bar\'s fails (the weaker variant: right on Home, wrong over a frame)',
      file: ANDROID_MAIN_ACTIVITY_PATH,
      content: () => mainActivityWith(MATCH_FROM_STATUS, 'val light = shellSchemeLight()\n'),
      expectFile: ANDROID_MAIN_ACTIVITY_PATH,
      matches: /must define matchNavigationBarToStatusBar, setting isAppearanceLightNavigationBars from isAppearanceLightStatusBars/,
    },
    {
      name: 'a MainActivity that sets the navigation bar\'s icons from the night mode on a configuration change fails (the 21g regression, the pre-draw match still in place)',
      file: ANDROID_MAIN_ACTIVITY_PATH,
      content: () =>
        mainActivityWith(
          CONFIGURATION_CHANGED,
          '$1    val night = (newConfig.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES\n    WindowInsetsControllerCompat(window, window.decorView).isAppearanceLightNavigationBars = !night\n',
        ),
      expectFile: ANDROID_MAIN_ACTIVITY_PATH,
      matches: /must set isAppearanceLightNavigationBars only in matchNavigationBarToStatusBar and matchNavigationBarToShellScheme/,
    },
    {
      name: 'a MainActivity whose dialog listener no longer puts the navigation bar in the shell\'s scheme fails (React Native sets it again with each prop update; the first-show call stays)',
      file: ANDROID_MAIN_ACTIVITY_PATH,
      content: () => mainActivityWith(DIALOG_LISTENER_SHELL, '$1'),
      expectFile: ANDROID_MAIN_ACTIVITY_PATH,
      matches: /watchDialogScrims must add a pre-draw listener to each dialog that calls matchNavigationBarToShellScheme/,
    },
    {
      name: 'a main config that refuses cleartext at the base fails',
      file: ANDROID_MAIN_NETWORK_CONFIG_PATH,
      content: () => MAIN_NETWORK_CONFIG_WITHOUT_CLEARTEXT,
      expectFile: ANDROID_MAIN_NETWORK_CONFIG_PATH,
      matches: /base-config/,
    },
    {
      name: 'a main config permitting cleartext to a host list only fails (discriminating: a check for any cleartext permit would pass it)',
      file: ANDROID_MAIN_NETWORK_CONFIG_PATH,
      content: () => MAIN_NETWORK_CONFIG_WITH_HOST_LIST,
      expectFile: ANDROID_MAIN_NETWORK_CONFIG_PATH,
      matches: /base-config/,
    },
    {
      name: 'a build-variant network config that would replace the main one fails',
      file: 'android/app/src/debug/res/xml/network_security_config.xml',
      content: () => MAIN_NETWORK_CONFIG_WITH_HOST_LIST,
      expectFile: 'android/app/src/debug/res/xml/network_security_config.xml',
      matches: /replace/,
    },
    {
      name: 'a main config overriding the base for one host fails',
      file: ANDROID_MAIN_NETWORK_CONFIG_PATH,
      content: () => MAIN_NETWORK_CONFIG_WITH_OVERRIDE,
      expectFile: ANDROID_MAIN_NETWORK_CONFIG_PATH,
      matches: /domain-config/,
    },
  ];

  for (const c of mutationCases) {
    await test(`android-project: ${c.name}`, () => {
      const dir = makeTempDir();
      try {
        writeValidFixture(dir);
        writeFile(dir, c.file, c.content());
        const findings = checkAndroidProject(dir);
        const hit = findings.find((f) => f.file === c.expectFile && c.matches.test(f.message));
        assert(!!hit, `expected a finding on ${c.expectFile} matching ${c.matches}, got ${JSON.stringify(findings)}`);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }
}
