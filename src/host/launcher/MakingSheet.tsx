/**
 * MakingSheet — making or changing an app happens in ONE large sheet over the current screen with
 * the pages Describe, Plan, Making and Ready (or Failure), no step indicator (design-system-v1 D15;
 * `prompt-flow` "The making flow is one sheet with four pages"). The sheet is the host: it owns the
 * `Sheet` and the key a page is shown under; the pages own their content.
 *
 * The page shown is the shell's flow screen (`prompt-flow.ts`), so the sheet is open exactly while
 * the machine is on one of them. `LauncherRoot.renderSheetPage` draws the page for a screen. Every
 * page is a `KeyboardShell host="sheet"` body, which fills the large sheet and keeps its actions at
 * the sheet's bottom. Over a running app the same sheet first shows the Whim sheet's `fit` pages
 * (`WhimSheet.tsx`), so sending a change grows it into the plan page instead of opening a second sheet.
 *
 * The page is keyed by the run it belongs to (`prompt-flow.ts#pageKeyOf`), so a page never shows
 * another run's progress, and a close animates out the page the sheet was showing rather than
 * a blank one. Every page starts its headline right under the sheet's header row, where a page that
 * steps back (Plan) has its back control beside the close control (`useSheetBack` with `control`),
 * so the headlines start at the same height.
 *
 * A page that hands an element on to the next (Make it's ember, which travels into the Making page's
 * 128; the Making page's, which travels into the Ready page's tile: `TravelLayer`) stays mounted,
 * untouchable and without its step back, under the page that replaced it, fading out on `fade-out`,
 * until the element has landed and it has faded, so the travel sets out from where it is drawn and
 * nothing on the page vanishes in one frame (`TravelPage`). It is the same mounted page throughout.
 */
import React, { useEffect, useReducer, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { Sheet, SheetPageLeaving, type SheetDetent } from '../ui/Sheet';
import { TravelPage, useTravel } from '../ui/TravelLayer';

/** A page to show: what it is shown under, the page itself, and the height it takes: `large` (the
 *  making flow) unless it asks to `fit` its content (the Whim sheet's own pages). A page that asks for
 *  `large` after a `fit` one grows the same sheet. */
export interface SheetContent {
  readonly key: string;
  readonly node: React.ReactNode;
  readonly detent?: SheetDetent;
}

export interface MakingSheetProps {
  /** The page to show; `null` closes the sheet. */
  content: SheetContent | null;
  /** Every way out: close, scrim, drag, Android back. The shell decides what each page's close does. */
  onClose: () => void;
  /** The place on the screen behind the sheet its page grows out of and shrinks back into
   *  (`SheetAnchor`): the composer for a description begun there (M6), the run's own tile while it is
   *  made (M5). Kept from the last page shown, so a close goes back into the place it was showing. */
  anchor?: string;
}

export function MakingSheet({ content, onClose, anchor }: Readonly<MakingSheetProps>) {
  // What the sheet showed last, kept so a close animates that page out.
  const last = useRef<SheetContent | null>(null);
  const lastAnchor = useRef<string | undefined>(undefined);
  if (content !== null) {
    last.current = content;
    lastAnchor.current = anchor;
  }
  const shown = last.current;
  return (
    <Sheet visible={content !== null} onClose={onClose} detent={shown?.detent ?? 'large'} anchor={lastAnchor.current}>
      {shown ? <Pages shown={shown} /> : null}
    </Sheet>
  );
}

/** One mounted page: a new one for a new key or a different page under the same key. */
interface PageInstance {
  readonly serial: number;
  readonly key: string;
  readonly node: React.ReactNode;
}

const typeOf = (node: React.ReactNode): unknown => (React.isValidElement(node) ? node.type : null);

/** The page shown, and the one it replaced while an element travels out of it. */
function Pages({ shown }: Readonly<{ shown: SheetContent }>) {
  const travel = useTravel();
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const page = useRef<PageInstance | null>(null);
  const leaving = useRef<PageInstance | null>(null);
  const was = page.current;
  if (was === null || was.key !== shown.key || typeOf(was.node) !== typeOf(shown.node)) {
    // Only a page an element can leave from is kept: any other goes as it always did.
    leaving.current = was !== null && travel?.hasSource() ? was : null;
    page.current = { serial: (was?.serial ?? 0) + 1, key: shown.key, node: shown.node };
  } else {
    page.current = { ...was, node: shown.node };
  }
  const current = page.current;
  const left = leaving.current;
  // The serial of the leaving page whose fade-out has ended, and what then checks whether it can go.
  const faded = useRef(0);
  const settle = useRef(() => {});
  useEffect(() => {
    if (left === null) return undefined;
    const drop = () => {
      if (leaving.current !== left) return;
      leaving.current = null;
      redraw();
    };
    // Kept only when the page that replaced it asked it for an element.
    if (travel === null || !travel.takeHandOff()) {
      drop();
      return undefined;
    }
    const settleNow = () => {
      if (!travel.flying() && faded.current === left.serial) drop();
    };
    settle.current = settleNow;
    const stop = travel.onLanding(settleNow);
    settleNow();
    return () => {
      stop();
      settle.current = () => {};
    };
  }, [left, travel]);
  const onFaded = (serial: number) => {
    faded.current = serial;
    settle.current();
  };
  // One list in drawing order, so the page shown stays the same mounted view as it starts to leave.
  const pages = left ? [left, current] : [current];
  return (
    <>
      {pages.map((one) => (
        <TravelPage key={one.serial} leaving={one !== current} onFaded={() => onFaded(one.serial)} style={styles.page}>
          <SheetPageLeaving leaving={one !== current}>{one.node}</SheetPageLeaving>
        </TravelPage>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  // A page fills the sheet's body as the body fills the card (`Sheet`), so it lays out as if unwrapped.
  page: { flexGrow: 1, flexShrink: 1 },
});
