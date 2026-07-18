// ─────────────────────────────────────────────────────────────────────────────
// HistoryScreen — an app's version history (version-history-ux, design D1/D3/D5/D7).
// ─────────────────────────────────────────────────────────────────────────────
// A full-screen sibling of SettingsScreen: its own hardware-back binding returning to Home,
// `shellPalette(theme)` colors, and every string from `copy.ts`. History is only reachable from
// the home action sheet, so the app itself is never running while this screen is open — no
// live-realm interaction to design for. All store access goes through `StoreAccess` (never a raw
// `VersionStore`); the F1 listing guard and the D1/D5 decision logic live in `history-logic.ts`
// so they are Node-testable without rendering this component.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  BackHandler,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { Pin, Snapshot } from '../version-store';
import { InstalledApp } from './app-index';
import { parsePromptEnvelope } from './prompt-envelope';
import { StoreAccess } from './store-access';
import {
  annotationBetween,
  fieldsLeavingViewOnRestore,
  formatRelativeTimestamp,
  listVersions,
  restoreTargetId,
} from './history-logic';
import { addedFieldsLine, COPY } from './copy';
import { shellPalette } from './theme';
import { useTheme } from './theme-context';

export interface HistoryScreenProps {
  app: InstalledApp;
  access: StoreAccess;
  /** Returns to the home screen — supplied by `LauncherRoot` (same callback Home refreshes on). */
  onBack: () => void;
}

interface RestoreToast {
  priorActiveId: string;
  reassurance: boolean;
}

const UNDO_TIMEOUT_MS = 5000;

export default function HistoryScreen({ app, access, onBack }: Readonly<HistoryScreenProps>) {
  const { theme } = useTheme();
  const p = shellPalette(theme);

  const [rows, setRows] = useState<Snapshot[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pins, setPins] = useState<Pin[]>([]);
  const [toast, setToast] = useState<RestoreToast | null>(null);
  const [sheetFor, setSheetFor] = useState<Snapshot | null>(null);
  const [pinFor, setPinFor] = useState<Snapshot | null>(null);
  const [pinLabel, setPinLabel] = useState('');

  // Per-pair schema annotations, memoized for the screen's lifetime (D5) — keyed by the row's
  // own snapshot id, survives row re-render/re-mount (FlatList may unmount off-screen items).
  const annotations = useRef(new Map<string, string[]>());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const [list, pinList, active] = await Promise.all([
      listVersions(access, app),
      access.listPins(app),
      access.activeId(app),
    ]);
    setRows(list);
    setPins(pinList);
    setActiveId(active);
  }, [access, app]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const showToast = (priorActiveId: string, reassurance: boolean) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ priorActiveId, reassurance });
    toastTimer.current = setTimeout(() => setToast(null), UNDO_TIMEOUT_MS);
  };

  const restore = async (idx: number) => {
    const targetId = restoreTargetId(rows, idx);
    const priorActiveId = activeId;
    if (targetId == null || priorActiveId == null) return; // install row: no restore affordance
    const leaving = await fieldsLeavingViewOnRestore(access, app, targetId, priorActiveId);
    await access.rollback(app, targetId);
    setActiveId(await access.activeId(app));
    showToast(priorActiveId, leaving.length > 0);
  };

  const undo = async () => {
    if (!toast) return;
    if (toastTimer.current) clearTimeout(toastTimer.current);
    await access.rollback(app, toast.priorActiveId);
    setToast(null);
    setActiveId(await access.activeId(app));
  };

  const openPinPrompt = (snapshot: Snapshot) => {
    setSheetFor(null);
    setPinLabel(pins.find(pin => pin.snapshotId === snapshot.id)?.label ?? '');
    setPinFor(snapshot);
  };

  const savePin = async () => {
    const snapshot = pinFor;
    const label = pinLabel.trim();
    if (!snapshot || !label) return;
    await access.pin(app, snapshot.id, label);
    setPins(await access.listPins(app));
    setPinFor(null);
  };

  const forkFromVersion = async (snapshot: Snapshot) => {
    setSheetFor(null);
    try {
      await access.fork(app, snapshot.id);
    } catch (e) {
      Alert.alert('Could not make this version its own app', (e as Error)?.message ?? String(e));
    }
  };

  const renderRow = ({ item, index }: { item: Snapshot; index: number }) => (
    <HistoryRow
      snapshot={item}
      index={index}
      rows={rows}
      app={app}
      access={access}
      isActive={item.id === activeId}
      pin={pins.find(pin => pin.snapshotId === item.id) ?? null}
      isInstallRow={index === rows.length - 1}
      cache={annotations}
      palette={p}
      onRestore={restore}
      onOverflow={setSheetFor}
    />
  );

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <View style={[styles.header, { borderBottomColor: p.cardBorder }]}>
        <TouchableOpacity onPress={onBack} hitSlop={10} style={styles.backBtn}>
          <Text style={[styles.backText, { color: p.accent }]}>{'‹ ' + COPY.backLabel}</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: p.text }]}>{COPY.historyTitle}</Text>
      </View>

      <FlatList data={rows} keyExtractor={s => s.id} renderItem={renderRow} contentContainerStyle={styles.list} />

      {toast && (
        <View style={[styles.toast, { backgroundColor: p.card, borderColor: p.cardBorder }]}>
          <Text style={[styles.toastText, { color: p.text }]}>{COPY.historyRestoredToast}</Text>
          {toast.reassurance && (
            <Text style={[styles.toastReassurance, { color: p.textMuted }]}>{COPY.historyReassurance}</Text>
          )}
          <TouchableOpacity onPress={undo} hitSlop={10}>
            <Text style={[styles.toastUndo, { color: p.accent }]}>{COPY.historyUndo}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Per-row overflow sheet: pin or fork-from-version. */}
      <Modal visible={sheetFor != null} transparent animationType="fade" onRequestClose={() => setSheetFor(null)}>
        <Pressable style={styles.scrim} onPress={() => setSheetFor(null)}>
          <Pressable style={[styles.sheet, { backgroundColor: p.card }]}>
            <SheetRow label={COPY.historyPinAction} color={p.accent} borderColor={p.cardBorder} onPress={() => sheetFor && openPinPrompt(sheetFor)} />
            <SheetRow label={COPY.historyForkAction} color={p.accent} borderColor={p.cardBorder} onPress={() => sheetFor && forkFromVersion(sheetFor)} />
            <SheetRow label={COPY.cancel} color={p.textMuted} borderColor={p.cardBorder} onPress={() => setSheetFor(null)} />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Pin label prompt (design D7: the existing Modal idiom). */}
      <Modal visible={pinFor != null} transparent animationType="fade" onRequestClose={() => setPinFor(null)}>
        <Pressable style={styles.scrim} onPress={() => setPinFor(null)}>
          <Pressable style={[styles.sheet, { backgroundColor: p.card }]}>
            <TextInput
              value={pinLabel}
              onChangeText={setPinLabel}
              placeholder={COPY.historyPinPlaceholder}
              placeholderTextColor={p.textMuted}
              style={[styles.pinInput, { color: p.text, borderColor: p.cardBorder }]}
              autoFocus
            />
            <SheetRow label={COPY.historyPinSave} color={p.accent} borderColor={p.cardBorder} onPress={savePin} />
            <SheetRow label={COPY.cancel} color={p.textMuted} borderColor={p.cardBorder} onPress={() => setPinFor(null)} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

interface HistoryRowProps {
  snapshot: Snapshot;
  index: number;
  rows: Snapshot[];
  app: InstalledApp;
  access: StoreAccess;
  isActive: boolean;
  pin: Pin | null;
  isInstallRow: boolean;
  cache: React.MutableRefObject<Map<string, string[]>>;
  palette: ReturnType<typeof shellPalette>;
  onRestore: (index: number) => void;
  onOverflow: (snapshot: Snapshot) => void;
}

function HistoryRow({ snapshot, index, rows, app, access, isActive, pin, isInstallRow, cache, palette: p, onRestore, onOverflow }: Readonly<HistoryRowProps>) {
  const [fields, setFields] = useState<string[]>(cache.current.get(snapshot.id) ?? []);

  useEffect(() => {
    const cached = cache.current.get(snapshot.id);
    if (cached) {
      setFields(cached);
      return;
    }
    const predecessor = rows[index + 1];
    if (!predecessor) {
      cache.current.set(snapshot.id, []);
      return;
    }
    let cancelled = false;
    annotationBetween(access, app, predecessor.id, snapshot.id).then(result => {
      cache.current.set(snapshot.id, result);
      if (!cancelled) setFields(result);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.id, index]);

  const promptText = parsePromptEnvelope(snapshot.prompt).text;
  const timestamp = formatRelativeTimestamp(snapshot.createdAt);

  return (
    <View style={[styles.row, { borderBottomColor: p.cardBorder }]}>
      <TouchableOpacity
        style={styles.rowMain}
        activeOpacity={isInstallRow ? 1 : 0.7}
        disabled={isInstallRow}
        onPress={() => onRestore(index)}
      >
        <View style={styles.rowHeader}>
          <Text style={[styles.rowPrompt, { color: p.text }]} numberOfLines={3}>{promptText}</Text>
          {isActive && (
            <View style={[styles.currentBadge, { backgroundColor: p.accent }]}>
              <Text style={[styles.currentBadgeText, { color: p.onAccent }]}>{COPY.historyCurrentLabel}</Text>
            </View>
          )}
        </View>
        <Text style={[styles.rowTimestamp, { color: p.textMuted }]}>{timestamp}</Text>
        {pin && <Text style={[styles.pinLabel, { color: p.accent }]}>{pin.label}</Text>}
        {fields.length > 0 && (
          <Text style={[styles.annotation, { color: p.textMuted }]}>{addedFieldsLine(fields)}</Text>
        )}
        {isInstallRow && (
          <Text style={[styles.installLabel, { color: p.textMuted }]}>{COPY.historyInstallLabel}</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.overflowBtn}
        onPress={() => onOverflow(snapshot)}
        accessibilityLabel={COPY.historyMoreLabel}
        hitSlop={10}
      >
        <Text style={[styles.overflowGlyph, { color: p.textMuted }]}>{'⋯'}</Text>
      </TouchableOpacity>
    </View>
  );
}

function SheetRow({ label, onPress, color, borderColor }: Readonly<{ label: string; onPress: () => void; color: string; borderColor: string }>) {
  return (
    <TouchableOpacity style={[styles.sheetRow, { borderTopColor: borderColor }]} onPress={onPress}>
      <Text style={[styles.sheetRowText, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { paddingVertical: 2 },
  backText: { fontSize: 15, fontWeight: '700' },
  title: { fontSize: 18, fontWeight: '800' },
  list: { paddingBottom: 40 },
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  rowMain: { flex: 1 },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowPrompt: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  rowTimestamp: { fontSize: 12, marginTop: 4 },
  currentBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  currentBadgeText: { fontSize: 10, fontWeight: '700' },
  pinLabel: { fontSize: 12, fontWeight: '700', marginTop: 4 },
  annotation: { fontSize: 12, marginTop: 4 },
  installLabel: { fontSize: 12, marginTop: 4, fontStyle: 'italic' },
  overflowBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  overflowGlyph: { fontSize: 20, fontWeight: '700' },
  toast: { position: 'absolute', left: 16, right: 16, bottom: 24, borderRadius: 12, borderWidth: 1, padding: 14 },
  toastText: { fontSize: 14, fontWeight: '600' },
  toastReassurance: { fontSize: 12, marginTop: 4 },
  toastUndo: { fontSize: 14, fontWeight: '700', marginTop: 8 },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 8, paddingBottom: 28, paddingHorizontal: 16 },
  sheetRow: { paddingVertical: 15, alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth },
  sheetRowText: { fontSize: 16, fontWeight: '600' },
  pinInput: { fontSize: 15, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 12, marginBottom: 4 },
});
