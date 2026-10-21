/**
 * full-screen-styles — a full screen's anatomy (system.md §2.8 Screen anatomy, §9 "full screen"): on
 * `bg`, the title where a pushed screen's sits under its header row, an optional line under it, and the
 * bottom action area. Shared by the link-missing, update and age screens and the error fallback.
 */

import { LAYOUT, SPACE } from '../../design/tokens';
import { makeStyles } from '../ui/tokens-pure';

export const fullScreenStyles = makeStyles((t) => ({
  root: { flex: 1, justifyContent: 'space-between' as const, backgroundColor: t.colors.bg },
  content: { paddingHorizontal: LAYOUT.gutter, paddingTop: LAYOUT.headerRowHeight, gap: LAYOUT.gapTitleToSubtitle },
  footer: { paddingHorizontal: LAYOUT.gutter, paddingTop: LAYOUT.actionAreaTop, paddingBottom: LAYOUT.actionAreaBottom, gap: SPACE[3] },
}));
