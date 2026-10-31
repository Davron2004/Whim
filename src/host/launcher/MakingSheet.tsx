/**
 * MakingSheet — making or changing an app happens in ONE large sheet over the current screen with
 * the pages Describe, Plan, Making and Ready (or Failure), no step indicator (design-system-v1 D15;
 * `prompt-flow` "The making flow is one sheet with four pages"). The sheet is the host: it owns the
 * `Sheet` and the key a page is shown under; the pages own their content.
 *
 * The page shown is the shell's flow screen (`prompt-flow.ts`), so the sheet is open exactly while
 * the machine is on one of them. `LauncherRoot.renderSheetPage` draws the page for a screen:
 * `DescribePage` and `PlanPage` for the first two, and the run's existing screens in the Making,
 * Ready and Failure slots until the making-progress pages replace them.
 *
 * The page is keyed by the run it belongs to (`prompt-flow.ts#pageKeyOf`), so a page never shows
 * another run's progress, and a close animates out the page the sheet was showing rather than
 * a blank one. Every page starts its headline right under the sheet's header row, where a page that
 * steps back (Plan) has its back control beside the close control (`useSheetBack` with `control`),
 * so the headlines start at the same height.
 */
import React, { Fragment, useRef } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { LAYOUT } from '../../design/tokens';
import { Sheet, SHEET_GRABBER, SHEET_MAX_HEIGHT } from '../ui/Sheet';

/** A page to show: what it is shown under, and the page itself. */
export interface SheetContent {
  readonly key: string;
  readonly node: React.ReactNode;
}

export interface MakingSheetProps {
  /** The page to show; `null` closes the sheet. */
  content: SheetContent | null;
  /** Every way out: close, scrim, drag, Android back. The shell decides what each page's close does. */
  onClose: () => void;
}

export function MakingSheet({ content, onClose }: Readonly<MakingSheetProps>) {
  // What the sheet showed last, kept so a close animates that page out.
  const last = useRef<SheetContent | null>(null);
  if (content !== null) last.current = content;
  const shown = last.current;
  return (
    <Sheet visible={content !== null} onClose={onClose} detent="large">
      {shown ? <Fragment key={shown.key}>{shown.node}</Fragment> : null}
    </Sheet>
  );
}

/** The sheet's grabber and close row above a page, in points (grabber top + height, close control). */
const SHEET_HEAD = SHEET_GRABBER.top + SHEET_GRABBER.height + LAYOUT.headerRowHeight + 4;

/**
 * Gives a page written to fill a screen (`flex: 1`) the height of the sheet's body, which sizes to
 * its content: the Making, Ready and Failure pages are the run's existing screens, hosted as they
 * are until the making-progress pages replace them. A page built on `KeyboardShell host="sheet"`
 * (Describe, Plan) sizes itself and needs none of this.
 */
export function HostedPage({ children }: Readonly<{ children: React.ReactNode }>) {
  const { height } = useWindowDimensions();
  return <View style={{ height: height * (Number.parseFloat(SHEET_MAX_HEIGHT) / 100) - SHEET_HEAD }}>{children}</View>;
}
