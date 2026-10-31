/**
 * whim-prose styles — class -> ONE channel (docs/design/system.md §2.7, "Whim Syntax, simplified").
 * Kept platform-neutral (no `react-native` import) so the mapping is checkable under Node;
 * `WhimProse.tsx` spreads these onto `Text`. Every class draws the system font.
 *
 * `app`     the app's tint text colour
 * `chg`     weight 600, no colour
 * `yours`   italic, in `text` (the quotes are the prose's own)
 * `measure` tabular figures, no colour
 * `state`   "ready" in `positive-text`, "failed" in `danger-text`
 * `hedge`   `text-2`
 */

import { TABULAR } from '../tokens-pure';
import type { ProseSegment } from './types';

/** Field names match RN `TextStyle` exactly, so a caller can spread this straight into a style
 *  array. Structural on purpose — this module does not import `react-native`. */
export interface ProseTextStyle {
  color?: string;
  fontWeight?: '600';
  fontStyle?: 'italic';
  fontVariant?: Array<'tabular-nums'>;
}

/** The style for one rendered segment, or `undefined` for flat text. */
export function proseStyle(segment: ProseSegment): ProseTextStyle | undefined {
  switch (segment.cls) {
    case 'app':
    case 'state':
    case 'hedge':
      return { color: segment.color };
    case 'chg':
      return { fontWeight: '600' };
    case 'yours':
      return { fontStyle: 'italic', color: segment.color };
    case 'measure':
      return { fontVariant: [...TABULAR.fontVariant] };
    default:
      return undefined;
  }
}
