/**
 * MakingSheet — making or changing an app happens in ONE large sheet over the current screen with
 * the pages Describe, Plan, Making and Ready (or Failure), no step indicator (design-system-v1 D15;
 * `prompt-flow` "The making flow is one sheet with four pages"). The sheet is the host: it owns the
 * `Sheet` and the key a page is shown under; the pages own their content.
 *
 * The page shown is the shell's flow screen (`prompt-flow.ts`), so the sheet is open exactly while
 * the machine is on one of them. `LauncherRoot.renderSheetPage` draws the page for a screen. Every
 * page is a `KeyboardShell host="sheet"` body, which fills the large sheet and keeps its actions at
 * the sheet's bottom.
 *
 * The page is keyed by the run it belongs to (`prompt-flow.ts#pageKeyOf`), so a page never shows
 * another run's progress, and a close animates out the page the sheet was showing rather than
 * a blank one. Every page starts its headline right under the sheet's header row, where a page that
 * steps back (Plan) has its back control beside the close control (`useSheetBack` with `control`),
 * so the headlines start at the same height.
 */
import React, { Fragment, useRef } from 'react';
import { Sheet } from '../ui/Sheet';

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
