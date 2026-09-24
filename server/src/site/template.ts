/**
 * server/src/site/template.ts — the pages host's one template language (design D23, legal-surface-v2
 * D7). Pure: no filesystem, no process.
 *
 *   {{NAME}}                            a value, HTML-escaped
 *   <!--IF:A&B-->…<!--ENDIF-->          kept only when every named value is non-empty
 *   <!--EACH:LIST:ko-->…<!--ENDEACH-->  repeated once per row of LIST, in that language
 *
 * Each block's text is rendered exactly once, so a substituted value is never read as template.
 */

/** Names the exact offending placeholder (or `'{{'` / `'<!--'` for a leftover marker). */
export class RenderPageError extends Error {
  constructor(
    public readonly placeholder: string,
    message: string,
  ) {
    super(message);
    this.name = 'RenderPageError';
  }
}

/** How a template name resolves: its value, what to say when a required one is empty, and what
 *  is wrong with a malformed one. */
interface Resolution {
  readonly value: string | undefined;
  readonly missing?: string;
  readonly invalid?: string;
}

/** `undefined` = a name the template may not use. */
export type Resolver = (name: string) => Resolution | undefined;

/** One resolver per row of the list, or `undefined` for a list or language the page may not use. */
export type ListResolver = (list: string, language: string) => readonly Resolver[] | undefined;

const NO_LISTS: ListResolver = () => undefined;

/** Deliberately not a single backtracking-prone regex (sonarjs `super-linear-regex`): split on
 *  `@` and check each side has no whitespace and the domain has an interior `.`. */
export function looksLikeEmail(value: string): boolean {
  const at = value.indexOf('@');
  if (at <= 0 || at === value.length - 1 || value.includes('@', at + 1)) return false;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (/\s/.test(local) || /\s/.test(domain)) return false;
  const dot = domain.lastIndexOf('.');
  return dot > 0 && dot < domain.length - 1;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const EACH_BLOCK_RE = /<!--EACH:([A-Z0-9_]+):([a-z]{2})-->([\s\S]*?)<!--ENDEACH-->/g;
const IF_BLOCK_RE = /<!--IF:([A-Z0-9_&]+)-->([\s\S]*?)<!--ENDIF-->/g;
const PLACEHOLDER_RE = /\{\{([A-Z0-9_]+)\}\}/g;
const LEFTOVER_BLOCK_RE = /<!--(?:IF:|ENDIF-->|EACH:|ENDEACH-->)/;

function renderBlock(source: string, resolve: Resolver, problems: RenderPageError[]): string {
  const working = source.replace(IF_BLOCK_RE, (_match, names: string, inner: string) => {
    let keep = true;
    for (const name of names.split('&')) {
      const resolution = resolve(name);
      if (resolution === undefined) problems.push(new RenderPageError(name, `unknown placeholder {{${name}}} in an IF block.`));
      if (!resolution?.value) keep = false;
    }
    return keep ? inner : '';
  });

  return working.replace(PLACEHOLDER_RE, (_match, name: string) => {
    const resolution = resolve(name);
    if (resolution === undefined) {
      problems.push(new RenderPageError(name, `unknown placeholder {{${name}}}.`));
      return '';
    }
    if (!resolution.value) {
      if (resolution.missing !== undefined) problems.push(new RenderPageError(name, resolution.missing));
      return '';
    }
    if (resolution.invalid !== undefined) {
      problems.push(new RenderPageError(name, resolution.invalid));
      return '';
    }
    return escapeHtml(resolution.value);
  });
}

/**
 * Renders `source`, collecting every problem into `problems` in document order: an unknown name
 * or list, a required value left empty, a malformed value, and any `{{` or block marker the
 * render left behind. The returned HTML is only publishable when `problems` stayed empty.
 */
export function renderTemplate(
  source: string,
  resolve: Resolver,
  problems: RenderPageError[],
  lists: ListResolver = NO_LISTS,
): string {
  let out = '';
  let last = 0;
  for (const match of source.matchAll(EACH_BLOCK_RE)) {
    const [whole, list, language, inner] = match;
    out += renderBlock(source.slice(last, match.index), resolve, problems);
    const rows = lists(list, language);
    if (rows === undefined) {
      problems.push(new RenderPageError(list, `unknown list <!--EACH:${list}:${language}-->.`));
    } else {
      for (const row of rows) out += renderBlock(inner, (name) => row(name) ?? resolve(name), problems);
    }
    last = match.index + whole.length;
  }
  out += renderBlock(source.slice(last), resolve, problems);

  if (LEFTOVER_BLOCK_RE.test(out)) {
    problems.push(new RenderPageError('<!--', 'an IF or EACH block marker was left unrendered.'));
  }
  if (out.includes('{{')) {
    problems.push(new RenderPageError('{{', 'a placeholder marker was left unrendered.'));
  }
  return out;
}
