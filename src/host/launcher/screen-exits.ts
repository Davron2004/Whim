/**
 * screen-exits — the declared table of how every `Screen` kind is left (design D1/D8; spec
 * launcher-screen-exits "A screen without a declared exit fails the fast gate"). React Native-free
 * (`import type` of `COPY` only) so it loads under the launcher's Node acceptance suite, and so
 * `LauncherRoot`'s coverage read (`SCREEN_EXITS[screen.kind]`) can be typechecked without pulling
 * React Native into this module.
 *
 * `LauncherRoot` indexes this table by the current screen's `kind` (design D7): under the strict
 * `@react-native/typescript-config`, a `Screen` union member with no row here fails to typecheck at
 * that read, which is this table's fast-gate coverage guarantee. `test/screen-exits.suite.ts`'s
 * scanner is the runtime half of the same guarantee — it proves every screen that calls
 * `useSystemBack` is declared here, and every declared control's label is really rendered where
 * this table says it is.
 *
 * No React Native import — this module must load under the Node acceptance suite.
 */
import type { COPY } from './copy';

export type ScreenKind =
  | 'home'
  | 'app'
  | 'dev'
  | 'settings'
  | 'history'
  | 'link-missing'
  | 'consent'
  | 'compose'
  | 'clarify'
  | 'plan'
  | 'build'
  | 'done'
  | 'failure';

export type ExitControl =
  | { file: string; copy: keyof typeof COPY } // a COPY label rendered in `file`
  | { file: string; component: 'FlowHeader' } // the shared flow header rendered in `file`
  | { file: string; literal: string }; // dev-only screens with no COPY entry

export interface ScreenExit {
  /** Who answers system back: the screen's own component through `useSystemBack`, the mini-app
   *  back policy (`useMiniAppHost`), or nobody (the root). */
  back: 'screen' | 'mini-app' | 'root';
  /** The component that calls `useSystemBack` (`back === 'screen'`), else `null`. */
  file: string | null;
  controls: readonly ExitControl[];
}

export const SCREEN_EXITS: Readonly<Record<ScreenKind, ScreenExit>> = {
  home: { back: 'root', file: null, controls: [] },
  app: {
    back: 'mini-app',
    file: null,
    controls: [
      { file: 'orb-actions.ts', copy: 'orbActionHome' },
      { file: 'MiniAppView.tsx', copy: 'launchFailedBack' },
    ],
  },
  dev: {
    back: 'mini-app',
    file: null,
    controls: [{ file: 'DevProbeScreen.tsx', literal: '‹ Home' }],
  },
  settings: {
    back: 'screen',
    file: 'SettingsScreen.tsx',
    controls: [{ file: 'SettingsScreen.tsx', copy: 'backLabel' }],
  },
  history: {
    back: 'screen',
    file: 'HistoryScreen.tsx',
    controls: [{ file: 'HistoryScreen.tsx', copy: 'backLabel' }],
  },
  'link-missing': {
    back: 'screen',
    file: 'AppLinkMissingScreen.tsx',
    controls: [{ file: 'AppLinkMissingScreen.tsx', copy: 'appLinkMissingBack' }],
  },
  // The two non-granting controls a mode can show (design D6): review-on's `close` is the primary
  // `Keep AI features on`, and review-off's plain `Not now` reuses `consentDecline` rather than a
  // new `consent…` string (public-generation-server chain-15 fails an unquoted addition to the
  // privacy page). `ConsentScreen.tsx` renders both through its own `actionLabel` switch
  // (`COPY.consentDecline`, `COPY.consentReviewKeepOn`), not through `consent-flow.ts`'s
  // `consentControls` adapter, so the row names the file that's really rendered.
  consent: {
    back: 'screen',
    file: 'ConsentScreen.tsx',
    controls: [
      { file: 'ConsentScreen.tsx', copy: 'consentDecline' },
      { file: 'ConsentScreen.tsx', copy: 'consentReviewKeepOn' },
    ],
  },
  compose: { back: 'screen', file: 'ComposeStep.tsx', controls: [{ file: 'ComposeStep.tsx', component: 'FlowHeader' }] },
  clarify: { back: 'screen', file: 'ClarifyStep.tsx', controls: [{ file: 'ClarifyStep.tsx', component: 'FlowHeader' }] },
  plan: { back: 'screen', file: 'PlanStep.tsx', controls: [{ file: 'PlanStep.tsx', component: 'FlowHeader' }] },
  build: {
    back: 'screen',
    file: 'BuildStep.tsx',
    controls: [{ file: 'BuildStep.tsx', copy: 'buildLeaveRunning' }],
  },
  done: {
    back: 'screen',
    file: 'DoneStep.tsx',
    controls: [{ file: 'DoneStep.tsx', copy: 'doneBackToApps' }],
  },
  failure: {
    back: 'screen',
    file: 'FailureScreen.tsx',
    controls: [{ file: 'FailureScreen.tsx', copy: 'failureBack' }],
  },
};

/** The error boundary's fallback isn't a `Screen` kind of its own — it can cover any of them — so
 *  it gets its own exit row rather than a slot in `SCREEN_EXITS` (design D7). */
export const FALLBACK_EXIT: { file: 'ScreenErrorFallback.tsx'; controls: readonly ExitControl[] } = {
  file: 'ScreenErrorFallback.tsx',
  controls: [{ file: 'ScreenErrorFallback.tsx', copy: 'screenErrorBack' }],
};

/**
 * The root frame's safe-area edges for a screen kind (design D10; spec launcher-screen-exits
 * "Controls at the bottom of a screen clear the bottom system area"). A running mini-app (`app`)
 * keeps its full-height frame and applies the bottom inset itself (the orb, its sheets); the
 * developer probe (`dev`) applies its own `SafeAreaView`. Every other kind gets both edges so an
 * in-flow control anchored to the bottom is never drawn under the home indicator or a navigation
 * bar.
 */
export function frameEdgesFor(kind: ScreenKind): readonly ('top' | 'bottom')[] {
  return kind === 'app' || kind === 'dev' ? ['top'] : ['top', 'bottom'];
}
