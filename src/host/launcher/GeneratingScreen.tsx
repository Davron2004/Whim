// ─────────────────────────────────────────────────────────────────────────────
// GeneratingScreen — generation progress, shown without exposing internals
// (prompt-flow-ux, design D1, spec "Generation progress is shown without exposing internals").
// ─────────────────────────────────────────────────────────────────────────────
// A full-screen sibling of the other launcher screens: `shellPalette(theme)`, own hardware-back
// binding (routed to `onCancel`, per the spec's "leaving generation cancels cleanly"
// requirement — the abort wiring itself lives in `LauncherRoot`, this screen only signals the
// intent), every string from `copy.ts`. STAGE-ONLY BY CONSTRUCTION: this component's props carry
// only `stage` (from `GenerationEvent['stage']`) — never a `token` event's text nor a
// `diagnostic`'s `kind`/`symbol`. There is nothing here to leak because nothing here is passed.
import React, { useEffect } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { GenerationEvent } from '@whim/contract';
import { COPY } from './copy';
import { shellPalette } from './theme';
import { useTheme } from './theme-context';

/** The `stage` event's `stage` field. `GenerationEvent` is a discriminated union (only the
 *  `type: 'stage'` member carries `stage`), so this narrows via `Extract` rather than indexing
 *  the union directly. */
type Stage = Extract<GenerationEvent, { type: 'stage' }>['stage'];

export interface GeneratingScreenProps {
  /** The current stage from the latest `stage` event, or `null` before the first one arrives. */
  stage: Stage | null;
  /** Cancels the in-flight generation — hardware back and the visible action both call this. */
  onCancel: () => void;
}

const STAGE_LABEL: Record<Stage, string> = {
  plan: COPY.generatingStagePlan,
  generate: COPY.generatingStageGenerate,
  check: COPY.generatingStageCheck,
  run: COPY.generatingStageRun,
  repair: COPY.generatingStageRepair,
};

export default function GeneratingScreen({ stage, onCancel }: Readonly<GeneratingScreenProps>) {
  const { theme } = useTheme();
  const p = shellPalette(theme);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onCancel();
      return true;
    });
    return () => sub.remove();
  }, [onCancel]);

  const stageLabel = stage ? STAGE_LABEL[stage] : COPY.generatingWaiting;

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <View style={styles.content}>
        <ActivityIndicator size="large" color={p.accent} />
        <Text style={[styles.title, { color: p.text }]}>{COPY.generatingTitle}</Text>
        <Text style={[styles.stage, { color: p.textMuted }]}>{stageLabel}</Text>
      </View>

      <TouchableOpacity onPress={onCancel} style={[styles.cancel, { borderColor: p.cardBorder }]}>
        <Text style={[styles.cancelText, { color: p.textMuted }]}>{COPY.generatingCancel}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  title: { fontSize: 18, fontWeight: '800', marginTop: 20 },
  stage: { fontSize: 14, marginTop: 8 },
  cancel: { margin: 16, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontSize: 15, fontWeight: '700' },
});
