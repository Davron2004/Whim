/**
 * ConfirmSheet — the launcher's one confirm step (design `4a`, `Whim Mobile.dc.html:58-68`; README
 * "In any confirm sheet the safe option is the large button and the consequential action is
 * demoted to plain text"). History's restore and copy confirms and Settings' "Make a new ID" ask
 * through it, on both platforms, instead of the system alert.
 *
 * A bottom sheet over a dim: the title, the body, whatever the caller adds beneath the body, then
 * `Cancel` as the large button and the consequential action as plain text under it. A tap on the
 * dim, and system back, cancel.
 */
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { RADIUS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import { COPY } from './copy';
import { SHELL_PALETTE } from './theme';

/** What a confirm step says: its title and body, and its consequential action's label, idle and
 *  while it runs. */
export interface ConfirmSheetContent {
  title: string;
  body: string;
  confirmLabel: string;
  busyLabel?: string;
}

export interface ConfirmSheetProps {
  /** The confirm step to show, or null for none. */
  confirm: ConfirmSheetContent | null;
  /** The confirmed action is running: its control says so and takes no more taps. */
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  /** Anything more the sheet says, between its body and its buttons. */
  children?: React.ReactNode;
}

export default function ConfirmSheet({ confirm, busy = false, onCancel, onConfirm, children }: Readonly<ConfirmSheetProps>) {
  const p = SHELL_PALETTE;
  return (
    <Modal visible={confirm != null} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.scrim} onPress={onCancel}>
        <Pressable style={[styles.sheet, { backgroundColor: p.card }]}>
          {confirm && (
            <>
              <Text style={[TYPE_SCALE.screenTitle, { color: p.text }]}>{confirm.title}</Text>
              <Text style={[TYPE_SCALE.body, { color: p.textMuted, marginTop: SPACING.xs }]}>{confirm.body}</Text>
              {children}
              <TouchableOpacity onPress={onCancel} accessibilityRole="button" style={[styles.safe, { backgroundColor: p.text }]}>
                <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.onAccent }]}>{COPY.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onConfirm}
                disabled={busy}
                accessibilityRole="button"
                accessibilityState={{ disabled: busy, busy }}
                style={[styles.consequential, busy ? styles.consequentialBusy : null]}
              >
                <Text style={[TYPE_SCALE.body, { color: p.textMuted }]}>{busy ? (confirm.busyLabel ?? confirm.confirmLabel) : confirm.confirmLabel}</Text>
              </TouchableOpacity>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(24,22,20,0.5)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: RADIUS.sheet, borderTopRightRadius: RADIUS.sheet, padding: 24 },
  safe: { borderRadius: RADIUS.card, height: 56, alignItems: 'center', justifyContent: 'center', marginTop: SPACING.lg },
  consequential: { height: 46, alignItems: 'center', justifyContent: 'center' },
  // Opacity, not a shadow or an elevation: `shadow*` renders as nothing on Android.
  consequentialBusy: { opacity: 0.5 },
});
