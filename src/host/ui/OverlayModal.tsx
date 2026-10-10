/**
 * OverlayModal — how the shell's overlays (`Sheet`, `ContextMenu`) take the screen: one at a time,
 * each through the one `Modal` here, whoever shows them and in whatever order.
 *
 * iOS presents a React Native `Modal` as a view controller on the one below it. Measured on React
 * Native 0.85 (Fabric) and the iOS 27 simulator, `animationType="none"`:
 *
 * - A `Modal` shown while another is still up is refused ("Attempt to present … which is already
 *   presenting …"). It reports no `onShow`, never appears, and its native host view stays in the
 *   tree, full-window and invisible, taking every touch. It stays that way after the first one goes.
 *   Hiding or unmounting it and showing it again presents it.
 * - A `Modal` whose `visible` goes false reports `onDismiss` 15–18 ms after the commit, and a
 *   presentation issued in that commit or any later one succeeds.
 * - A `Modal` unmounted while it is up reports nothing, and its dismissal can be reported to the next
 *   `Modal` mounted instead (the native view is recycled). React Native then drops that `Modal`'s host
 *   the moment it is hidden, with no `onDismiss`.
 *
 * So an overlay asks for its turn on the surface it presents from (`useOverlayTurn`) and renders
 * nothing until the turn comes. When its exit has ended it hides its `Modal`, and the turn passes on
 * once the system reports the dismissal. Neither report is trusted to arrive. An unreported
 * dismissal unmounts the `Modal` after `DISMISS_REPORT_MS` and passes the turn: the dismissal was
 * issued when it was hidden, so nothing presents early. An unconfirmed presentation (something this
 * module does not order is presenting: an alert, the share sheet, a `Modal` of another kind) unmounts
 * the `Modal` after `SHOW_REPORT_MS`, which gives touch back, and presents it again; refused
 * `SHOW_ATTEMPTS` times, the overlay closes. Android shows each `Modal` in a window of its own and
 * reports no dismissal; there the turn passes as the exit ends, and nothing is timed.
 *
 * An overlay inside another's content presents from that overlay, so it takes turns with its
 * siblings there, not with the overlays under it.
 */

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform } from 'react-native';

/** How long iOS may take to report a dismissal before the `Modal` is unmounted and counted gone. */
export const DISMISS_REPORT_MS = 500;
/** How long iOS may take to confirm a presentation before it counts as refused. */
export const SHOW_REPORT_MS = 1000;
/** How long a refused presentation waits before it is tried again. */
export const SHOW_RETRY_MS = 250;
/** How many refused presentations in a row close the overlay. */
export const SHOW_ATTEMPTS = 3;

type Grant = () => void;

/** The turns of one presenting surface: the root window, or the inside of an overlay that is up. */
class OverlayTurns {
  private holder: Grant | null = null;
  private readonly waiting: Grant[] = [];

  /** Asks for the turn: `grant` runs when it comes, at once when the surface is free. */
  ask(grant: Grant): void {
    if (this.holder !== null) {
      this.waiting.push(grant);
      return;
    }
    this.holder = grant;
    grant();
  }

  /** Gives up the turn, which passes to whoever has waited longest, or the place in line. */
  leave(grant: Grant): void {
    const place = this.waiting.indexOf(grant);
    if (place >= 0) this.waiting.splice(place, 1);
    if (this.holder !== grant) return;
    this.holder = this.waiting.shift() ?? null;
    this.holder?.();
  }
}

const TurnsContext = createContext(new OverlayTurns());

/** `away`: no turn asked for. `waiting`: in line, or between two tries at presenting. `up`: its
 *  `Modal` is presented. `hiding`: hidden, until the system reports the dismissal. */
type Phase = 'away' | 'waiting' | 'up' | 'hiding';

interface PresenceEvents {
  /** The phase changed. */
  phase: (phase: Phase) => void;
  /** The overlay has gone from the screen, or left the line without reaching it. */
  gone: () => void;
  /** The system would not present the overlay: its owner must close it. */
  refused: () => void;
}

/** One overlay's place on its surface, from asking for the turn to giving it up. */
class OverlayPresence {
  private phase: Phase = 'away';
  private wanted = false;
  /** The overlay ended this showing itself, before its owner stopped wanting it: no new showing
   *  until the owner has. */
  private spent = false;
  /** React Native has been told this `Modal` was dismissed while it is up, so hiding it reports
   *  nothing. */
  private silent = false;
  private attempts = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly turns: OverlayTurns,
    private readonly events: PresenceEvents,
  ) {}

  want(wanted: boolean): void {
    this.wanted = wanted;
    if (!wanted) this.spent = false;
    if (wanted && this.phase === 'away' && !this.spent) {
      this.move('waiting');
      this.turns.ask(this.present);
    } else if (!wanted && this.phase === 'waiting') {
      this.leave();
    }
  }

  /** `Modal.onShow`: the presentation happened. */
  readonly shown = (): void => {
    if (this.phase !== 'up') return;
    this.attempts = 0;
    this.unwatch();
  };

  /** The overlay's exit has ended: its `Modal` goes. */
  readonly exited = (): void => {
    if (this.phase !== 'up') return;
    this.spent = this.wanted;
    if (Platform.OS !== 'ios' || this.silent) {
      this.leave();
      return;
    }
    this.move('hiding');
    this.watch(DISMISS_REPORT_MS, this.leave);
  };

  /** `Modal.onDismiss`. */
  readonly dismissed = (): void => {
    if (this.phase === 'hiding') this.leave();
    else this.silent = true;
  };

  /** The overlay is unmounted. */
  drop(): void {
    this.unwatch();
    this.phase = 'away';
    this.turns.leave(this.present);
  }

  private readonly present = (): void => {
    this.silent = false;
    this.move('up');
    if (Platform.OS === 'ios') this.watch(SHOW_REPORT_MS, this.unconfirmed);
  };

  /** No `onShow` in time. One more turn of the timers first, so a report already queued behind a
   *  busy JS thread is heard. */
  private readonly unconfirmed = (): void => {
    this.watch(0, this.retry);
  };

  /** The presentation was refused: the `Modal` goes, which gives touch back, and is presented again
   *  shortly. After `SHOW_ATTEMPTS` the overlay gives the turn up and tells its owner to close it. */
  private readonly retry = (): void => {
    this.attempts += 1;
    if (this.attempts < SHOW_ATTEMPTS) {
      this.move('waiting');
      this.watch(SHOW_RETRY_MS, this.present);
      return;
    }
    this.spent = true;
    this.events.refused();
    this.leave();
  };

  /** Off the surface: the turn passes on, the owner hears, and an overlay still wanted lines up again. */
  private readonly leave = (): void => {
    this.attempts = 0;
    this.move('away');
    this.turns.leave(this.present);
    this.events.gone();
    if (this.wanted && !this.spent && this.phase === 'away') this.want(true);
  };

  private move(phase: Phase): void {
    this.unwatch();
    this.phase = phase;
    this.events.phase(phase);
  }

  private watch(ms: number, then: () => void): void {
    this.unwatch();
    this.timer = setTimeout(then, ms);
  }

  private unwatch(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

/** An overlay's turn on the screen, as `useOverlayTurn` hands it out. */
export interface OverlayTurn {
  /** The overlay is presented and wanted: its entrance plays as this turns true, its exit as it
   *  turns false while `up`. */
  open: boolean;
  /** The overlay's `Modal` is presented, from its turn coming until `exited`. */
  up: boolean;
  /** The `Modal` exists: presented, or hidden and not yet reported gone. */
  mounted: boolean;
  /** The exit has ended; call it once the overlay has drawn its last frame. */
  exited: () => void;
  /** For `OverlayModal`. */
  shown: () => void;
  dismissed: () => void;
}

export interface OverlayTurnOptions {
  /** Once per showing, when nothing of the overlay is left on screen and the next one may show; also
   *  when it stops being wanted before its turn came. */
  onGone?: () => void;
  /** The system refused to present the overlay `SHOW_ATTEMPTS` times; it must stop wanting to show
   *  (set `wanted` false), as its close control would. */
  onRefused: () => void;
}

/**
 * Takes turns with every other overlay on the same surface. `wanted` asks for the screen; the
 * overlay renders `OverlayModal` with the turn, plays its entrance and exit off `open`, and calls
 * `exited` when the exit has ended.
 */
export function useOverlayTurn(wanted: boolean, options: OverlayTurnOptions): OverlayTurn {
  const turns = useContext(TurnsContext);
  const [phase, setPhase] = useState<Phase>('away');
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const [presence] = useState(
    () =>
      new OverlayPresence(turns, {
        phase: setPhase,
        gone: () => latest.current.onGone?.(),
        refused: () => latest.current.onRefused(),
      }),
  );
  useEffect(() => {
    presence.want(wanted);
  }, [presence, wanted]);
  useEffect(() => () => presence.drop(), [presence]);
  return useMemo(
    () => ({
      open: phase === 'up' && wanted,
      up: phase === 'up',
      mounted: phase === 'up' || phase === 'hiding',
      exited: presence.exited,
      shown: presence.shown,
      dismissed: presence.dismissed,
    }),
    [phase, wanted, presence],
  );
}

export interface OverlayModalProps {
  turn: OverlayTurn;
  /** Android back (and hardware Escape, which Android delivers as back). */
  onRequestClose: () => void;
  children: React.ReactNode;
}

/** The overlay's own full-window, transparent `Modal`, under both system bars. Renders nothing
 *  until the overlay's turn. */
export function OverlayModal({ turn, onRequestClose, children }: Readonly<OverlayModalProps>) {
  const [inside] = useState(() => new OverlayTurns());
  if (!turn.mounted) return null;
  return (
    <Modal
      visible={turn.up}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onRequestClose}
      onShow={turn.shown}
      onDismiss={turn.dismissed}
    >
      <TurnsContext.Provider value={inside}>{children}</TurnsContext.Provider>
    </Modal>
  );
}
