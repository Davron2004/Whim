/**
 * Prompt-flow screens (tasks 4.2/4.3/5.2/5.3, prompt-flow-ux chain-3): static source assertions
 * for `PromptScreen`/`RewritePreviewScreen`/`GeneratingScreen`/`FailureScreen`, mirroring
 * `launch-failure-ui.suite.ts`'s idiom — these are RN components not rendered under Node, so the
 * checkable surface is the production source text against the spec's honesty/leakage
 * requirements (`specs/prompt-flow/spec.md`).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Harness } from './harness';
import { COPY } from '../copy';

function read(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'src/host/launcher', file), 'utf8');
}

/** Slices the body of a flat (no nested multi-line object literal) `export interface` block,
 *  with its `/** ... *\/` doc comments stripped — the checks below assert on the declared FIELD
 *  NAMES, not on prose that documents the very constraint being checked. */
function interfaceBody(src: string, name: string): string {
  const marker = `export interface ${name} {`;
  const start = src.indexOf(marker);
  if (start < 0) return '';
  const bodyStart = start + marker.length;
  const bodyEnd = src.indexOf('\n}', bodyStart);
  const body = src.slice(bodyStart, bodyEnd < 0 ? undefined : bodyEnd);
  return body.replace(/\/\*\*[\s\S]*?\*\//g, '');
}

export async function runPromptFlowScreensTests(h: Harness): Promise<void> {
  const promptSrc = read('PromptScreen.tsx');
  const rewriteSrc = read('RewritePreviewScreen.tsx');
  const generatingSrc = read('GeneratingScreen.tsx');
  const failureSrc = read('FailureScreen.tsx');

  await h.test('prompt-screen: submission is gated on serverConfigured, never fires when unconfigured', () => {
    h.ok(/canSubmit\s*=\s*serverConfigured\s*&&/.test(promptSrc), 'canSubmit must require serverConfigured');
    h.ok(/if \(!canSubmit\) return;/.test(promptSrc), 'submit() must bail out when canSubmit is false');
  });

  await h.test('prompt-screen: shows the honest unconfigured-server message and a way to Settings', () => {
    h.ok(promptSrc.includes('COPY.promptServerUnconfigured'), 'must render the honest unconfigured message');
    h.ok(promptSrc.includes('onOpenSettings'), 'must offer a way to Settings');
    h.ok(!/\bfetch\(/.test(promptSrc), 'must never attempt a request itself — the caller owns networking');
  });

  await h.test('prompt-screen: renders the dictation hint copy and an autofocused multiline input', () => {
    h.ok(promptSrc.includes('COPY.promptDictationHint'), 'must render the dictation hint');
    h.ok(/multiline\b/.test(promptSrc) && /autoFocus\b/.test(promptSrc), 'input must be multiline + autoFocus');
  });

  await h.test('prompt-screen: preserves the caller-supplied text (rephrase re-entry) via initialText', () => {
    h.ok(/useState\(initialText\s*\?\?\s*['"]{2}\)/.test(promptSrc), 'must seed state from initialText');
  });

  await h.test('rewrite-preview: original prompt is shown small/muted, never editable', () => {
    h.ok(rewriteSrc.includes('COPY.rewritePreviewOriginalLabel'), 'must label the original prompt');
    h.ok(/originalText.*textMuted|textMuted.*originalText/s.test(rewriteSrc) || /styles\.originalText/.test(rewriteSrc), 'original prompt text must use a muted style');
    h.ok(!/TextInput[^>]*value=\{originalPrompt\}/.test(rewriteSrc), 'the original prompt must never be the editable field');
  });

  await h.test('rewrite-preview: approving sends the CURRENT edited text, not the original rewrite response', () => {
    h.ok(/const approve = \(\) => onApprove\(text\);/.test(rewriteSrc), 'onApprove must be called with the live `text` state');
    h.ok(!/onApprove\(rewrittenPrompt\)/.test(rewriteSrc), 'must never send back the unedited rewrittenPrompt prop');
  });

  await h.test('generating-screen: props carry ONLY stage + onCancel — no token or diagnostic field', () => {
    const body = interfaceBody(generatingSrc, 'GeneratingScreenProps');
    h.ok(body.includes('stage') && body.includes('onCancel'), 'props must declare stage and onCancel');
    h.ok(!/\btoken\b/i.test(body) && !/\bdiagnostic/i.test(body), 'props must not declare a token or diagnostic field');
  });

  await h.test('generating-screen: never renders raw token text or diagnostic kind/symbol', () => {
    h.ok(!/\.kind\b/.test(generatingSrc), 'must never reference a .kind field');
    h.ok(!/\.symbol\b/.test(generatingSrc), 'must never reference a .symbol field');
    h.ok(!/token\.text/.test(generatingSrc), 'must never reference token.text');
  });

  await h.test('generating-screen: hardware back and the visible action both cancel', () => {
    h.ok(/hardwareBackPress[\s\S]{0,80}onCancel\(\)/.test(generatingSrc), 'hardware back must call onCancel');
    h.ok(/onPress=\{onCancel\}/.test(generatingSrc), 'the visible action must call onCancel');
  });

  await h.test('failure-screen: diagnostics are hint-only — never kind/symbol/message', () => {
    const body = interfaceBody(failureSrc, 'FailureScreenProps');
    h.ok(/diagnostics:\s*readonly\s*\{\s*hint:\s*string\s*\}\[\]/.test(body), 'diagnostics must be typed as readonly {hint: string}[]');
    h.ok(!/\bkind\b/.test(body) && !/\bsymbol\b/.test(body) && !/\bmessage\b/.test(body), 'props must not declare kind/symbol/message fields');
  });

  await h.test('failure-screen: renders reason and each hint, offers rephrase and dismiss', () => {
    h.ok(/\{reason\}/.test(failureSrc), 'must render the reason');
    h.ok(/item\.hint/.test(failureSrc), 'must render each diagnostic hint');
    h.ok(failureSrc.includes('COPY.failureRephrase') && failureSrc.includes('onRephrase'), 'must offer a rephrase action');
    h.ok(failureSrc.includes('COPY.failureDismiss') && failureSrc.includes('onDismiss'), 'must offer a dismiss action');
  });

  await h.test('prompt-flow screens: every new COPY string exists and is non-empty', () => {
    const keys = [
      'promptTitleNew', 'promptTitleEdit', 'promptPlaceholder', 'promptDictationHint', 'promptSubmit',
      'promptServerUnconfigured', 'promptOpenSettings', 'rewritePreviewTitle', 'rewritePreviewOriginalLabel',
      'rewritePreviewApprove', 'generatingTitle', 'generatingWaiting', 'generatingStagePlan',
      'generatingStageGenerate', 'generatingStageCheck', 'generatingStageRun', 'generatingStageRepair',
      'generatingCancel', 'failureTitle', 'failureHintsTitle', 'failureRephrase', 'failureDismiss',
    ] as const;
    for (const key of keys) {
      h.ok(typeof COPY[key] === 'string' && COPY[key].length > 0, `COPY.${key} must be a non-empty string`);
    }
  });
}
