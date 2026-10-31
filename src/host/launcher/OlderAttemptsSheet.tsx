/**
 * OlderAttemptsSheet — the list the collapsed "2 didn't work" tile opens (app-launcher "Tiles show
 * their state"; system.md §3.2): the failed and stopped attempts older than a day, one row each, with
 * what became of it. Tapping a row opens that attempt's page, as its own tile would have. Discarding
 * them all is the tile's menu.
 */
import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { LAYOUT } from '../../design/tokens';
import { GroupedRow, GroupedSection } from '../ui/GroupedList';
import { Sheet } from '../ui/Sheet';
import { COPY } from './copy';
import { attemptName } from './grid-composition';
import type { PendingBuildRecord } from './pending-builds';

export interface OlderAttemptsSheetProps {
  /** The attempts listed; an empty list closes the sheet. */
  attempts: readonly PendingBuildRecord[];
  visible: boolean;
  onOpen: (rec: PendingBuildRecord) => void;
  onClose: () => void;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: LAYOUT.gutter, paddingBottom: LAYOUT.actionAreaBottom },
});

export function OlderAttemptsSheet({ attempts, visible, onOpen, onClose }: Readonly<OlderAttemptsSheetProps>) {
  return (
    <Sheet visible={visible && attempts.length > 0} onClose={onClose} title={COPY.olderTitle} detent="fit">
      <ScrollView contentContainerStyle={styles.content}>
        <GroupedSection on="sheet">
          {attempts.map((rec) => (
            <GroupedRow
              key={rec.id}
              title={attemptName(rec)}
              subtitle={rec.state === 'interrupted' ? COPY.tileStopped : COPY.tileFailed}
              trailing={{ kind: 'chevron' }}
              onPress={() => onOpen(rec)}
            />
          ))}
        </GroupedSection>
      </ScrollView>
    </Sheet>
  );
}
