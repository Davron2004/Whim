# design-system-v1: owner checks at PR review (task 24.7)

Ruled out of the run (po-decisions, 2026-10-30): the owner does these at PR review and records the results, and any
token adjustments, in decision #75's status tag.

- [x] **Ember silhouette at 24 pt.** The ember reads as a flame, not a blob, at its smallest size (Home tile status,
      toasts), light and dark.
- [x] **iOS title tracking.** The in-content titles on iOS (largeTitle on Settings and History, title1 on Advanced, AI features and Report; the header row has no inline title since s4b-shell) look right next to system apps (tracking per
      `docs/design/system.md` typography).
- [x] **Motion recordings.** Watch the 0.25× clips against the mockup references:
      `/Users/davrondjabborov/Work/other/Whim-evidence/design-system-v1/motion/{android,ios,mockup}/`
      (index and per-moment notes: `verification.md` § 22.5).
- [x] **Re-feel the haptic fixes on a phone** (iPhone, then Android if handy):
  - #234: drag any sheet down slowly. The commit tick lands exactly where letting go dismisses; letting go before
    the tick springs back.
  - #235: drag the orb slowly across the middle. One tick per crossing, no bursts.
  - #236: on iPhone, flip a Settings switch directly, then by tapping its row. Each flip is one light tap, not a
    medium double.
- [x] **Stalled tile, screen reader** (#239): with VoiceOver, a stalled make's tile reads "<name>, no progress" then
      the hint "Shows progress". Keep the hint or reword it?
