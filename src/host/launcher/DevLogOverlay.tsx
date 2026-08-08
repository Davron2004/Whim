// ─────────────────────────────────────────────────────────────────────────────
// DevLogOverlay — the in-app dev log viewer (obs-v1, design D5, host-observability "The dev log
// overlay reads the ring buffer and cannot reach a shipping build").
// ─────────────────────────────────────────────────────────────────────────────
// Stock `View`/`Text`/`FlatList` over the ring buffer's snapshot: newest-first, one row per record
// (time, level, channel, message, structured fields), filterable by channel and by minimum level.
// No third-party overlay package. Everything that can be wrong about the ordering, the filtering
// and the gate lives in `dev-log-view.ts`, which the Node suite exercises directly.
//
// THE GATE IS IN THIS COMPONENT, not only in whoever renders it: with `__DEV__` false and the
// build-time flag false, it returns null, so no route reaches the overlay in a shipping build.
//
// This is a developer surface, like `DevProbeScreen` — its labels are mechanism words and are
// deliberately NOT in `copy.ts`, which is the product surface's table.
import React, { useEffect, useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RADIUS, SPACING, TYPE_SCALE } from '../../sdk/theme';
// `@whim/contract` is a TYPE-ONLY import (design D6) — importing the zod schema VALUES would pull
// zod into the Metro graph. `import type` erases the statement entirely, so nothing crosses.
import type { DevLogRecord } from '@whim/contract';
import type { LogLevel } from '../logging';
import { LEVELS, log } from '../logging';
import type { LogRing } from '../logging/ring-buffer';
import { ALL_CHANNELS } from '../logging/channels';
import type { Channel } from '../logging/channels';
import {
  ALL_CHANNELS_FILTER,
  DEFAULT_DEV_LOG_FILTER,
  devLogOverlayEnabled,
  formatFields,
  formatRecordTime,
  visibleRecords,
} from './dev-log-view';
import { shellPalette } from './theme';
import { useTheme } from './theme-context';

const LABELS = { title: 'Logs', close: 'Close', empty: 'Nothing logged yet', all: 'all' } as const;

export interface DevLogOverlayProps {
  visible: boolean;
  onClose: () => void;
  /** The ring buffer to read; defaults to the app seam's. */
  buffer?: LogRing;
}

export default function DevLogOverlay({ visible, onClose, buffer = log.buffer }: Readonly<DevLogOverlayProps>) {
  const { theme } = useTheme();
  const p = shellPalette(theme);
  const [channel, setChannel] = useState<Channel | typeof ALL_CHANNELS_FILTER>(DEFAULT_DEV_LOG_FILTER.channel);
  const [minLevel, setMinLevel] = useState<LogLevel>(DEFAULT_DEV_LOG_FILTER.minLevel);
  const [snapshot, setSnapshot] = useState<readonly DevLogRecord[]>([]);

  // Re-read on open: the buffer is a live ring, and a snapshot taken once at mount would go stale.
  useEffect(() => {
    if (visible) setSnapshot(buffer.snapshot());
  }, [visible, buffer]);

  if (!devLogOverlayEnabled(__DEV__)) return null;

  const rows = visibleRecords(snapshot, { channel, minLevel });

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: p.bg }]}>
        <View style={styles.header}>
          <Text style={[TYPE_SCALE.screenTitle, { color: p.text }]}>{LABELS.title}</Text>
          <TouchableOpacity onPress={onClose} accessibilityRole="button">
            <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.accent }]}>{LABELS.close}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.filters}>
          <Pill label={LABELS.all} on={channel === ALL_CHANNELS_FILTER} palette={p} onPress={() => setChannel(ALL_CHANNELS_FILTER)} />
          {ALL_CHANNELS.map(name => (
            <Pill key={name} label={name} on={channel === name} palette={p} onPress={() => setChannel(name)} />
          ))}
        </View>
        <View style={styles.filters}>
          {LEVELS.map(level => (
            <Pill key={level} label={level} on={minLevel === level} palette={p} onPress={() => setMinLevel(level)} />
          ))}
        </View>

        <FlatList
          data={rows}
          keyExtractor={(item, index) => `${item.at}:${index}`}
          ListEmptyComponent={<Text style={[TYPE_SCALE.body, { color: p.textMuted }]}>{LABELS.empty}</Text>}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <Row record={item} textColor={p.text} metaColor={p.textMuted} />}
        />
      </View>
    </Modal>
  );
}

function Row({ record, textColor, metaColor }: Readonly<{ record: DevLogRecord; textColor: string; metaColor: string }>) {
  const fields = formatFields(record.fields);
  return (
    <View style={styles.row}>
      <Text style={[TYPE_SCALE.metaPlain, { color: metaColor }]}>
        {`${formatRecordTime(record.at)}  ${record.level}  ${record.channel}`}
      </Text>
      <Text style={[TYPE_SCALE.body, { color: textColor }]}>{record.message}</Text>
      {fields.length > 0 && <Text style={[TYPE_SCALE.caption, { color: metaColor }]}>{fields}</Text>}
    </View>
  );
}

function Pill({ label, on, palette, onPress }: Readonly<{ label: string; on: boolean; palette: { accent: string; card: string; cardBorder: string; onAccent: string; textMuted: string }; onPress: () => void }>) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      style={[styles.pill, { backgroundColor: on ? palette.accent : palette.card, borderColor: palette.cardBorder }]}
    >
      <Text style={[TYPE_SCALE.metaWide, { color: on ? palette.onAccent : palette.textMuted }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: SPACING.md, paddingTop: SPACING.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginTop: SPACING.xs },
  pill: { borderWidth: 1, borderRadius: RADIUS.chip, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs },
  list: { paddingVertical: SPACING.md, gap: SPACING.sm },
  row: { gap: SPACING.xs },
});
