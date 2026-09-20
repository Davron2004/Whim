/**
 * ServiceNotice — the one refusal notice every gated step and the failure screen render
 * (design D12; spec `service-refusals` "The notice shows the server's hint and nothing
 * technical").
 *
 * Plain `Text`, never `WhimProse`: the hint is neither COPY nor user/agent prose, so the shared
 * renderer never gets a chance to mark it up. Tokens only — `SHELL_PALETTE` and the SDK type
 * scale/spacing/radius — no hex literal, no numeric font-size or radius literal.
 */
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RADIUS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import { noticeExpiredAt, retryWindowState } from './refusal-landing';
import { retryLine } from './service-refusal';
import { SHELL_PALETTE } from './theme';

export interface ServiceNoticeProps {
  /** The refusal's own `hint`, verbatim — never a status code, error identifier, `Retry-After`
   *  value, or transport message. */
  hint: string;
  /** The re-enable moment (epoch ms), or absent when the refusal carried no `Retry-After`. The
   *  retry-window line is derived from this FRESH on every render (`retryLine`, below) — never a
   *  caption computed once and passed in, which would go stale the moment the window ends. */
  retryAt?: number;
  /** `danger` for a refusal about the user's own text (content/size); `neutral` for an
   *  availability or limit refusal — `service-refusal.ts#REFUSAL_RULES` decides which. */
  tone: 'danger' | 'neutral';
}

/** Alpha suffixes composing the danger tone out of `SHELL_PALETTE.danger` alone (RN 8-digit hex),
 *  the same idiom `FailureScreen.tsx`'s tinted panel already uses — never a second hex literal. */
const DANGER_FILL_ALPHA = '14';
const DANGER_BORDER_ALPHA = '3d';

/** The one place this component builds a local-time formatter — `retryLine`'s same-day/tomorrow
 *  phrasing (design D11) reads through it. */
function formatLocalTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

export default function ServiceNotice({ hint, retryAt, tone }: Readonly<ServiceNoticeProps>) {
  const p = SHELL_PALETTE;
  const danger = tone === 'danger';
  // Read fresh at render time, never cached on the notice: the same render that `useRetryGate`'s
  // one-shot re-render fires once the window ends picks this back up too, so "shortly" replaces a
  // stale "in about N minutes" instead of the caption sitting there unchanged.
  const line = retryAt !== undefined ? retryLine(retryAt, Date.now(), formatLocalTime) : undefined;
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
      {line != null && <Text style={[TYPE_SCALE.caption, styles.retryLine, { color: p.textMuted }]}>{line}</Text>}
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

/**
 * Clears a sender-landing (`neutral`-tone) notice the instant its retry window ends (design D12:
 * "A sender refusal clears when its window ends"). A `danger`-tone (text-landing) notice never
 * clears this way — that one clears only on the next edit to the refused text
 * (`composeTextChanged`/`updatePlanRow`). The decision is the pure, tested `noticeExpiredAt`
 * (`refusal-landing.ts`); this hook is only the live wiring around it, arming at most ONE timer —
 * same discipline as `useRetryGate` — and re-arming only when `tone`/`retryAt` actually change, so
 * an unrelated re-render never resets the countdown. `onExpire` is read through a ref that a
 * plain (no-deps) effect keeps current, so the timer always calls the LATEST closure — the one
 * that still knows which notice it was armed for — without that forcing the timer itself to
 * restart on every render.
 */
export function useNoticeWindowClear(
  notice: { readonly tone: 'danger' | 'neutral'; readonly retryAt?: number } | undefined,
  onExpire: () => void,
): void {
  const latestExpire = useRef(onExpire);
  useEffect(() => {
    latestExpire.current = onExpire;
  });
  const tone = notice?.tone;
  const retryAt = notice?.retryAt;
  useEffect(() => {
    if (tone !== 'neutral' || retryAt === undefined) return undefined;
    if (noticeExpiredAt({ tone, retryAt }, Date.now())) {
      latestExpire.current();
      return undefined;
    }
    const timer = setTimeout(() => latestExpire.current(), retryWindowState(retryAt, Date.now()).msUntilEnable);
    return () => clearTimeout(timer);
  }, [tone, retryAt]);
}

const styles = StyleSheet.create({
  // `marginHorizontal` matches `flow-chrome.tsx#PrimaryAction`'s own inset — this notice sits
  // directly above that action, outside the step's own scroll content, so it needs the same
  // horizontal margin rather than inheriting one from a scroll container's padding.
  notice: { borderWidth: 1, borderRadius: RADIUS.card, padding: SPACING.md, marginHorizontal: SPACING.lg, marginTop: SPACING.md },
  retryLine: { marginTop: SPACING.xs },
});
