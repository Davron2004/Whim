/**
 * whim-prose styles — class -> ONE channel (docs/design/README.md "Whim Syntax", the six-class
 * table). Kept platform-neutral (no `react-native` import, same discipline as the SDK's design
 * tokens) so the mapping is checkable under Node; `WhimProse.tsx` spreads these onto `Text`.
 *
 * `app`     colour, that app's own tile hue
 * `chg`     weight 500, NO colour
 * `yours`   Newsreader italic + the `yours` brown — the one class on two channels
 * `measure` the mono face, NO colour (the face IS the highlight; colouring numbers too is greedy)
 * `state`   one of the three status hues
 * `hedge`   `faint` — a reverse highlight, said and then out of the way
 */

import { FONT_FAMILY } from '../../../sdk/theme';
import type { ProseSegment } from './types';

/** Field names match RN `TextStyle` exactly, so a caller can spread this straight into a style
 *  array. Structural on purpose — this module does not import `react-native`. */
export interface ProseTextStyle {
  color?: string;
  fontFamily?: string;
  fontWeight?: '500';
  fontStyle?: 'italic';
}

/**
 * The style for one rendered segment, or `undefined` for flat text. Android resolves a weight by
 * FILE, not by synthesis, so the weight channel names the Medium file as well as the numeric
 * weight — that is one channel expressed correctly, not two.
 */
export function proseStyle(segment: ProseSegment): ProseTextStyle | undefined {
  switch (segment.cls) {
    case 'app':
    case 'state':
    case 'hedge':
      return { color: segment.color };
    case 'chg':
      return { fontFamily: FONT_FAMILY.sansMedium, fontWeight: '500' };
    case 'yours':
      return { fontFamily: FONT_FAMILY.serifItalic, fontStyle: 'italic', color: segment.color };
    case 'measure':
      return { fontFamily: FONT_FAMILY.monoRegular };
    default:
      return undefined;
  }
}
