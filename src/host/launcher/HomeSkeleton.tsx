/**
 * HomeSkeleton — Home while the apps are still being read (system.md §7.1 Skeleton, §9 Your apps):
 * the real title and composer, and one cell per known app in the real grid geometry, so nothing
 * moves when the tiles arrive. The chrome it draws for the Settings button and the composer is
 * inert and hidden from screen readers: a placeholder is not a control. A promise of content, so it draws nothing for an empty grid (the
 * empty state is its own thing).
 */
import React from 'react';
import { useWindowDimensions, View } from 'react-native';
import { RADII, SHAPE, SPACE } from '../../design/tokens';
import { gridLayout, listRowPadding, GRID, TILE_SIDE } from '../ui/AppTile-geometry';
import { Skeleton, SkeletonBlock } from '../ui/Skeleton';
import { useTokens } from '../ui/tokens';
import { makeStyles } from '../ui/tokens-pure';
import { ComposerBar } from './ComposerBar';
import { COPY } from './copy';
import { HomeHeader } from './HomeHeader';
import { EDGE_FADE_HEIGHT } from './ScrollEdgeFade';

export interface HomeSkeletonProps {
  /** How many apps are known to be coming. */
  count: number;
}

const styles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.bg },
  grid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const },
  list: { flexDirection: 'column' as const },
  fill: { flex: 1 },
  gridCell: { alignItems: 'center' as const },
  listRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACE[3], width: '100%' as const, paddingHorizontal: listRowPadding(t.largeText) },
}));

const noop = () => undefined;

export function HomeSkeleton({ count }: Readonly<HomeSkeletonProps>) {
  const t = useTokens();
  const s = styles(t);
  const { width, fontScale } = useWindowDimensions();
  const layout = gridLayout(width, fontScale);
  const cells = Array.from({ length: Math.max(0, count) }, (_, i) => i);
  const side = layout.tile;
  const plate = <SkeletonBlock width={side} height={side} radius={SHAPE.tileCorner * side} />;
  const frame = { paddingHorizontal: layout.gutter, paddingTop: EDGE_FADE_HEIGHT, rowGap: layout.kind === 'grid' ? layout.rowGap : 0 };
  return (
    <View style={s.root}>
      <HomeHeader />
      <View style={s.fill}>
        {cells.length > 0 ? (
          <Skeleton label={COPY.homeLoadingLabel} style={[layout.kind === 'grid' ? s.grid : s.list, frame]}>
            {cells.map((i) =>
              layout.kind === 'grid' ? (
                <View key={i} style={[s.gridCell, { width: layout.columnWidth, minHeight: layout.cellHeight }]}>
                  {plate}
                  <View style={{ marginTop: GRID.labelGap }}>
                    <SkeletonBlock width={TILE_SIDE.grid * 0.75} height={SPACE[3]} radius={RADII.xs.radius} />
                  </View>
                </View>
              ) : (
                <View key={i} style={[s.listRow, { minHeight: layout.rowHeight }]}>
                  {plate}
                  <SkeletonBlock width="50%" height={SPACE[4]} radius={RADII.xs.radius} />
                </View>
              ),
            )}
          </Skeleton>
        ) : null}
      </View>
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <ComposerBar onPress={noop} />
      </View>
    </View>
  );
}
