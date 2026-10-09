/**
 * ConfirmSheet — a `fit` sheet for exactly two things: making a new phone ID and using your own
 * server (system.md §7.1 Confirm sheet; design-system-v1 task 11.2). The `title2` title asks
 * ("Make a new ID?"), the `body` in `text-2` says exactly what changes, then the safe choice as a
 * large `ink` button ("Keep this ID") above the consequential one as `danger`, which plays the
 * `warning` haptic. The scrim, close, back and a drag all keep — the safe choice.
 *
 * Delete, use-this-version and copy happen at once with Undo instead; nothing else confirms.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LAYOUT, SPACE } from '../../design/tokens';
import { Button } from './Button';
import { Sheet } from './Sheet';
import { Text } from './Text';

export interface ConfirmSheetProps {
  visible: boolean;
  /** The question, `title2` ("Make a new ID?"). */
  title: string;
  /** Exactly what changes. */
  body: string;
  /** The safe choice ("Keep this ID"): the large `ink` button, and what every other way out does. */
  keepLabel: string;
  /** The consequential choice: `danger`, under the safe one. */
  confirmLabel: string;
  /** Busy words for the consequential choice while it runs; taps are ignored meanwhile. */
  busy?: string;
  onKeep: () => void;
  onConfirm: () => void;
}

// The bottom action area (§2.8): 16 above the buttons, 12 below (the sheet adds the safe area).
const styles = StyleSheet.create({
  content: { paddingHorizontal: LAYOUT.gutter, paddingBottom: LAYOUT.actionAreaBottom },
  actions: { marginTop: LAYOUT.actionAreaTop, gap: SPACE[3] },
});

export function ConfirmSheet({ visible, title, body, keepLabel, confirmLabel, busy, onKeep, onConfirm }: Readonly<ConfirmSheetProps>) {
  const s = styles;
  return (
    <Sheet visible={visible} onClose={onKeep} title={title} detent="fit">
      <View style={s.content}>
        <Text type="body" color="text-2">
          {body}
        </Text>
        <View style={s.actions}>
          <Button label={keepLabel} variant="ink" onPress={onKeep} />
          <Button label={confirmLabel} variant="danger" busy={busy} haptic="warning" onPress={onConfirm} />
        </View>
      </View>
    </Sheet>
  );
}
