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
import { FlatList, Modal, TouchableOpacity, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { RADII, SPACE } from '../../design/tokens';
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
import { Text } from '../ui/Text';
import { useTokens } from '../ui/tokens';
import { makeStyles } from '../ui/tokens-pure';

const LABELS = { title: 'Logs', close: 'Close', empty: 'Nothing logged yet', all: 'all' } as const;

export interface DevLogOverlayProps {
  visible: boolean;
  onClose: () => void;
  /** The ring buffer to read; defaults to the app seam's. */
  buffer?: LogRing;
}

export default function DevLogOverlay({ visible, onClose, buffer = log.buffer }: Readonly<DevLogOverlayProps>) {
  const s = styles(useTokens());
  const [channel, setChannel] = useState<Channel | typeof ALL_CHANNELS_FILTER>(DEFAULT_DEV_LOG_FILTER.channel);
  const [minLevel, setMinLevel] = useState<LogLevel>(DEFAULT_DEV_LOG_FILTER.minLevel);
  const [snapshot, setSnapshot] = useState<readonly DevLogRecord[]>([]);

  // Re-read on open: the buffer is a live ring, and a snapshot taken once at mount would go stale.
  useEffect(() => {
    if (visible) setSnapshot(buffer.snapshot());
  }, [visible, buffer]);

  if (!devLogOverlayEnabled(__DEV__)) return null;

  const rows = visibleRecords(snapshot, { channel, minLevel });

  // Like the `Sheet`'s `OverlayModal`: the Modal's window draws under both system bars on every
  // Android version (Whim draws edge to edge), so the overlay keeps clear of them with that
  // window's own insets.
  return (
    <Modal visible={visible} animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <SafeAreaProvider>
        <InsetFrame>
            <View style={s.header}>
              <Text type="title2">{LABELS.title}</Text>
              <TouchableOpacity onPress={onClose} accessibilityRole="button">
                <Text type="headline">{LABELS.close}</Text>
              </TouchableOpacity>
            </View>

            <View style={s.filters}>
              <Pill label={LABELS.all} on={channel === ALL_CHANNELS_FILTER} onPress={() => setChannel(ALL_CHANNELS_FILTER)} />
              {ALL_CHANNELS.map(name => (
                <Pill key={name} label={name} on={channel === name} onPress={() => setChannel(name)} />
              ))}
            </View>
            <View style={s.filters}>
              {LEVELS.map(level => (
                <Pill key={level} label={level} on={minLevel === level} onPress={() => setMinLevel(level)} />
              ))}
            </View>

            <FlatList
              data={rows}
              keyExtractor={(item, index) => `${item.at}:${index}`}
              ListEmptyComponent={<Text color="text-2">{LABELS.empty}</Text>}
              contentContainerStyle={s.list}
              renderItem={({ item }) => <Row record={item} />}
            />
        </InsetFrame>
      </SafeAreaProvider>
    </Modal>
  );
}

/** The overlay's page, inset from the Modal window's system bars and display cutout. */
function InsetFrame({ children }: Readonly<{ children: React.ReactNode }>) {
  const s = styles(useTokens());
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        s.root,
        {
          paddingTop: insets.top + SPACE[4],
          paddingBottom: insets.bottom,
          paddingLeft: insets.left + SPACE[4],
          paddingRight: insets.right + SPACE[4],
        },
      ]}
    >
      {children}
    </View>
  );
}

function Row({ record }: Readonly<{ record: DevLogRecord }>) {
  const s = styles(useTokens());
  const fields = formatFields(record.fields);
  return (
    <View style={s.row}>
      <Text type="footnote" color="text-2" tabular>
        {`${formatRecordTime(record.at)}  ${record.level}  ${record.channel}`}
      </Text>
      <Text>{record.message}</Text>
      {fields.length > 0 && <Text type="footnote" color="text-2">{fields}</Text>}
    </View>
  );
}

/** A filter: `ink` when it is the one applied, `fill` otherwise. */
function Pill({ label, on, onPress }: Readonly<{ label: string; on: boolean; onPress: () => void }>) {
  const s = styles(useTokens());
  return (
    <TouchableOpacity onPress={onPress} accessibilityRole="button" style={[s.pill, on ? s.pillOn : null]}>
      <Text type="caption" color={on ? 'on-ink' : 'text'}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.bg },
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  filters: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: SPACE[2], marginTop: SPACE[2] },
  pill: { borderRadius: RADII.full.radius, paddingHorizontal: SPACE[3], paddingVertical: SPACE[2], backgroundColor: t.colors.fill },
  pillOn: { backgroundColor: t.colors.ink },
  list: { paddingVertical: SPACE[4], gap: SPACE[3] },
  row: { gap: SPACE[2] },
}));
