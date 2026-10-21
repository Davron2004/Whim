/**
 * Checks the Android project's identity-independent shape: the app-link intent filter,
 * `singleTask` + portrait + the handled config changes on `MainActivity`, its opting out of the
 * navigation bar's contrast scrim, and the one network security config every build type
 * uses (specs/app-links/spec.md "The Android app verifies and delivers app links";
 * specs/native-release-config/spec.md "Store builds carry no cleartext exception" as beta-1 D20
 * amends it, "The iOS app declares its export, device and permission surface" Android portrait
 * sentence; design D4, D5). Pure text reading, no shelling out, so it runs in the Linux
 * devcontainer gate (chains.md's suite-portability rule).
 */

import fs from 'node:fs';
import path from 'node:path';

export const ANDROID_MANIFEST_PATH = 'android/app/src/main/AndroidManifest.xml';
export const ANDROID_MAIN_NETWORK_CONFIG_PATH = 'android/app/src/main/res/xml/network_security_config.xml';
export const ANDROID_MAIN_ACTIVITY_PATH = 'android/app/src/main/java/com/whim/MainActivity.kt';
const ANDROID_SOURCE_SETS_DIR = 'android/app/src';

export interface AndroidProjectFinding {
  readonly file: string;
  readonly message: string;
}

/** The file's text with XML comments removed, or `undefined` when it doesn't exist. */
function readXml(repoRoot: string, relPath: string): string | undefined {
  let text: string;
  try {
    text = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
  } catch (err) {
    if ((err as { code?: unknown }).code === 'ENOENT') return undefined;
    throw err;
  }
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

/** `.MainActivity`'s opening-tag attributes and element body, or `undefined`. */
function findMainActivity(manifest: string): { attrs: string; body: string } | undefined {
  for (const m of manifest.matchAll(/<activity\b([^>]*)>([\s\S]*?)<\/activity>/g)) {
    if (/android:name="\.MainActivity"/.test(m[1])) {
      return { attrs: m[1], body: m[2] };
    }
  }
  return undefined;
}

/** The first `<intent-filter>` in `activityBody` whose action is VIEW, or `undefined`. */
function findViewIntentFilter(activityBody: string): { attrs: string; body: string } | undefined {
  for (const m of activityBody.matchAll(/<intent-filter([^>]*)>([\s\S]*?)<\/intent-filter>/g)) {
    if (m[2].includes('android.intent.action.VIEW')) {
      return { attrs: m[1], body: m[2] };
    }
  }
  return undefined;
}

/** `MainActivity` handles a font-size change and a light/dark switch in place (MainActivity.kt
 *  re-reads both), and leaves a display-size change to Android's default, recreating it. */
function configChangesProblems(activityAttrs: string): string[] {
  const configChanges = (/android:configChanges="([^"]*)"/.exec(activityAttrs)?.[1] ?? '').split('|');
  const problems: string[] = [];
  for (const [change, why] of [
    ['fontScale', 'recreating the activity on a font-size change closes a running app and loses its state (issue #201)'],
    ['uiMode', 'recreating the activity on a light/dark switch closes a running app and loses its state'],
  ] as const) {
    if (!configChanges.includes(change)) {
      problems.push(`MainActivity's android:configChanges must include ${change}: ${why}`);
    }
  }
  if (configChanges.includes('density')) {
    problems.push(
      "MainActivity's android:configChanges must not include density: a display-size change keeps Android's default and recreates the activity, since React Native's Fabric pins the pixel density when it starts (FabricUIManagerBinding.setPixelDensity) and nothing re-lays the views out at a new density in place",
    );
  }
  return problems;
}

function checkManifest(repoRoot: string): AndroidProjectFinding[] {
  const text = readXml(repoRoot, ANDROID_MANIFEST_PATH);
  if (text === undefined) {
    return [{ file: ANDROID_MANIFEST_PATH, message: 'file not found' }];
  }
  const activity = findMainActivity(text);
  if (activity === undefined) {
    return [{ file: ANDROID_MANIFEST_PATH, message: 'no <activity android:name=".MainActivity"> found' }];
  }

  const problems: string[] = [];
  if (!/android:launchMode="singleTask"/.test(activity.attrs)) {
    problems.push('MainActivity must keep android:launchMode="singleTask"');
  }
  if (!/android:screenOrientation="portrait"/.test(activity.attrs)) {
    problems.push('MainActivity must declare android:screenOrientation="portrait"');
  }
  problems.push(...configChangesProblems(activity.attrs));

  const filter = findViewIntentFilter(activity.body);
  if (filter === undefined) {
    problems.push('MainActivity has no VIEW intent-filter for app links');
  } else {
    const required: readonly [RegExp, string][] = [
      [/<category\s+android:name="android\.intent\.category\.DEFAULT"\s*\/>/, 'the DEFAULT category'],
      [/<category\s+android:name="android\.intent\.category\.BROWSABLE"\s*\/>/, 'the BROWSABLE category'],
      [/android:scheme="https"/, 'android:scheme="https"'],
      [/android:pathPrefix="\/a\/"/, 'android:pathPrefix="/a/"'],
    ];
    if (!/android:autoVerify="true"/.test(filter.attrs)) {
      problems.push('the VIEW intent-filter must declare android:autoVerify="true"');
    }
    for (const [pattern, what] of required) {
      if (!pattern.test(filter.body)) problems.push(`the VIEW intent-filter is missing ${what}`);
    }
    if (!/android:host="\$\{whimWebHost\}"/.test(filter.body)) {
      problems.push('the VIEW intent-filter must declare android:host="${whimWebHost}", not a literal host');
    }
  }
  return problems.map((message) => ({ file: ANDROID_MANIFEST_PATH, message }));
}

/** The config every build type uses (beta-1 design D20): cleartext permitted at the base, so a user's own
 *  server on a LAN IP is reachable (a <domain> can't name an arbitrary address), and no
 *  <domain-config> overriding it. The launcher's address rule is the guard against plain http to
 *  a public host; the sandbox's CSP keeps mini-app bundles off the network either way. */
function checkMainNetworkConfig(repoRoot: string): AndroidProjectFinding[] {
  const text = readXml(repoRoot, ANDROID_MAIN_NETWORK_CONFIG_PATH);
  if (text === undefined) {
    return [{ file: ANDROID_MAIN_NETWORK_CONFIG_PATH, message: 'file not found' }];
  }
  const problems: string[] = [];
  const base = /<base-config\b([^>]*)>/.exec(text);
  if (base === null || !/cleartextTrafficPermitted\s*=\s*"true"/.test(base[1])) {
    problems.push('the network security config\'s <base-config> must set cleartextTrafficPermitted="true", so a user\'s own LAN server is reachable');
  }
  if (/<domain-config\b/.test(text)) {
    problems.push('the network security config must carry no <domain-config>: per-host rules would override the base for those hosts');
  }
  return problems.map((message) => ({ file: ANDROID_MAIN_NETWORK_CONFIG_PATH, message }));
}

/** A network security config under any other source set (`debug`, `offline`, ...) replaces main's
 *  whole file in that build type, so every build type must use main's (beta-1 design D20). */
function checkVariantNetworkConfigs(repoRoot: string): AndroidProjectFinding[] {
  const sourceSets = path.join(repoRoot, ANDROID_SOURCE_SETS_DIR);
  if (!fs.existsSync(sourceSets)) return [];
  return fs
    .readdirSync(sourceSets, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'main')
    .map((entry) => `${ANDROID_SOURCE_SETS_DIR}/${entry.name}/res/xml/network_security_config.xml`)
    .filter((file) => fs.existsSync(path.join(repoRoot, file)))
    .map((file) => ({ file, message: `a build-variant network security config would replace ${ANDROID_MAIN_NETWORK_CONFIG_PATH} in that build type; delete it` }));
}

/** The index past the block comment opening at `start`, nested as Kotlin nests them. */
function blockCommentEnd(text: string, start: number): number {
  let depth = 0;
  let i = start;
  do {
    if (text.startsWith('/*', i)) {
      depth += 1;
      i += 2;
    } else if (text.startsWith('*/', i)) {
      depth -= 1;
      i += 2;
    } else {
      i += 1;
    }
  } while (depth > 0 && i < text.length);
  return i;
}

/** The index past the string or character literal opening at `start`. */
function literalEnd(text: string, start: number): number {
  if (text.startsWith('"""', start)) {
    const close = text.indexOf('"""', start + 3);
    return close === -1 ? text.length : close + 3;
  }
  const quote = text[start];
  let i = start + 1;
  while (i < text.length && text[i] !== quote && text[i] !== '\n') i += text[i] === '\\' ? 2 : 1;
  return i + 1;
}

/** Kotlin source with its comments removed (line and block, nested as Kotlin nests them) and its
 *  string and character literals emptied, so a commented-out call doesn't count and a brace inside
 *  a string can't unbalance a body. A plain scan, no backtracking regexes. String templates aren't
 *  parsed: a string nested in a template (`"${f("/*")}"`) ends the outer literal early, so what
 *  follows reads as code or a comment; that can only drop code, so the check fails closed. */
function kotlinCode(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('//', i)) {
      const lineEnd = text.indexOf('\n', i);
      i = lineEnd === -1 ? text.length : lineEnd;
    } else if (text.startsWith('/*', i)) {
      i = blockCommentEnd(text, i);
      out += ' ';
    } else if (text[i] === '"' || text[i] === "'") {
      i = literalEnd(text, i);
      out += '""';
    } else {
      out += text[i];
      i += 1;
    }
  }
  return out;
}

/** The index of the bracket closing the one at `open`, or `undefined`. */
function closingBracket(code: string, open: number): number | undefined {
  const opener = code[open];
  const closer = opener === '(' ? ')' : '}';
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === opener) depth += 1;
    else if (code[i] === closer) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return undefined;
}

/** The block body of the function `name`, or `undefined` when it has none. */
function kotlinFunction(code: string, name: string): { body: string } | undefined {
  const declaration = new RegExp(`\\bfun ${name}\\(`).exec(code);
  if (declaration === null) return undefined;
  const params = closingBracket(code, declaration.index + declaration[0].length - 1);
  if (params === undefined) return undefined;
  for (let i = params + 1; i < code.length; i += 1) {
    if (code[i] === '=') return undefined;
    if (code[i] === '{') {
      const end = closingBracket(code, i);
      return end === undefined ? undefined : { body: code.slice(i, end + 1) };
    }
  }
  return undefined;
}

/** The bodies of the `addOnPreDrawListener { … }` lambdas in `body`, and `body` with them blanked. */
function preDrawListeners(body: string): { lambdas: string[]; rest: string } {
  const lambdas: string[] = [];
  let rest = '';
  let from = 0;
  const opener = /\.addOnPreDrawListener\s*\{/g;
  for (let found = opener.exec(body); found !== null; found = opener.exec(body)) {
    const open = found.index + found[0].length - 1;
    const close = closingBracket(body, open);
    if (close === undefined) break;
    lambdas.push(body.slice(open, close + 1));
    rest += body.slice(from, open);
    from = close + 1;
    opener.lastIndex = from;
  }
  return { lambdas, rest: rest + body.slice(from) };
}

/** `MainActivity` turns off the contrast scrim Android draws under a transparent 3-button
 *  navigation bar, which React Native's edge to edge turns on for the activity and for every
 *  Modal's dialog: without it a lighter band (darker in dark) sits under every page's `bg` and every
 *  sheet. So the clearing function must exist, the activity must clear its own window as it is
 *  created, and the dialog walk must run before each of the activity's frames (its pre-draw
 *  listener), follow each host into its dialog (where nested hosts live), and give each dialog a
 *  pre-draw listener that clears the dialog's window and runs the walk again (a sheet opened from a
 *  sheet). The listing must skip a window only once its dialog is watched (`scrimWatched`, or a
 *  frame budget): a window merely seen once may be a preallocated Modal's dialog whose host isn't in
 *  the tree yet. Each call is looked for where it must sit, not anywhere in the function. Comments
 *  are dropped, so a commented-out call fails. */
function checkNavigationBarScrim(repoRoot: string): AndroidProjectFinding[] {
  let text: string;
  try {
    text = fs.readFileSync(path.join(repoRoot, ANDROID_MAIN_ACTIVITY_PATH), 'utf8');
  } catch (err) {
    if ((err as { code?: unknown }).code === 'ENOENT') return [{ file: ANDROID_MAIN_ACTIVITY_PATH, message: 'file not found' }];
    throw err;
  }
  const code = kotlinCode(text);
  const problems: string[] = [];
  const clear = kotlinFunction(code, 'clearNavigationBarScrim');
  if (clear === undefined || !/\.isNavigationBarContrastEnforced\s*=\s*false\b/.test(clear.body)) {
    problems.push('MainActivity must define clearNavigationBarScrim(window), setting isNavigationBarContrastEnforced = false: with 3-button navigation Android otherwise draws a contrast band under the page');
  }
  const onCreate = kotlinFunction(code, 'onCreate');
  if (onCreate === undefined || !/\bclearNavigationBarScrim\(window\)/.test(onCreate.body)) {
    problems.push('MainActivity.onCreate must call clearNavigationBarScrim(window): React Native turns the activity\'s scrim on as it starts');
  }
  const activityListeners = onCreate === undefined ? [] : preDrawListeners(onCreate.body).lambdas;
  if (!activityListeners.some((lambda) => /\bclearDialogNavigationBarScrims\(/.test(lambda))) {
    problems.push('MainActivity.onCreate must add a pre-draw listener to the activity\'s window that calls clearDialogNavigationBarScrims, or a dialog shown after the first frame keeps its scrim');
  }
  const watch = kotlinFunction(code, 'watchDialogScrims');
  const dialogListeners = watch === undefined ? { lambdas: [], rest: '' } : preDrawListeners(watch.body);
  if (!dialogListeners.lambdas.some((lambda) => /\bclearNavigationBarScrim\(/.test(lambda))) {
    problems.push('MainActivity.watchDialogScrims must add a pre-draw listener to each dialog that calls clearNavigationBarScrim on the dialog\'s window: React Native turns a dialog\'s scrim on each time it applies the Modal\'s props');
  }
  if (!dialogListeners.lambdas.some((lambda) => /\bclearDialogNavigationBarScrims\(/.test(lambda))) {
    problems.push('MainActivity.watchDialogScrims must add a pre-draw listener to each dialog that calls clearDialogNavigationBarScrims: a sheet opened from a sheet shows over the first, never before an activity frame');
  }
  const decorNames = [...dialogListeners.rest.matchAll(/\bval (\w+)\s*=\s*[\w.?]*\.decorView\b/g)].map((m) => m[1]);
  const intoDialog = [...dialogListeners.rest.matchAll(/\bwatchDialogScrims\(([\w.?]+)\)/g)].some(
    ([, arg]) => decorNames.includes(arg) || /\.decorView$/.test(arg),
  );
  if (!intoDialog) {
    problems.push('MainActivity.watchDialogScrims must walk on into each dialog\'s decor view: a Modal inside another\'s content has its host there');
  }
  const dialogs = kotlinFunction(code, 'clearDialogNavigationBarScrims');
  if (dialogs === undefined || !/\bwatchDialogScrims\(/.test(dialogs.body)) {
    problems.push('MainActivity must define clearDialogNavigationBarScrims, listing the activity\'s windows and calling watchDialogScrims while one is unwatched');
  }
  if (dialogs !== undefined && !/\broot\s+!?in\s+scrimWatched\b|\bscrimWatched\.containsKey\(\s*root\s*\)/.test(dialogs.body)) {
    problems.push('MainActivity.clearDialogNavigationBarScrims must keep walking for a window until its dialog is in scrimWatched (or its frame budget is spent), never stop once it has listed it: React Native can show a preallocated Modal\'s dialog frames before its host is in the tree');
  }
  return problems.map((message) => ({ file: ANDROID_MAIN_ACTIVITY_PATH, message }));
}

/** Every finding across the manifest, MainActivity and the network security configs. Empty means the project passes. */
export function checkAndroidProject(repoRoot: string): AndroidProjectFinding[] {
  return [
    ...checkManifest(repoRoot),
    ...checkNavigationBarScrim(repoRoot),
    ...checkMainNetworkConfig(repoRoot),
    ...checkVariantNetworkConfigs(repoRoot),
  ];
}
