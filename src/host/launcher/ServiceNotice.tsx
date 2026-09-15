/**
 * ServiceNotice — the one refusal notice every gated step and the failure screen render
 * (design D12; spec `service-refusals` "The notice shows the server's hint and nothing
 * technical").
 *
 * Plain `Text`, never `WhimProse`: the hint is neither COPY nor user/agent prose, so the shared
 * renderer never gets a chance to mark it up. Tokens only — `SHELL_PALETTE` and the SDK type
 * scale/spacing/radius — no hex literal, no numeric font-size or radius literal.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RADIUS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import { retryWindowState } from './refusal-landing';
import { SHELL_PALETTE } from './theme';

export interface ServiceNoticeProps {
  /** The refusal's own `hint`, verbatim — never a status code, error identifier, `Retry-After`
   *  value, or transport message. */
  hint: string;
  /** The copy-table retry-window line (`service-refusal.ts#retryLine`), precomputed by the
   *  caller at the moment the notice was created. Absent renders no second line. */
  retryLine?: string;
  /** `danger` for a refusal about the user's own text (content/size); `neutral` for an
   *  availability or limit refusal — `service-refusal.ts#REFUSAL_RULES` decides which. */
  tone: 'danger' | 'neutral';
}

/** Alpha suffixes composing the danger tone out of `SHELL_PALETTE.danger` alone (RN 8-digit hex),
 *  the same idiom `FailureScreen.tsx`'s tinted panel already uses — never a second hex literal. */
const DANGER_FILL_ALPHA = '14';
const DANGER_BORDER_ALPHA = '3d';

export default function ServiceNotice({ hint, retryLine, tone }: Readonly<ServiceNoticeProps>) {
  const p = SHELL_PALETTE;
  const danger = tone === 'danger';
  return (
    <View
      style={[
        styles.notice,
        danger
          ? { backgroundColor: p.danger + DANGER_FILL_ALPHA, borderColor: p.danger + DANGER_BORDER_ALPHA }
          : { backgroundColor: p.card, borderColor: p.cardBorder },
      ]}
    >
      <Text style={[TYPE_SCALE.body, { color: danger ? p.danger : p.text }]}>{hint}</Text>
      {retryLine != null && (
        <Text style={[TYPE_SCALE.caption, styles.retryLine, { color: p.textMuted }]}>{retryLine}</Text>
      )}
    </View>
  );
}

/**
 * The retry-window's live gate (design D11: "the primary action is disabled with its label kept,
 * and a single `setTimeout` re-enables it; nothing is sent automatically"). `retryAt` is read
 * once per mount/change; the ONE timer this sets re-renders exactly once, when the window lifts —
 * never a ticking countdown, and never a request of its own.
 */
export function useRetryGate(retryAt: number | undefined): boolean {
  const [, forceRecheck] = useState(0);
  useEffect(() => {
    if (retryAt === undefined) return undefined;
    const state = retryWindowState(retryAt, Date.now());
    if (!state.disabled) return undefined;
    const timer = setTimeout(() => forceRecheck((n) => n + 1), state.msUntilEnable);
    return () => clearTimeout(timer);
  }, [retryAt]);
  return retryAt !== undefined && retryWindowState(retryAt, Date.now()).disabled;
}

const styles = StyleSheet.create({
  // `marginHorizontal` matches `flow-chrome.tsx#PrimaryAction`'s own inset — this notice sits
  // directly above that action, outside the step's own scroll content, so it needs the same
  // horizontal margin rather than inheriting one from a scroll container's padding.
  notice: { borderWidth: 1, borderRadius: RADIUS.card, padding: SPACING.md, marginHorizontal: SPACING.lg, marginTop: SPACING.md },
  retryLine: { marginTop: SPACING.xs },
});
