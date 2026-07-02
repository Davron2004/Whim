// ─────────────────────────────────────────────────────────────────────────────
// HomeScreen — the launcher home grid (launcher-shell / #5 D6).
// ─────────────────────────────────────────────────────────────────────────────
// A phone-home-style grid of installed apps (derived monogram + deterministic color, example
// badge, fork provenance) + a "make your first app" CTA tile. Tap a tile to launch full-screen;
// long-press for the action sheet (Open / Fork / Delete-with-confirmation). Every visible string
// comes from `copy.ts` and passes the product-verbs guard (#5 spec). A long-press on the title
// opens the __DEV__ probe surface (D6).
import React, { useState } from 'react';
import {
  Alert,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { InstalledApp } from './app-index';
import { monogram, tileColor } from './tiles';
import { COPY, deleteBody, forkedFromLabel } from './copy';

const { width } = Dimensions.get('window');
const COLS = 3;
const PAD = 16;
const GAP = 12;
const TILE = Math.floor((width - PAD * 2 - GAP * (COLS - 1)) / COLS);

export interface HomeScreenProps {
  apps: InstalledApp[];
  onOpen: (app: InstalledApp) => void;
  onFork: (app: InstalledApp) => void;
  onDelete: (app: InstalledApp) => void;
  onCreate: () => void;
  /** __DEV__ entry: long-press the title to reach the containment/bridge probe surface (D6). */
  onOpenDevProbe?: () => void;
}

export default function HomeScreen({ apps, onOpen, onFork, onDelete, onCreate, onOpenDevProbe }: Readonly<HomeScreenProps>) {
  const [selected, setSelected] = useState<InstalledApp | null>(null);

  const confirmDelete = (app: InstalledApp) => {
    setSelected(null);
    Alert.alert(COPY.deleteTitle, deleteBody(app.name), [
      { text: COPY.cancel, style: 'cancel' },
      { text: COPY.deleteConfirm, style: 'destructive', onPress: () => onDelete(app) },
    ]);
  };

  const showCreate = () => {
    onCreate();
    Alert.alert(COPY.createTitle, COPY.createBody, [{ text: COPY.createDismiss }]);
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title} onLongPress={onOpenDevProbe} suppressHighlighting>
          {COPY.homeTitle}
        </Text>
        <Text style={styles.subtitle}>{COPY.homeSubtitle}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.grid}>
        {apps.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{COPY.emptyTitle}</Text>
            <Text style={styles.emptyBody}>{COPY.emptyBody}</Text>
          </View>
        )}

        {apps.map((app) => (
          <View key={app.id} style={styles.cell}>
            <TouchableOpacity
              activeOpacity={0.85}
              style={[styles.tile, { backgroundColor: tileColor(app.name) }]}
              onPress={() => onOpen(app)}
              onLongPress={() => setSelected(app)}
            >
              <Text style={styles.monogram}>{monogram(app.name)}</Text>
              {app.example && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{COPY.exampleBadge}</Text>
                </View>
              )}
            </TouchableOpacity>
            <Text style={styles.tileName} numberOfLines={1}>{app.name}</Text>
            {app.forkedFrom && (
              <Text style={styles.tileSub} numberOfLines={1}>{forkedFromLabel(app.forkedFrom.name)}</Text>
            )}
          </View>
        ))}

        {/* "make your first app" CTA tile (destination is #7's prompt screen). */}
        <View style={styles.cell}>
          <TouchableOpacity activeOpacity={0.85} style={[styles.tile, styles.createTile]} onPress={showCreate}>
            <Text style={styles.createPlus}>＋</Text>
          </TouchableOpacity>
          <Text style={styles.tileName} numberOfLines={2}>{COPY.createTileLabel}</Text>
        </View>
      </ScrollView>

      {/* Action sheet (long-press): Open / Fork / Delete. */}
      <Modal visible={selected != null} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.sheetScrim} onPress={() => setSelected(null)}>
          <Pressable style={styles.sheet}>
            <Text style={styles.sheetTitle} numberOfLines={1}>{selected?.name}</Text>
            <SheetRow label={COPY.actionOpen} onPress={() => { const a = selected!; setSelected(null); onOpen(a); }} />
            <SheetRow label={COPY.actionFork} onPress={() => { const a = selected!; setSelected(null); onFork(a); }} />
            <SheetRow label={COPY.actionDelete} destructive onPress={() => confirmDelete(selected!)} />
            <SheetRow label={COPY.cancel} muted onPress={() => setSelected(null)} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function SheetRow({ label, onPress, destructive, muted }: { label: string; onPress: () => void; destructive?: boolean; muted?: boolean }) {
  return (
    <TouchableOpacity style={styles.sheetRow} onPress={onPress}>
      <Text style={[styles.sheetRowText, destructive && styles.sheetDestructive, muted && styles.sheetMuted]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b1020' },
  header: { paddingHorizontal: PAD, paddingTop: 8, paddingBottom: 12 },
  title: { color: '#e5e7eb', fontWeight: '800', fontSize: 28 },
  subtitle: { color: '#94a3b8', fontSize: 13, marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: PAD, gap: GAP, paddingBottom: 40, flexGrow: 1, alignContent: 'flex-start' },
  cell: { width: TILE, alignSelf: 'flex-start' },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  monogram: { color: '#fff', fontSize: 30, fontWeight: '800' },
  badge: { position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  tileName: { color: '#e5e7eb', fontSize: 12, marginTop: 6, fontWeight: '600' },
  tileSub: { color: '#64748b', fontSize: 10, marginTop: 1 },
  createTile: { backgroundColor: '#111a2e', borderWidth: 1, borderColor: '#334155', borderStyle: 'dashed' },
  createPlus: { color: '#93c5fd', fontSize: 34, fontWeight: '300' },
  empty: { width: '100%', alignItems: 'center', paddingVertical: 48 },
  emptyTitle: { color: '#e5e7eb', fontSize: 16, fontWeight: '700' },
  emptyBody: { color: '#94a3b8', fontSize: 13, marginTop: 4 },
  sheetScrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#0f172a', borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 8, paddingBottom: 28 },
  sheetTitle: { color: '#94a3b8', fontSize: 13, fontWeight: '700', textAlign: 'center', paddingVertical: 10 },
  sheetRow: { paddingVertical: 15, alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#1e293b' },
  sheetRowText: { color: '#bfdbfe', fontSize: 16, fontWeight: '600' },
  sheetDestructive: { color: '#f87171' },
  sheetMuted: { color: '#64748b' },
});
