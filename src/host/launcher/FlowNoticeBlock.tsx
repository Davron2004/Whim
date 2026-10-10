/**
 * FlowNoticeBlock — a service refusal's notice on a making-sheet page (design D12; spec
 * `service-refusals` "The notice shows the server's hint and nothing technical"), drawn with the
 * shell's `Notice`. The retry line is derived FRESH on every render from the refusal's `retryAt`,
 * never cached, so it cannot go stale the moment the window ends (`useRetryGate` re-renders once
 * when it does).
 */
import React from 'react';
import { Notice } from '../ui/Notice';
import type { FlowNotice } from './prompt-flow';
import { retryLine } from './service-refusal';

/** Local time as the phone writes it: the retry line's "at 3:05 PM". */
function formatLocalTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

export function FlowNoticeBlock({ notice }: Readonly<{ notice: FlowNotice }>) {
  const countdown = notice.retryAt === undefined ? undefined : retryLine(notice.retryAt, Date.now(), formatLocalTime);
  return <Notice message={notice.hint} tone={notice.tone} countdown={countdown} />;
}
