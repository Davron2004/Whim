/**
 * RunTimeline — one attempt's run journal as a readable list (generation-observability, design D7;
 * `prompt-flow` "The build screen offers a details affordance into the run timeline" and "The
 * failure screen includes a what-happened timeline section").
 *
 * ONE component for both surfaces: the build screen's details view and the failure screen's
 * "what happened" section. Its props are the journal entries the CALLER already read — this
 * component never reads a store, so it can never read one on a tick — and the dev gate's verdict.
 * Every row comes from `run-timeline-view.ts`, which is where the "no raw token text, no
 * diagnostic kind/symbol/message" rule is enforced: nothing here can compose a row of its own.
 *
 * An absent or empty journal renders the modest empty note, never a fabricated run
 * (`generation-run-journal` "A journal is never a second source of truth").
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SPACING, TYPE_SCALE } from '../../sdk/theme';
import { COPY } from './copy';
import type { RunJournalEntry } from './run-journal';
import { runTimelineRows, type TimelineRow } from './run-timeline-view';
import { shellPalette } from './theme';
import { useTheme } from './theme-context';

export interface RunTimelineProps {
  /** The journal the caller read ON OPEN. `null` = there was none to read. */
  entries: readonly RunJournalEntry[] | null;
  /** The developer-diagnostics gate's verdict, decided by the caller (decision #60(c)). */
  devMode?: boolean;
}

export default function RunTimeline({ entries, devMode = false }: Readonly<RunTimelineProps>) {
  const { theme } = useTheme();
  const p = shellPalette(theme);
  const rows = runTimelineRows(entries ?? [], devMode);

  /** The stage spine reads in the text colour; everything hanging off it is secondary. */
  const rowColor = (row: TimelineRow) => (row.kind === 'stage' ? p.text : p.textMuted);

  return (
    <View style={styles.root}>
      <Text style={[TYPE_SCALE.eyebrow, { color: p.textMuted }]}>{COPY.timelineTitle}</Text>
      {rows.length === 0 ? (
        <Text style={[TYPE_SCALE.body, styles.empty, { color: p.textMuted }]}>{COPY.timelineEmpty}</Text>
      ) : (
        <ScrollView style={styles.rows} contentContainerStyle={styles.rowsContent}>
          {rows.map((row) => (
            <Text key={row.key} style={[TYPE_SCALE.body, { color: rowColor(row) }]}>
              {row.text}
            </Text>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // The list scrolls INSIDE whatever height its caller gives it (a bounded section on the failure
  // screen, the rest of the screen in the build screen's details view): both the root and the
  // scroller shrink, so a long run can never push the caller's own content off the screen.
  root: { flexShrink: 1, gap: SPACING.xs },
  empty: { marginTop: SPACING.xs },
  rows: { flexGrow: 0, flexShrink: 1 },
  rowsContent: { gap: SPACING.xs },
});
