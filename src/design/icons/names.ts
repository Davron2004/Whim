// The icon vocabulary of `docs/design/system.md` §3.1: the glyph set the generator may name (tiles and
// `Icon`), the chrome set components draw, the alias map and the keyword table, and the two resolvers.
// Pure data and logic, no RN/DOM import: shared by the SDK, the shell, the server and the vendoring
// script (`scripts/vendor-icons.mjs` reads `ICON_NAMES` to choose which Lucide icons to vendor).

/** The 147 glyphs, grouped as in `system.md` §3.1. */
export const GLYPH_GROUPS = {
  'Time': ['timer', 'alarm-clock', 'hourglass', 'clock', 'watch', 'calendar', 'calendar-check', 'calendar-days'],
  'Food and drink': [
    'coffee', 'cup-soda', 'glass-water', 'droplet', 'utensils', 'chef-hat', 'cookie', 'apple', 'carrot', 'pizza',
    'wheat', 'egg', 'salad', 'croissant',
  ],
  'Nature and weather': [
    'leaf', 'sprout', 'flower', 'flower-2', 'trees', 'tree-pine', 'sun', 'moon', 'cloud', 'cloud-rain', 'snowflake',
    'thermometer', 'wind', 'umbrella', 'flame', 'zap', 'waves', 'mountain',
  ],
  'Body and health': [
    'heart', 'heart-pulse', 'activity', 'dumbbell', 'bike', 'footprints', 'pill', 'stethoscope', 'bed', 'brain',
    'smile', 'baby',
  ],
  'Animals': ['dog', 'cat', 'paw-print', 'fish', 'bird', 'bug'],
  'Home': [
    'house', 'sofa', 'lamp', 'key', 'lock', 'plug', 'battery', 'bell', 'recycle', 'trash-2', 'shirt', 'glasses',
    'scissors',
  ],
  'Money and shopping': [
    'shopping-cart', 'shopping-bag', 'gift', 'tag', 'receipt', 'wallet', 'piggy-bank', 'coins', 'banknote',
    'credit-card', 'calculator', 'percent',
  ],
  'Goals and lists': [
    'chart-column', 'chart-line', 'chart-pie', 'trending-up', 'target', 'trophy', 'medal', 'flag', 'star',
    'list-checks', 'list-todo', 'square-check', 'clipboard-list',
  ],
  'Play and make': [
    'dice-5', 'dices', 'puzzle', 'gamepad-2', 'music', 'headphones', 'mic', 'guitar', 'piano', 'film', 'camera',
    'image', 'palette', 'brush',
  ],
  'Learn and write': [
    'pencil', 'pen-tool', 'book', 'book-open', 'notebook-pen', 'graduation-cap', 'languages', 'lightbulb',
    'sticky-note', 'file-text', 'folder', 'inbox',
  ],
  'People': ['users', 'user', 'hand-heart', 'handshake', 'mail', 'message-circle', 'phone', 'megaphone'],
  'Places and travel': ['map', 'map-pin', 'compass', 'plane', 'car', 'bus', 'train-front', 'tent', 'anchor', 'globe'],
  'Tools': ['ruler', 'scale', 'wrench', 'hammer', 'repeat', 'shuffle', 'hash'],
} as const;

export type GlyphName = (typeof GLYPH_GROUPS)[keyof typeof GLYPH_GROUPS][number];

export const GLYPH_NAMES: readonly GlyphName[] = Object.values(GLYPH_GROUPS).flat();

/** What shell and SDK components draw; never offered to the generator for a tile. */
export const CHROME_NAMES = [
  'chevron-left', 'chevron-right', 'chevron-down', 'arrow-left', 'arrow-up', 'x', 'check', 'plus', 'minus',
  'ellipsis', 'settings', 'search', 'copy', 'share', 'external-link', 'info', 'circle-alert', 'triangle-alert',
  'circle-check',
] as const;

export type ChromeName = (typeof CHROME_NAMES)[number];

/** The fallback glyph: drawn when nothing else resolves, never offered by name. */
export const FALLBACK_ICON = 'circle';

export type IconName = GlyphName | ChromeName | typeof FALLBACK_ICON;

/** Every name with vendored path data: the glyph set, the chrome set and the fallback. */
export const ICON_NAMES: readonly IconName[] = [...GLYPH_NAMES, ...CHROME_NAMES, FALLBACK_ICON];

/** Legacy Lucide names and plain synonyms, each to a name in the glyph or chrome set. */
export const ICON_ALIASES: Readonly<Record<string, GlyphName | ChromeName>> = {
  // system.md §3.1
  'home': 'house',
  'check-square': 'square-check',
  'alert-circle': 'circle-alert',
  'bar-chart-3': 'chart-column',
  'drop': 'droplet',
  'cart': 'shopping-cart',
  'checklist': 'list-checks',
  'trash': 'trash-2',
  // Lucide renames before 0.460
  'check-square-2': 'square-check',
  'square-check-big': 'square-check',
  'bar-chart': 'chart-column',
  'bar-chart-2': 'chart-column',
  'bar-chart-4': 'chart-column',
  'bar-chart-big': 'chart-column',
  'line-chart': 'chart-line',
  'pie-chart': 'chart-pie',
  'train': 'train-front',
  'edit': 'pencil',
  'edit-2': 'pencil',
  'edit-3': 'pencil',
  'alert-triangle': 'triangle-alert',
  'check-circle': 'circle-check',
  'check-circle-2': 'circle-check',
  'more-horizontal': 'ellipsis',
  // Synonyms and near variants
  'calendar-clock': 'calendar-days',
  'cup': 'coffee',
  'fork-knife': 'utensils',
  'utensils-crossed': 'utensils',
  'flower-1': 'flower',
  'tree': 'tree-pine',
  'fire': 'flame',
  'bolt': 'zap',
  'lightning': 'zap',
  'running': 'footprints',
  'heart-rate': 'heart-pulse',
  'paw': 'paw-print',
  'bin': 'trash-2',
  'trash-can': 'trash-2',
  'money': 'banknote',
  'cash': 'banknote',
  'dollar-sign': 'banknote',
  'bag': 'shopping-bag',
  'present': 'gift',
  'chart': 'chart-column',
  'graph': 'chart-line',
  'goal': 'target',
  'award': 'medal',
  'dice-1': 'dice-5',
  'dice-2': 'dice-5',
  'dice-3': 'dice-5',
  'dice-4': 'dice-5',
  'dice-6': 'dice-5',
  'gamepad': 'gamepad-2',
  'music-2': 'music',
  'music-3': 'music',
  'music-4': 'music',
  'microphone': 'mic',
  'photo': 'image',
  'pen': 'pencil',
  'notebook': 'notebook-pen',
  'bulb': 'lightbulb',
  'idea': 'lightbulb',
  'file': 'file-text',
  'people': 'users',
  'person': 'user',
  'message': 'message-circle',
  'chat': 'message-circle',
  'email': 'mail',
  'location': 'map-pin',
  'pin': 'map-pin',
  'airplane': 'plane',
  'world': 'globe',
  'tool': 'wrench',
  'loop': 'repeat',
  'random': 'shuffle',
  'more': 'ellipsis',
  'close': 'x',
  'add': 'plus',
  'gear': 'settings',
  'settings-2': 'settings',
  'share-2': 'share',
};

/**
 * The keyword table of `system.md` §3.1: whole lower-cased words (a trailing `*` matches any word that
 * starts with the stem; a hyphenated keyword matches those words in sequence). Table order breaks ties
 * only within one word position; earlier words in the name win.
 */
export const ICON_KEYWORDS: ReadonlyArray<readonly [GlyphName, readonly string[]]> = [
  ['timer', ['timer', 'countdown', 'pomodoro']],
  ['glass-water', ['water', 'drink', 'hydrat*']],
  ['alarm-clock', ['alarm', 'wake']],
  ['coffee', ['coffee', 'espresso', 'pour-over']],
  ['calendar-check', ['habit', 'streak', 'routine']],
  ['receipt', ['tip', 'bill', 'split']],
  ['list-checks', ['todo', 'task', 'checklist']],
  ['wallet', ['budget', 'spend*', 'expense']],
  ['dice-5', ['dice', 'roll']],
  ['coins', ['coin', 'flip']],
  ['sprout', ['plant', 'garden']],
  ['chef-hat', ['recipe', 'cook', 'meal']],
  ['dumbbell', ['workout', 'gym', 'reps']],
  ['footprints', ['run', 'walk', 'steps']],
  ['bed', ['sleep', 'nap']],
  ['smile', ['mood', 'feel*']],
  ['book-open', ['book', 'read*']],
  ['notebook-pen', ['note', 'journal', 'log']],
  ['trophy', ['score', 'game']],
  ['paw-print', ['pet', 'dog']],
];

export type IconDiagnosticKind = 'icon_alias' | 'icon_keyword' | 'icon_fallback';

/** Recorded whenever the requested name is not itself the drawn name. Never an error. */
export interface IconDiagnostic {
  kind: IconDiagnosticKind;
  /** The name as the app declared it. */
  requested: string;
  /** The name that is drawn. */
  resolved: IconName;
  message: string;
}

export interface IconResolution<N extends IconName = IconName> {
  name: N;
  diagnostic?: IconDiagnostic;
}

const GLYPH_SET: ReadonlySet<string> = new Set(GLYPH_NAMES);
const ICON_SET: ReadonlySet<string> = new Set([...GLYPH_NAMES, ...CHROME_NAMES]);

/** Lower-cased words of a name: split on anything not a letter or digit, and on camelCase humps. */
function wordsOf(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

function wordMatches(word: string, keyword: string): boolean {
  if (keyword.endsWith('*')) return word.startsWith(keyword.slice(0, -1));
  // A plain keyword also takes its plural: "habits" is a habit.
  return word === keyword || word === `${keyword}s`;
}

/** The glyph whose keyword matches earliest in `text`, if any. */
function keywordGlyph(text: string): GlyphName | undefined {
  const words = wordsOf(text);
  for (let at = 0; at < words.length; at++) {
    for (const [glyph, keywords] of ICON_KEYWORDS) {
      for (const keyword of keywords) {
        const parts = keyword.split('-');
        if (parts.every((part, i) => at + i < words.length && wordMatches(words[at + i], part))) return glyph;
      }
    }
  }
  return undefined;
}

function resolveIn<N extends IconName>(
  requested: string,
  appName: string | undefined,
  known: ReadonlySet<string>,
): IconResolution<N> {
  const name = requested.trim().toLowerCase();
  if (known.has(name)) {
    const resolution: IconResolution<N> = { name: name as N };
    if (name !== requested) {
      resolution.diagnostic = {
        kind: 'icon_alias',
        requested,
        resolved: name as N,
        message: `Icon "${requested}" is drawn as "${name}".`,
      };
    }
    return resolution;
  }
  const alias = Object.prototype.hasOwnProperty.call(ICON_ALIASES, name) ? ICON_ALIASES[name] : undefined;
  if (alias !== undefined && known.has(alias)) {
    return {
      name: alias as N,
      diagnostic: { kind: 'icon_alias', requested, resolved: alias, message: `Icon "${requested}" is drawn as "${alias}".` },
    };
  }
  const fromName = keywordGlyph(requested);
  const fromApp = fromName ?? (appName === undefined ? undefined : keywordGlyph(appName));
  if (fromApp !== undefined) {
    const source = fromName === undefined ? 'the app name' : 'its words';
    return {
      name: fromApp as N,
      diagnostic: {
        kind: 'icon_keyword',
        requested,
        resolved: fromApp,
        message: `Icon "${requested}" is not in the set; drawn as "${fromApp}" from ${source}.`,
      },
    };
  }
  return {
    name: FALLBACK_ICON as N,
    diagnostic: {
      kind: 'icon_fallback',
      requested,
      resolved: FALLBACK_ICON,
      message: `Icon "${requested}" is not in the set and matches no keyword; drawn as "${FALLBACK_ICON}".`,
    },
  };
}

/**
 * Resolves an `Icon name` against the glyph and chrome sets: exact name, then aliases, then the keyword
 * table on the name's words, then on `appName`'s words, else `circle`. Never throws, never blank.
 */
export function resolveIcon(name: string, appName?: string): IconResolution {
  return resolveIn<GlyphName | ChromeName | typeof FALLBACK_ICON>(name, appName, ICON_SET);
}

/** Resolves a tile glyph like `resolveIcon`, against the glyph set only (chrome names do not draw tiles). */
export function resolveGlyph(name: string, appName?: string): IconResolution<GlyphName | typeof FALLBACK_ICON> {
  return resolveIn<GlyphName | typeof FALLBACK_ICON>(name, appName, GLYPH_SET);
}
