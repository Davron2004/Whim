/**
 * CopyQuestionSheet — "Copy the data, or start fresh?" (app-launcher "Forking creates an independent
 * launcher entry"; owner ruling 2026-10-09). Asked before a copy is made, wherever "Make a copy" is
 * offered: the Home tile menu and History share this one component. Both answers give the copy its
 * own storage; no row shares the original's data. The caller offers the question only when the copy
 * can copy data at all (`StoreAccess.canCopyData`); a one-option question is never asked.
 *
 * It creates nothing itself. A row calls its handler, a dismissal (close, scrim, back, a drag) calls
 * `onClose`, and the caller hides the sheet in every case.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LAYOUT } from '../../design/tokens';
import { GroupedRow, GroupedSection } from '../ui/GroupedList';
import { Sheet } from '../ui/Sheet';
import { COPY, copyQuestionDataSubtitle } from './copy';

export interface CopyQuestionSheetProps {
  visible: boolean;
  /** The app being copied, named in the first row. */
  appName: string;
  /** "Copy the data": the copy starts with a one-time copy of the original's saved data. */
  onCopyData: () => void;
  /** "Start fresh": the copy starts empty. */
  onStartFresh: () => void;
  /** Every other way out; nothing is created. */
  onClose: () => void;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: LAYOUT.gutter, paddingBottom: LAYOUT.actionAreaBottom },
});

export function CopyQuestionSheet({ visible, appName, onCopyData, onStartFresh, onClose }: Readonly<CopyQuestionSheetProps>) {
  return (
    <Sheet visible={visible} onClose={onClose} title={COPY.copyQuestionTitle} detent="fit">
      <View style={styles.content}>
        <GroupedSection on="sheet">
          <GroupedRow title={COPY.copyQuestionData} subtitle={copyQuestionDataSubtitle(appName)} icon="copy" onPress={onCopyData} />
          <GroupedRow title={COPY.copyQuestionFresh} subtitle={COPY.copyQuestionFreshSubtitle} icon="sprout" onPress={onStartFresh} />
        </GroupedSection>
      </View>
    </Sheet>
  );
}
