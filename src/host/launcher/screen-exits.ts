/** Screen exit ownership also determines whether the error boundary offers a way Home. */
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

export const SCREEN_EXITS: Readonly<Record<ScreenKind, { back: 'root' | 'mini-app' | 'screen' }>> = {
  'home': { back: 'root' },
  'app': { back: 'mini-app' },
  'dev': { back: 'mini-app' },
  'settings': { back: 'screen' },
  'history': { back: 'screen' },
  'link-missing': { back: 'screen' },
  'consent': { back: 'screen' },
  'compose': { back: 'screen' },
  'clarify': { back: 'screen' },
  'plan': { back: 'screen' },
  'build': { back: 'screen' },
  'done': { back: 'screen' },
  'failure': { back: 'screen' },
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
