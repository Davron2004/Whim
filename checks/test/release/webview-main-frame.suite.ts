/**
 * Source checks for webview-bridge-provenance D6 and D9: native code drops bridge posts from
 * frames other than the main frame (Android web-message listener, iOS script-message handler),
 * the debug-only force-fallback switch never reaches a release build type, and iOS refuses
 * sub-frame navigations to anything but `about:srcdoc` and `about:blank`. The library seams the
 * hooks rely on are checked in the installed react-native-webview too, so an upgrade that moves
 * them fails here instead of silently disabling a hook.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assert, test } from '../harness';
import {
  ANDROID_MAIN_APPLICATION_PATH,
  ANDROID_NETWORK_DENY_MANAGER_PATH,
  IOS_PROJECT_PATH,
  checkApplicationWiring,
  closingBraceIndex,
  lexKotlin,
  maskComments,
  methodBody,
  targetPhaseHasFile,
  type NativeNetworkDenyFinding,
} from './native-network-deny.suite';

export const ANDROID_MAIN_FRAME_WEBVIEW_PATH = 'android/app/src/main/java/com/whim/webview/MainFrameOnlyWebView.kt';
export const ANDROID_APP_GRADLE_PATH = 'android/app/build.gradle';
export const IOS_MAIN_FRAME_PATH = 'ios/Whim/WhimWebViewMainFrame.m';
export const LIBRARY_ANDROID_WEBVIEW_PATH =
  'node_modules/react-native-webview/android/src/main/java/com/reactnativecommunity/webview/RNCWebView.java';
export const LIBRARY_ANDROID_PROPERTIES_PATH = 'node_modules/react-native-webview/android/gradle.properties';
export const LIBRARY_IOS_IMPL_PATH = 'node_modules/react-native-webview/apple/RNCWebViewImpl.m';

const FORCE_SWITCH = 'WHIM_FORCE_JS_INTERFACE_BRIDGE';
/** Spec sandbox-isolation: the only documents a sub-frame may navigate to on iOS. */
const SUB_FRAME_ALLOWLIST = ['about:blank', 'about:srcdoc'];

type Finding = NativeNetworkDenyFinding;

function readRequired(root: string, relPath: string, findings: Finding[]): string {
  try {
    return fs.readFileSync(path.join(root, relPath), 'utf8');
  // eslint-disable-next-line no-restricted-syntax -- unreadable required files become named findings below
  } catch {
    findings.push({ file: relPath, message: 'required main-frame filter source is missing or unreadable' });
    return '';
  }
}

function compact(text: string): string {
  return text.replace(/\s+/g, '');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function closingParenIndex(source: string, start: number): number | undefined {
  let depth = 0;
  for (let index = start; index < source.length; index++) {
    if (source[index] === '(') depth++;
    if (source[index] === ')') depth--;
    if (depth === 0) return index;
  }
  return undefined;
}

interface Block {
  readonly start: number;
  readonly end: number;
}

/** The `{...}` block opened at the first match of `opening` (which must end at the brace). */
function blockAt(code: string, opening: RegExp, from = 0): Block | undefined {
  const match = new RegExp(opening.source, 'g');
  match.lastIndex = from;
  const found = match.exec(code);
  if (!found) return undefined;
  const start = code.indexOf('{', found.index);
  const end = closingBraceIndex(code, start);
  return end === undefined ? undefined : { start, end };
}

/** Named `name { ... }` blocks directly inside `parent` (not nested deeper). */
function childBlocks(code: string, parent: Block): Map<string, Block> {
  const children = new Map<string, Block>();
  let depth = 0;
  for (let index = parent.start + 1; index < parent.end; index++) {
    if (code[index] === '{') {
      if (depth === 0) {
        const name = code.slice(parent.start + 1, index).trimEnd().split(/\W/).pop();
        const end = closingBraceIndex(code, index);
        if (name && end !== undefined) children.set(name, { start: index, end });
      }
      depth++;
    } else if (code[index] === '}') {
      depth--;
    }
  }
  return children;
}

function inside(block: Block | undefined, index: number): boolean {
  return block !== undefined && index > block.start && index < block.end;
}

// ── Android ─────────────

function checkListener(body: string, findings: Finding[]): void {
  const file = ANDROID_MAIN_FRAME_WEBVIEW_PATH;
  const declaration = /val\s+(\w+)\s*=\s*WebViewCompat\.WebMessageListener\s*\{/.exec(body);
  if (!declaration) {
    findings.push({ file, message: 'createRNCWebViewBridge must build its own WebMessageListener' });
    return;
  }
  const listener = declaration[1];
  const braceIndex = body.indexOf('{', declaration.index);
  const end = closingBraceIndex(body, braceIndex) ?? body.length;
  const lambda = body.slice(braceIndex + 1, end);
  const arrow = lambda.indexOf('->');
  const params = arrow < 0 ? [] : lambda.slice(0, arrow).split(',').map((param) => param.trim());
  const frameFlag = params.length === 5 ? params[3] : '_';
  const statements = arrow < 0 ? '' : lambda.slice(arrow + 2).trim();
  const guard = new RegExp(`^if\\s*\\(\\s*!\\s*${escapeRegExp(frameFlag)}\\s*\\)\\s*return@WebMessageListener\\b`);
  if (frameFlag === '_' || !guard.test(statements)) {
    findings.push({ file, message: 'the listener must return before forwarding when isMainFrame is false' });
  }
  if (!/\bonMessage\s*\(/.test(statements)) {
    findings.push({ file, message: 'the listener must forward main-frame posts to onMessage' });
  }
  const register = new RegExp(
    `WebViewCompat\\.addWebMessageListener\\(\\s*webView\\s*,\\s*JAVASCRIPT_INTERFACE\\s*,[^,]*,\\s*${listener}\\s*\\)`,
  );
  if (!register.test(body)) {
    findings.push({ file, message: 'the filtering listener must be the one registered under JAVASCRIPT_INTERFACE' });
  }
  const claim = new RegExp(`\\bbridgeListener\\s*=\\s*${listener}\\b`).exec(body);
  const superCall = /super\.createRNCWebViewBridge\(\s*webView\s*\)/.exec(body);
  if (!claim || !superCall || claim.index > superCall.index || !/\bbridgeListener\s*==\s*null\b/.test(body)) {
    findings.push({
      file,
      message: 'bridgeListener must be claimed by the filtering listener before super runs, so the library registers none',
    });
  }
}

function checkAndroidWebView(source: string, findings: Finding[]): void {
  const file = ANDROID_MAIN_FRAME_WEBVIEW_PATH;
  const code = lexKotlin(source).code;
  if (!/class\s+MainFrameOnlyWebView\s*\([^)]*ThemedReactContext[^)]*\)\s*:\s*RNCWebView\s*\(\s*context\s*\)/.test(code)) {
    findings.push({ file, message: 'MainFrameOnlyWebView must subclass RNCWebView' });
  }
  const body = methodBody(code, /override\s+fun\s+createRNCWebViewBridge\s*\(\s*webView\s*:\s*RNCWebView\s*\)\s*\{/);
  if (body === undefined) {
    findings.push({ file, message: 'createRNCWebViewBridge override is missing' });
    return;
  }
  checkListener(body, findings);
  if (!/^import\s+com\.whim\.BuildConfig$/m.test(code)
      || (code.match(new RegExp(FORCE_SWITCH, 'g')) ?? []).length !== 1
      || !new RegExp(`if\\s*\\(\\s*BuildConfig\\.${FORCE_SWITCH}\\s*\\)\\s*\\{`).test(body)) {
    findings.push({ file, message: `the forced fallback must be gated by the app's BuildConfig.${FORCE_SWITCH} alone` });
  }
}

function checkAndroidManager(source: string, findings: Finding[]): void {
  const code = lexKotlin(source).code;
  const body = methodBody(code, /override\s+fun\s+createViewInstance\s*\([^)]*ThemedReactContext[^)]*\)\s*:\s*RNCWebViewWrapper\s*\{/);
  if (!body || !/val\s+wrapper\s*=\s*\w+\.createViewInstance\(\s*context\s*,\s*MainFrameOnlyWebView\(\s*context\s*\)\s*\)/.test(body)) {
    findings.push({ file: ANDROID_NETWORK_DENY_MANAGER_PATH, message: 'the manager must create every WebView as MainFrameOnlyWebView' });
  }
  if (!/RNCWebViewManagerImpl\(\s*true\s*\)/.test(code)) {
    findings.push({ file: ANDROID_NETWORK_DENY_MANAGER_PATH, message: 'the creation impl must be the new-architecture impl' });
  }
}

/** Only the debug build type may set the switch; everything else sees the defaultConfig `false`. */
function checkGradleSwitch(source: string, findings: Finding[]): void {
  const file = ANDROID_APP_GRADLE_PATH;
  const structure = lexKotlin(source).code;
  const text = maskComments(source);
  const android = blockAt(structure, /\bandroid\s*\{/);
  const children = android ? childBlocks(structure, android) : new Map<string, Block>();
  const defaultConfig = children.get('defaultConfig');
  const buildTypes = children.get('buildTypes');
  const debug = buildTypes ? childBlocks(structure, buildTypes).get('debug') : undefined;
  const uses = [...text.matchAll(new RegExp(FORCE_SWITCH, 'g'))].map((match) => match.index);
  if (uses.some((index) => !inside(defaultConfig, index) && !inside(debug, index))) {
    findings.push({ file, message: `${FORCE_SWITCH} may only appear in defaultConfig and the debug build type` });
  }
  const defaults = defaultConfig ? text.slice(defaultConfig.start, defaultConfig.end) : '';
  const defaultLine = new RegExp(`buildConfigField\\s*\\(?\\s*"boolean"\\s*,\\s*"${FORCE_SWITCH}"\\s*,\\s*"false"\\s*\\)?`);
  if (uses.filter((index) => inside(defaultConfig, index)).length !== 1 || !defaultLine.test(defaults)) {
    findings.push({ file, message: `defaultConfig must set ${FORCE_SWITCH} to "false" exactly once` });
  }
  if (!uses.some((index) => inside(debug, index))) {
    findings.push({ file, message: `the debug build type must be where ${FORCE_SWITCH} can be turned on` });
  }
  if (/\binitWith[\s(]*(?:buildTypes\.)?debug\b/.test(structure)) {
    findings.push({ file, message: 'no build type may inherit the debug build type and its switch' });
  }
}

/** MainFrameOnlyWebView compiles against the androidx.webkit react-native-webview resolves: the app
 *  reads the library's `ReactNativeWebView_webkitVersion` (as its `safeExtGet` does) and declares the
 *  dependency through it, and the fallback it keeps is the library's current value. */
function checkWebkitVersion(gradle: string, libraryProperties: string, findings: Finding[]): void {
  const file = ANDROID_APP_GRADLE_PATH;
  const text = maskComments(gradle);
  const library = libraryProperties.split('\n')
    .map((line) => line.split('=').map((part) => part.trim()))
    .find(([key]) => key === 'ReactNativeWebView_webkitVersion')?.[1];
  if (!library) {
    findings.push({ file: LIBRARY_ANDROID_PROPERTIES_PATH, message: 'react-native-webview must declare ReactNativeWebView_webkitVersion' });
    return;
  }
  const deps = [...text.matchAll(/["']androidx\.webkit:webkit:([^"']*)["']/g)].map((match) => match[1]);
  const read = new RegExp(
    `def\\s+(\\w+)\\s*=\\s*\\w+\\.getProperty\\(\\s*'ReactNativeWebView_webkitVersion'\\s*,\\s*'([^']*)'\\s*\\)`,
  ).exec(text);
  const source = /file\(\s*'(?:\.\.\/)+node_modules\/react-native-webview\/android\/gradle\.properties'\s*\)/.test(text);
  if (!read || !source || deps.length !== 1 || deps[0] !== `\${${read[1]}}`) {
    findings.push({ file, message: 'androidx.webkit must be declared once, at the version read from react-native-webview\'s gradle.properties' });
    return;
  }
  if (read[2] !== library) {
    const message = `the app's androidx.webkit fallback ${read[2]} must equal react-native-webview's ${library}`;
    findings.push({ file, message }, { file: LIBRARY_ANDROID_PROPERTIES_PATH, message });
  }
}

function checkAndroidLibrarySeam(source: string, findings: Finding[]): void {
  const code = lexKotlin(source).code;
  const body = methodBody(code, /protected\s+void\s+createRNCWebViewBridge\s*\(\s*RNCWebView\s+webView\s*\)\s*\{/);
  if (!body || !/if\s*\(\s*(?:this\.)?bridgeListener\s*==\s*null\s*\)/.test(body)) {
    findings.push({
      file: LIBRARY_ANDROID_WEBVIEW_PATH,
      message: 'react-native-webview must skip its own listener when bridgeListener is set; MainFrameOnlyWebView relies on it',
    });
  }
}

export function checkAndroidMainFrameFilter(root: string): Finding[] {
  const findings: Finding[] = [];
  const webView = readRequired(root, ANDROID_MAIN_FRAME_WEBVIEW_PATH, findings);
  const manager = readRequired(root, ANDROID_NETWORK_DENY_MANAGER_PATH, findings);
  const application = readRequired(root, ANDROID_MAIN_APPLICATION_PATH, findings);
  const gradle = readRequired(root, ANDROID_APP_GRADLE_PATH, findings);
  const library = readRequired(root, LIBRARY_ANDROID_WEBVIEW_PATH, findings);
  const libraryProperties = readRequired(root, LIBRARY_ANDROID_PROPERTIES_PATH, findings);
  checkAndroidWebView(webView, findings);
  checkAndroidManager(manager, findings);
  checkApplicationWiring(lexKotlin(application), findings);
  checkGradleSwitch(gradle, findings);
  checkWebkitVersion(gradle, libraryProperties, findings);
  checkAndroidLibrarySeam(library, findings);
  return findings;
}

// ── iOS ─────────────

interface Swizzle {
  readonly original: string;
  readonly params: string;
  readonly body: string;
}

interface IfStatement {
  readonly before: string;
  readonly condition: string;
  readonly then: string;
  readonly after: string;
}

function firstIf(body: string): IfStatement | undefined {
  const match = /\bif\s*\(/.exec(body);
  if (!match) return undefined;
  const open = body.indexOf('(', match.index);
  const close = closingParenIndex(body, open);
  if (close === undefined) return undefined;
  const brace = /^\s*\{/.exec(body.slice(close + 1));
  if (!brace) return undefined;
  const thenStart = body.indexOf('{', close);
  const thenEnd = closingBraceIndex(body, thenStart);
  if (thenEnd === undefined) return undefined;
  return {
    before: body.slice(0, match.index),
    condition: body.slice(open + 1, close),
    then: body.slice(thenStart + 1, thenEnd),
    after: body.slice(thenEnd + 1),
  };
}

/** The block-based replacements of `selector` installed in `load` through the swizzle helper. */
function swizzlesOf(load: string, helper: string, implClass: string, selector: string): Swizzle[] {
  const selectorPattern = selector.replaceAll(':', '\\s*:\\s*');
  const selectorVar = new RegExp(`SEL\\s+(\\w+)\\s*=\\s*@selector\\(\\s*${selectorPattern}\\s*\\)\\s*;`).exec(load)?.[1];
  if (!selectorVar) return [];
  const call = new RegExp(`(\\w+)\\s*=\\s*\\(\\s*\\w+\\s*\\)\\s*${helper}\\s*\\(\\s*${implClass}\\s*,\\s*${selectorVar}\\s*,\\s*\\^`, 'g');
  const swizzles: Swizzle[] = [];
  for (const match of load.matchAll(call)) {
    const paramsOpen = load.indexOf('(', match.index + match[0].length - 1);
    const paramsClose = closingParenIndex(load, paramsOpen);
    if (paramsClose === undefined) continue;
    const bodyStart = load.indexOf('{', paramsClose);
    const bodyEnd = closingBraceIndex(load, bodyStart);
    if (bodyEnd === undefined) continue;
    swizzles.push({
      original: match[1],
      params: load.slice(paramsOpen + 1, paramsClose),
      body: load.slice(bodyStart + 1, bodyEnd),
    });
  }
  return swizzles;
}

// Every handler the library registers (its bridge, its history shim) is reachable from every frame,
// so the hook's first statement drops a sub-frame's message on the frame alone: a condition that
// also names a handler would let a sub-frame through to the others.
function checkScriptMessageSwizzle(swizzle: Swizzle, findings: Finding[]): void {
  const message = /WKScriptMessage\s*\*\s*(\w+)/.exec(swizzle.params)?.[1] ?? 'message';
  const statement = firstIf(swizzle.body);
  const filters = statement !== undefined
    && !statement.before.includes(`${swizzle.original}(`)
    && compact(statement.condition) === `!${message}.frameInfo.isMainFrame`
    && compact(statement.then) === 'return;';
  if (!filters) {
    findings.push({
      file: IOS_MAIN_FRAME_PATH,
      message: 'the script-message hook must return early for every message whose frameInfo.isMainFrame is false, whatever its handler',
    });
  }
  if (!statement || !statement.after.includes(`${swizzle.original}(`)) {
    findings.push({ file: IOS_MAIN_FRAME_PATH, message: 'the script-message hook must pass main-frame messages to the original' });
  }
}

function allowlistEntries(code: string, keep: string, name: string): string[] | undefined {
  const fn = new RegExp(`static\\s+NSArray\\s*<\\s*NSString\\s*\\*\\s*>\\s*\\*\\s*${name}\\s*\\(\\s*void\\s*\\)\\s*\\{`).exec(code);
  if (!fn) return undefined;
  const start = code.indexOf('{', fn.index);
  const end = closingBraceIndex(code, start);
  if (end === undefined) return undefined;
  const literal = /^return@\[(@"[^"]*"(?:,@"[^"]*")*)\];$/.exec(compact(keep.slice(start + 1, end)));
  return literal ? [...literal[1].matchAll(/@"([^"]*)"/g)].map((entry) => entry[1]) : undefined;
}

function checkNavigationSwizzle(swizzle: Swizzle, code: string, keep: string, findings: Finding[]): void {
  const file = IOS_MAIN_FRAME_PATH;
  const handler = /\(\s*\^\s*(\w+)\s*\)\s*\(\s*WKNavigationActionPolicy\s*\)/.exec(swizzle.params)?.[1] ?? 'decisionHandler';
  const action = /WKNavigationAction\s*\*\s*(\w+)/.exec(swizzle.params)?.[1] ?? 'navigationAction';
  const frameLocal = new RegExp(`WKFrameInfo\\s*\\*\\s*(\\w+)\\s*=\\s*${action}\\.targetFrame\\s*;`).exec(swizzle.body)?.[1];
  const frames = [`${action}.targetFrame`, ...(frameLocal ? [frameLocal] : [])];
  const url = new RegExp(`NSString\\s*\\*\\s*(\\w+)\\s*=\\s*${action}\\.request\\.URL\\.absoluteString\\s*;`).exec(swizzle.body)?.[1];
  const statement = firstIf(swizzle.body);
  const condition = compact(statement?.condition ?? '');
  const framed = frames.some((frame) => condition.includes(`${frame}!=nil`) && condition.includes(`!${frame}.isMainFrame`));
  if (!statement || !framed || !condition.includes('&&') || condition.includes('||')
      || statement.before.includes(`${swizzle.original}(`) || statement.before.includes(`${handler}(`)
      || compact(statement.then) !== `${handler}(WKNavigationActionPolicyCancel);return;`) {
    findings.push({ file, message: 'the navigation hook must cancel when targetFrame exists and is not the main frame' });
  }
  const receiver = url ? new RegExp(`!\\[(\\w+)\\(\\)containsObject:${url}\\]`).exec(condition)?.[1] : undefined;
  const entries = receiver ? allowlistEntries(code, keep, receiver) : undefined;
  if (!entries || entries.length !== SUB_FRAME_ALLOWLIST.length
      || [...entries].sort((left, right) => left.localeCompare(right)).join(',') !== SUB_FRAME_ALLOWLIST.join(',')) {
    findings.push({ file, message: 'the sub-frame allowlist must hold exactly about:srcdoc and about:blank, compared as whole URLs' });
  }
  if (!statement || !new RegExp(`${swizzle.original}\\([^;]*\\b${handler}\\s*\\)\\s*;`).test(statement.after)) {
    findings.push({ file, message: 'every other navigation must go to the original with its decision handler' });
  }
}

/** The `then` text of the first `if (<condition>) { … }` in `body`, or undefined. */
function branchOf(body: string, condition: RegExp): string | undefined {
  const match = condition.exec(body);
  if (!match) return undefined;
  const start = body.indexOf('{', match.index + match[0].length - 1);
  const end = closingBraceIndex(body, start);
  return end === undefined ? undefined : body.slice(start + 1, end);
}

/** A fail-open branch stops a debug build (`NSCAssert(NO, …)` alone under `#if DEBUG`) and only logs
 *  and returns in release: a library upgrade that moves a seam breaks the first simulator run, never a
 *  user's app. */
function stopsDebugBuilds(branch: string | undefined): boolean {
  if (branch === undefined) return false;
  const lines = branch.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  const tight = lines.map((line) => compact(line));
  const at = tight.indexOf('#ifDEBUG');
  if (at < 0 || !tight[at + 1]?.startsWith('NSCAssert(NO,') || !tight[at + 1].endsWith(');') || tight[at + 2] !== '#endif') {
    return false;
  }
  const rest = [...lines.slice(0, at), ...lines.slice(at + 3)].join('\n');
  return !/\b(?:NSC?Assert|abort|assert)\s*\(/.test(rest) && /\bNSLog\s*\(/.test(rest) && /\breturn\b/.test(rest);
}

function checkIosDebugAsserts(code: string, helper: string, load: string, implClass: string, findings: Finding[]): void {
  const file = IOS_MAIN_FRAME_PATH;
  const helperBody = methodBody(code, new RegExp(`static\\s+IMP\\s+${helper}\\s*\\([^)]*\\)\\s*\\{`)) ?? '';
  const method = /Method\s+(\w+)\s*=\s*class_getInstanceMethod\s*\(/.exec(helperBody)?.[1];
  const missingSelector = method
    ? branchOf(helperBody, new RegExp(`\\bif\\s*\\(\\s*(?:!\\s*${method}|${method}\\s*==\\s*NULL)\\s*\\)\\s*\\{`))
    : undefined;
  if (!stopsDebugBuilds(missingSelector)) {
    findings.push({ file, message: 'a missing RNCWebViewImpl selector must NSCAssert under #if DEBUG, and only log and return otherwise' });
  }
  const missingClass = branchOf(load, new RegExp(`\\bif\\s*\\(\\s*(?:!\\s*${implClass}|${implClass}\\s*==\\s*Nil)\\s*\\)\\s*\\{`));
  if (!stopsDebugBuilds(missingClass)) {
    findings.push({ file, message: 'a missing RNCWebViewImpl class must NSCAssert under #if DEBUG, and only log and return otherwise' });
  }
}

function checkIosHooks(source: string, findings: Finding[]): void {
  const file = IOS_MAIN_FRAME_PATH;
  const code = lexKotlin(source).code;
  const keep = maskComments(source);
  const helper = [...code.matchAll(/static\s+IMP\s+(\w+)\s*\([^)]*\)\s*\{/g)].find((match) => {
    const body = methodBody(code.slice(match.index), /\{/) ?? '';
    return /imp_implementationWithBlock\s*\(/.test(body)
      && /\b(?:class_replaceMethod|method_setImplementation)\s*\(/.test(body);
  })?.[1];
  const loads = [...code.matchAll(/\+\s*\(void\)\s*load\s*\{/g)];
  const loadMatch = loads.length === 1 ? loads[0] : undefined;
  const loadStart = loadMatch ? code.indexOf('{', loadMatch.index) : -1;
  const loadEnd = closingBraceIndex(code, loadStart);
  const load = loadEnd === undefined ? '' : code.slice(loadStart + 1, loadEnd);
  const loadKeep = loadEnd === undefined ? '' : keep.slice(loadStart + 1, loadEnd);
  const implClass = /Class\s+(\w+)\s*=\s*NSClassFromString\(\s*@"RNCWebViewImpl"\s*\)\s*;/.exec(loadKeep)?.[1];
  if (!helper || !implClass || !/dispatch_once\s*\(/.test(load)) {
    findings.push({ file, message: 'one +load must replace RNCWebViewImpl methods once, inside dispatch_once' });
    return;
  }
  checkIosDebugAsserts(code, helper, load, implClass, findings);
  const scriptMessage = swizzlesOf(load, helper, implClass, 'userContentController:didReceiveScriptMessage:');
  if (scriptMessage.length === 1) {
    checkScriptMessageSwizzle(scriptMessage[0], findings);
  } else {
    findings.push({ file, message: 'userContentController:didReceiveScriptMessage: must be swizzled exactly once' });
  }
  const navigation = swizzlesOf(load, helper, implClass, 'webView:decidePolicyForNavigationAction:decisionHandler:');
  if (navigation.length !== 1) {
    findings.push({ file, message: 'webView:decidePolicyForNavigationAction:decisionHandler: must be swizzled exactly once' });
  } else {
    checkNavigationSwizzle(navigation[0], code, keep, findings);
  }
}

function checkIosLibrarySeam(source: string, findings: Finding[]): void {
  const code = lexKotlin(source).code;
  const start = /@implementation\s+RNCWebViewImpl\b/.exec(code);
  const end = start ? code.indexOf('@end', start.index) : -1;
  const impl = start && end > start.index ? code.slice(start.index, end) : '';
  const method = (pattern: string): boolean => new RegExp(`-\\s*\\(void\\)\\s*${pattern}`).test(impl);
  if (!method('userContentController\\s*:[^{;]*didReceiveScriptMessage\\s*:[^{;]*\\{')
      || !method('webView\\s*:[^{;]*decidePolicyForNavigationAction\\s*:[^{;]*decisionHandler\\s*:[^{;]*\\{')
      || method('webView\\s*:[^{;]*decidePolicyForNavigationAction\\s*:[^{;]*preferences\\s*:')) {
    findings.push({
      file: LIBRARY_IOS_IMPL_PATH,
      message: 'RNCWebViewImpl must implement both hooked selectors and not the preferences: navigation variant WebKit would prefer',
    });
  }
}

export function checkIosMainFrameFilter(root: string): Finding[] {
  const findings: Finding[] = [];
  const hooks = readRequired(root, IOS_MAIN_FRAME_PATH, findings);
  const pbxproj = readRequired(root, IOS_PROJECT_PATH, findings);
  const library = readRequired(root, LIBRARY_IOS_IMPL_PATH, findings);
  checkIosHooks(hooks, findings);
  try {
    if (!targetPhaseHasFile(pbxproj, 'PBXSourcesBuildPhase', 'Whim/WhimWebViewMainFrame.m')) {
      findings.push({ file: IOS_PROJECT_PATH, message: 'WhimWebViewMainFrame.m must be in the Whim Sources phase' });
    }
  // eslint-disable-next-line no-restricted-syntax -- parse errors become the stable project-level finding below
  } catch {
    findings.push({ file: IOS_PROJECT_PATH, message: 'iOS project must parse and contain the main-frame hook' });
  }
  checkIosLibrarySeam(library, findings);
  return findings;
}

// ── fixtures ─────────────

const VALID_WEBVIEW = `
package com.whim.webview
import com.whim.BuildConfig
class MainFrameOnlyWebView(context: ThemedReactContext) : RNCWebView(context) {
  override fun createRNCWebViewBridge(webView: RNCWebView) {
    if (BuildConfig.WHIM_FORCE_JS_INTERFACE_BRIDGE) {
      createForcedJavascriptInterfaceBridge()
      return
    }
    if (bridgeListener == null && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
      val listener = WebViewCompat.WebMessageListener { _, message, sourceOrigin, isMainFrame, _ ->
        if (!isMainFrame) return@WebMessageListener
        onMessage(message.data, sourceOrigin.toString())
      }
      bridgeListener = listener
      WebViewCompat.addWebMessageListener(webView, JAVASCRIPT_INTERFACE, setOf("*"), listener)
    }
    super.createRNCWebViewBridge(webView)
  }
}
`;

const VALID_MANAGER = `
package com.whim.webview
class NetworkDeniedWebViewManager : RNCWebViewManager() {
  private val creationImpl = RNCWebViewManagerImpl(true)
  override fun createViewInstance(context: ThemedReactContext): RNCWebViewWrapper {
    val wrapper = creationImpl.createViewInstance(context, MainFrameOnlyWebView(context))
    wrapper.webView.settings.blockNetworkLoads = true
    return wrapper
  }
}
`;

const VALID_APPLICATION = `
package com.whim
val packages = PackageList(this).packages.apply {
  var replacedWebViewPackages = 0
  for (index in indices) {
    if (this[index] is RNCWebViewPackage) {
      this[index] = NetworkDeniedWebViewPackage()
      replacedWebViewPackages++
    }
  }
  check(replacedWebViewPackages == 1) { "react-native-webview autolinking must provide exactly one package" }
  add(com.whim.tone.WhimTonePackage())
}
`;

const VALID_GRADLE = `
def rnWebViewProperties = new Properties()
def rnWebViewPropertiesFile = file('../../node_modules/react-native-webview/android/gradle.properties')
if (rnWebViewPropertiesFile.exists()) {
    rnWebViewPropertiesFile.withInputStream { rnWebViewProperties.load(it) }
}
def whimWebkitVersion = rnWebViewProperties.getProperty('ReactNativeWebView_webkitVersion', '1.14.0')
android {
    defaultConfig {
        // ${FORCE_SWITCH} is explained here, in a comment that must not count.
        buildConfigField "boolean", "${FORCE_SWITCH}", "false"
    }
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
            buildConfigField("boolean", "${FORCE_SWITCH}",
                project.findProperty('${FORCE_SWITCH}') == 'true' ? 'true' : 'false')
        }
        release {
            debuggable false
        }
        offline {
            initWith release
            debuggable true
        }
    }
}
dependencies {
    implementation("androidx.webkit:webkit:\${whimWebkitVersion}")
}
`;

const VALID_LIBRARY_PROPERTIES = `
ReactNativeWebView_kotlinVersion=1.6.0
ReactNativeWebView_webkitVersion=1.14.0
`;

const VALID_LIBRARY_ANDROID = `
public class RNCWebView extends WebView {
    protected void createRNCWebViewBridge(RNCWebView webView) {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)){
          if (this.bridgeListener == null) {
            this.bridgeListener = new WebViewCompat.WebMessageListener() { };
          }
        }
    }
}
`;

const VALID_IOS_HOOKS = `
static NSArray<NSString *> *WhimSubFrameNavigationAllowlist(void)
{
  return @[ @"about:srcdoc", @"about:blank" ];
}
static IMP WhimReplaceMethod(Class cls, SEL selector, id block)
{
  Method method = class_getInstanceMethod(cls, selector);
  if (method == NULL) {
    NSLog(@"WhimMainFrame: RNCWebViewImpl does not implement %@", NSStringFromSelector(selector));
#if DEBUG
    NSCAssert(NO, @"WhimMainFrame: RNCWebViewImpl does not implement %@", NSStringFromSelector(selector));
#endif
    return NULL;
  }
  IMP replaced = class_replaceMethod(cls, selector, imp_implementationWithBlock(block), method_getTypeEncoding(method));
  return replaced;
}
@implementation WhimWebViewMainFrame
+ (void)load
{
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    Class impl = NSClassFromString(@"RNCWebViewImpl");
    if (impl == Nil) {
      NSLog(@"WhimMainFrame: RNCWebViewImpl is missing");
#if DEBUG
      NSCAssert(NO, @"WhimMainFrame: RNCWebViewImpl is missing");
#endif
      return;
    }
    SEL scriptMessage = @selector(userContentController:didReceiveScriptMessage:);
    WhimOriginalScriptMessage = (WhimScriptMessageIMP)WhimReplaceMethod(
        impl, scriptMessage, ^(id webView, WKUserContentController *controller, WKScriptMessage *message) {
          if (!message.frameInfo.isMainFrame) {
            return;
          }
          WhimOriginalScriptMessage(webView, scriptMessage, controller, message);
        });
    SEL navigationPolicy = @selector(webView:decidePolicyForNavigationAction:decisionHandler:);
    WhimOriginalNavigationPolicy = (WhimNavigationPolicyIMP)WhimReplaceMethod(
        impl, navigationPolicy, ^(id webViewImpl, WKWebView *webView, WKNavigationAction *navigationAction,
                                  void (^decisionHandler)(WKNavigationActionPolicy)) {
          WKFrameInfo *targetFrame = navigationAction.targetFrame;
          NSString *url = navigationAction.request.URL.absoluteString;
          if (targetFrame != nil && !targetFrame.isMainFrame
              && ![WhimSubFrameNavigationAllowlist() containsObject:url]) {
            decisionHandler(WKNavigationActionPolicyCancel);
            return;
          }
          WhimOriginalNavigationPolicy(webViewImpl, navigationPolicy, webView, navigationAction, decisionHandler);
        });
  });
}
@end
`;

const VALID_IOS_PROJECT = `
{
  objects = {
    TARGET = { isa = PBXNativeTarget; name = Whim; buildPhases = ( SOURCES, ); };
    SOURCES = { isa = PBXSourcesBuildPhase; files = ( HOOK_BUILD, ); };
    HOOK_BUILD = { isa = PBXBuildFile; fileRef = HOOK_REF; };
    HOOK_REF = { isa = PBXFileReference; path = Whim/WhimWebViewMainFrame.m; };
  };
  rootObject = PROJECT;
}
`;

const VALID_LIBRARY_IOS = `
@implementation RNCWebViewImpl
- (void)userContentController:(WKUserContentController *)userContentController
      didReceiveScriptMessage:(WKScriptMessage *)message
{
}
- (void)                  webView:(WKWebView *)webView
  decidePolicyForNavigationAction:(WKNavigationAction *)navigationAction
                  decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler
{
}
@end
`;

const ANDROID_VALID_BY_FILE: Readonly<Record<string, string>> = {
  [ANDROID_MAIN_FRAME_WEBVIEW_PATH]: VALID_WEBVIEW,
  [ANDROID_NETWORK_DENY_MANAGER_PATH]: VALID_MANAGER,
  [ANDROID_MAIN_APPLICATION_PATH]: VALID_APPLICATION,
  [ANDROID_APP_GRADLE_PATH]: VALID_GRADLE,
  [LIBRARY_ANDROID_WEBVIEW_PATH]: VALID_LIBRARY_ANDROID,
  [LIBRARY_ANDROID_PROPERTIES_PATH]: VALID_LIBRARY_PROPERTIES,
};

const IOS_VALID_BY_FILE: Readonly<Record<string, string>> = {
  [IOS_MAIN_FRAME_PATH]: VALID_IOS_HOOKS,
  [IOS_PROJECT_PATH]: VALID_IOS_PROJECT,
  [LIBRARY_IOS_IMPL_PATH]: VALID_LIBRARY_IOS,
};

interface MutationCase {
  readonly name: string;
  readonly file: string;
  readonly mutate: (valid: string) => string;
}

function replaced(valid: string, from: string, to: string): string {
  if (!valid.includes(from)) throw new Error(`mutation anchor not found: ${from}`);
  return valid.replace(from, to);
}

const ANDROID_MUTATION_CASES: readonly MutationCase[] = [
  {
    name: 'a listener without the isMainFrame check fails',
    file: ANDROID_MAIN_FRAME_WEBVIEW_PATH,
    mutate: (valid) => replaced(valid, '        if (!isMainFrame) return@WebMessageListener\n', ''),
  },
  {
    name: 'an inverted isMainFrame check fails',
    file: ANDROID_MAIN_FRAME_WEBVIEW_PATH,
    mutate: (valid) => replaced(valid, 'if (!isMainFrame)', 'if (isMainFrame)'),
  },
  {
    name: 'forwarding before the isMainFrame check fails',
    file: ANDROID_MAIN_FRAME_WEBVIEW_PATH,
    mutate: (valid) => replaced(
      valid,
      '        if (!isMainFrame) return@WebMessageListener\n        onMessage(message.data, sourceOrigin.toString())',
      '        onMessage(message.data, sourceOrigin.toString())\n        if (!isMainFrame) return@WebMessageListener',
    ),
  },
  {
    name: 'calling super before claiming bridgeListener fails (the library would register its own listener)',
    file: ANDROID_MAIN_FRAME_WEBVIEW_PATH,
    mutate: (valid) => replaced(
      valid,
      '  override fun createRNCWebViewBridge(webView: RNCWebView) {\n',
      '  override fun createRNCWebViewBridge(webView: RNCWebView) {\n    super.createRNCWebViewBridge(webView)\n',
    ),
  },
  {
    name: 'a commented-out frame check cannot impersonate the guard',
    file: ANDROID_MAIN_FRAME_WEBVIEW_PATH,
    mutate: (valid) => replaced(valid, 'if (!isMainFrame) return@WebMessageListener', '// if (!isMainFrame) return@WebMessageListener'),
  },
  {
    name: 'a forced fallback that ignores the BuildConfig switch fails',
    file: ANDROID_MAIN_FRAME_WEBVIEW_PATH,
    mutate: (valid) => replaced(valid, `if (BuildConfig.${FORCE_SWITCH})`, 'if (true)'),
  },
  {
    name: 'a manager creating the stock WebView fails',
    file: ANDROID_NETWORK_DENY_MANAGER_PATH,
    mutate: (valid) => replaced(
      valid,
      'creationImpl.createViewInstance(context, MainFrameOnlyWebView(context))',
      'creationImpl.createViewInstance(context, RNCWebView(context))',
    ),
  },
  {
    name: 'a second RNCWebViewPackage in MainApplication fails',
    file: ANDROID_MAIN_APPLICATION_PATH,
    mutate: (valid) => replaced(valid, '  add(com.whim.tone.WhimTonePackage())', '  add(com.whim.tone.WhimTonePackage())\n  add(RNCWebViewPackage())'),
  },
  {
    name: 'enabling the switch in the release build type fails',
    file: ANDROID_APP_GRADLE_PATH,
    mutate: (valid) => replaced(
      valid,
      '            debuggable false\n',
      `            debuggable false\n            buildConfigField "boolean", "${FORCE_SWITCH}", "true"\n`,
    ),
  },
  {
    name: 'defaulting the switch to true fails',
    file: ANDROID_APP_GRADLE_PATH,
    mutate: (valid) => replaced(valid, `"${FORCE_SWITCH}", "false"`, `"${FORCE_SWITCH}", "true"`),
  },
  {
    name: 'a build type inheriting debug fails',
    file: ANDROID_APP_GRADLE_PATH,
    mutate: (valid) => replaced(valid, 'initWith release', 'initWith debug'),
  },
  {
    name: 'setting the switch for every build type fails',
    file: ANDROID_APP_GRADLE_PATH,
    mutate: (valid) => `${valid}\nandroid.buildTypes.configureEach { buildConfigField "boolean", "${FORCE_SWITCH}", "true" }\n`,
  },
  {
    name: 'a hard-coded androidx.webkit version fails',
    file: ANDROID_APP_GRADLE_PATH,
    mutate: (valid) => replaced(valid, 'webkit:${whimWebkitVersion}', 'webkit:1.14.0'),
  },
  {
    name: 'a second androidx.webkit declaration fails',
    file: ANDROID_APP_GRADLE_PATH,
    mutate: (valid) => replaced(valid, '    implementation("androidx.webkit:webkit:${whimWebkitVersion}")\n',
      '    implementation("androidx.webkit:webkit:${whimWebkitVersion}")\n    implementation("androidx.webkit:webkit:1.8.0")\n'),
  },
  {
    name: 'an androidx.webkit version not read from react-native-webview fails',
    file: ANDROID_APP_GRADLE_PATH,
    mutate: (valid) => replaced(valid, "getProperty('ReactNativeWebView_webkitVersion', '1.14.0')", "getProperty('webkit', '1.14.0')"),
  },
  {
    name: 'a stale androidx.webkit fallback fails',
    file: ANDROID_APP_GRADLE_PATH,
    mutate: (valid) => replaced(valid, "'ReactNativeWebView_webkitVersion', '1.14.0'", "'ReactNativeWebView_webkitVersion', '1.12.0'"),
  },
  {
    name: 'a library that moved to another androidx.webkit than the app’s fallback fails',
    file: LIBRARY_ANDROID_PROPERTIES_PATH,
    mutate: (valid) => replaced(valid, 'ReactNativeWebView_webkitVersion=1.14.0', 'ReactNativeWebView_webkitVersion=1.15.0'),
  },
  {
    name: 'a library that always registers its own listener fails',
    file: LIBRARY_ANDROID_WEBVIEW_PATH,
    mutate: (valid) => replaced(valid, 'if (this.bridgeListener == null)', 'if (true)'),
  },
];

const IOS_MUTATION_CASES: readonly MutationCase[] = [
  {
    name: 'an iOS hook without the isMainFrame check fails',
    file: IOS_MAIN_FRAME_PATH,
    mutate: (valid) => replaced(valid, 'if (!message.frameInfo.isMainFrame)', 'if (message == nil)'),
  },
  {
    name: 'an iOS hook narrowed to the ReactNativeWebView handler fails (the history shim stays reachable)',
    file: IOS_MAIN_FRAME_PATH,
    mutate: (valid) => replaced(valid, 'if (!message.frameInfo.isMainFrame)', 'if ([message.name isEqualToString:@"ReactNativeWebView"] && !message.frameInfo.isMainFrame)'),
  },
  {
    name: 'an iOS hook that lets a sub-frame reach the history shim fails',
    file: IOS_MAIN_FRAME_PATH,
    mutate: (valid) => replaced(valid, 'if (!message.frameInfo.isMainFrame)', 'if (!message.frameInfo.isMainFrame && ![message.name isEqualToString:@"ReactNativeHistoryShim"])'),
  },
  {
    name: 'an iOS hook that drops main-frame messages instead fails',
    file: IOS_MAIN_FRAME_PATH,
    mutate: (valid) => replaced(valid, '!message.frameInfo.isMainFrame', 'message.frameInfo.isMainFrame'),
  },
  {
    name: 'a navigation hook without the frame check fails',
    file: IOS_MAIN_FRAME_PATH,
    mutate: (valid) => replaced(valid, ' && !targetFrame.isMainFrame', ''),
  },
  {
    name: 'a navigation hook that refuses new-window requests too fails (nil target frame stays with the library)',
    file: IOS_MAIN_FRAME_PATH,
    mutate: (valid) => replaced(valid, 'targetFrame != nil && ', ''),
  },
  {
    name: 'an allowlist widened with data: fails',
    file: IOS_MAIN_FRAME_PATH,
    mutate: (valid) => replaced(valid, '@"about:blank" ]', '@"about:blank", @"data:" ]'),
  },
  {
    name: 'an allowlist replaced with data: fails',
    file: IOS_MAIN_FRAME_PATH,
    mutate: (valid) => replaced(valid, '@"about:blank" ]', '@"data:" ]'),
  },
  {
    name: 'a navigation hook that allows instead of cancelling fails',
    file: IOS_MAIN_FRAME_PATH,
    mutate: (valid) => replaced(valid, 'decisionHandler(WKNavigationActionPolicyCancel);', 'decisionHandler(WKNavigationActionPolicyAllow);'),
  },
  {
    name: 'installing the navigation hook twice fails',
    file: IOS_MAIN_FRAME_PATH,
    mutate: (valid) => replaced(
      valid,
      '  });\n}\n@end',
      '    WhimOriginalNavigationPolicy = (WhimNavigationPolicyIMP)WhimReplaceMethod(\n'
        + '        impl, navigationPolicy, ^(id a, WKWebView *b, WKNavigationAction *c, void (^d)(WKNavigationActionPolicy)) { d(WKNavigationActionPolicyAllow); });\n'
        + '  });\n}\n@end',
    ),
  },
  {
    name: 'a hook outside dispatch_once fails',
    file: IOS_MAIN_FRAME_PATH,
    mutate: (valid) => replaced(valid, 'dispatch_once(&onceToken, ^{', 'dispatch_async(dispatch_get_main_queue(), ^{'),
  },
  {
    name: 'a missing selector that only logs (no DEBUG assert) fails',
    file: IOS_MAIN_FRAME_PATH,
    mutate: (valid) => replaced(
      valid,
      '#if DEBUG\n    NSCAssert(NO, @"WhimMainFrame: RNCWebViewImpl does not implement %@", NSStringFromSelector(selector));\n#endif\n',
      '',
    ),
  },
  {
    name: 'a missing class that only logs (no DEBUG assert) fails',
    file: IOS_MAIN_FRAME_PATH,
    mutate: (valid) => replaced(valid, '#if DEBUG\n      NSCAssert(NO, @"WhimMainFrame: RNCWebViewImpl is missing");\n#endif\n', ''),
  },
  {
    name: 'a missing-selector assert outside #if DEBUG fails (a release build would crash)',
    file: IOS_MAIN_FRAME_PATH,
    mutate: (valid) => replaced(valid, '#if DEBUG\n    NSCAssert(NO, @"WhimMainFrame: RNCWebViewImpl does not implement %@", NSStringFromSelector(selector));\n#endif\n',
      '    NSCAssert(NO, @"WhimMainFrame: RNCWebViewImpl does not implement %@", NSStringFromSelector(selector));\n'),
  },
  {
    name: 'a missing class asserted under a non-DEBUG guard fails',
    file: IOS_MAIN_FRAME_PATH,
    mutate: (valid) => replaced(valid, '#if DEBUG\n      NSCAssert(NO, @"WhimMainFrame: RNCWebViewImpl is missing");', '#if 1\n      NSCAssert(NO, @"WhimMainFrame: RNCWebViewImpl is missing");'),
  },
  {
    name: 'a hook file missing from the Sources phase fails',
    file: IOS_PROJECT_PATH,
    mutate: (valid) => replaced(valid, 'files = ( HOOK_BUILD, );', 'files = ();'),
  },
  {
    name: 'a library that adopts the preferences: navigation variant fails',
    file: LIBRARY_IOS_IMPL_PATH,
    mutate: (valid) => replaced(
      valid,
      '@end',
      '- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)action\n'
        + '    preferences:(WKWebpagePreferences *)preferences decisionHandler:(void (^)(WKNavigationActionPolicy, WKWebpagePreferences *))handler\n{\n}\n@end',
    ),
  },
];

function withFixture(files: Readonly<Record<string, string>>, override: MutationCase | undefined, fn: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-webview-main-frame-'));
  try {
    for (const [relPath, content] of Object.entries(files)) {
      const abs = path.join(root, relPath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, override?.file === relPath ? override.mutate(content) : content, 'utf8');
    }
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export async function run(): Promise<void> {
  await test('webview-main-frame: the real Android wiring drops non-main-frame posts', () => {
    const findings = checkAndroidMainFrameFilter(process.cwd());
    assert(findings.length === 0, `expected no Android main-frame findings, got ${JSON.stringify(findings)}`);
  });

  await test('webview-main-frame: a complete Android fixture passes', () => {
    withFixture(ANDROID_VALID_BY_FILE, undefined, (root) => {
      const findings = checkAndroidMainFrameFilter(root);
      assert(findings.length === 0, `expected no fixture findings, got ${JSON.stringify(findings)}`);
    });
  });

  for (const c of ANDROID_MUTATION_CASES) {
    await test(`webview-main-frame: ${c.name}`, () => {
      withFixture(ANDROID_VALID_BY_FILE, c, (root) => {
        const findings = checkAndroidMainFrameFilter(root);
        assert(findings.some((finding) => finding.file === c.file), `expected a finding naming ${c.file}, got ${JSON.stringify(findings)}`);
      });
    });
  }

  await test('webview-main-frame: the real iOS wiring drops non-main-frame posts and refuses sub-frame navigations', () => {
    const findings = checkIosMainFrameFilter(process.cwd());
    assert(findings.length === 0, `expected no iOS main-frame findings, got ${JSON.stringify(findings)}`);
  });

  await test('webview-main-frame: a complete iOS fixture passes', () => {
    withFixture(IOS_VALID_BY_FILE, undefined, (root) => {
      const findings = checkIosMainFrameFilter(root);
      assert(findings.length === 0, `expected no iOS fixture findings, got ${JSON.stringify(findings)}`);
    });
  });

  for (const c of IOS_MUTATION_CASES) {
    await test(`webview-main-frame: ${c.name}`, () => {
      withFixture(IOS_VALID_BY_FILE, c, (root) => {
        const findings = checkIosMainFrameFilter(root);
        assert(findings.some((finding) => finding.file === c.file), `expected an iOS finding naming ${c.file}, got ${JSON.stringify(findings)}`);
      });
    });
  }
}
