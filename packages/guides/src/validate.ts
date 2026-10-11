/**
 * GUIDES: shape and limit validation for a guide being saved. Text rules (the word filter) are in wordFilter.ts;
 * row rules (ownership, the 20-guide cap, the rate limit, edit conflicts) are in the SQL functions.
 *
 * Dependency-free. Generated VERBATIM into supabase/functions/_shared/guidesValidate.ts.
 */
import { CARD_ID_RE, FORBIDDEN_KEYS, GUIDE_LIMITS, SET_ID_RE, SLUG_RE, TRIBE_RE, UUID_RE } from './types';

/** A guide as the save path accepts it, already cleaned. */
export interface GuideDraft {
  /** Null = a new guide. */
  id: string | null;
  /** The revision the editor loaded. Required with `id`. */
  revision: number | null;
  /** Import only. */
  slug: string | null;
  official: boolean;
  byline: string;
  sets: string[];
  tribes: string[];
  pairsWith: string[];
  iconCard: string;
  title: string;
  tagline: string;
  body: string;
  core: string[];
  enablers: string[];
  mentions: string[];
  aliases: Record<string, string>;
  forkedFrom: string | null;
}

export type GuideValidation = { ok: true; draft: GuideDraft } | { ok: false; error: 'bad_guide'; field: string };

/**
 * Zero-width characters, bidi controls (including the isolates) and blank-rendering fillers (the Hangul fillers
 * U+115F, U+1160, U+3164 and U+FFA0, the Khmer inherent vowels U+17B4 and U+17B5, the blank Braille cell U+2800):
 * invisible, and a way to fake an empty or reordered title. The variation selectors (U+FE00 to U+FE0F) are
 * deliberately NOT here: stripping them changes how ordinary emoji render.
 */
const INVISIBLE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\u2800\u3164\uFEFF\uFFA0]/g;

/** One line of clean text: invisible characters removed, every whitespace run one space, trimmed. */
export function cleanText(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.normalize('NFC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
}

/** Length in code points, so an emoji counts once. */
const len = (s: string): number => [...s].length;

const fail = (field: string): GuideValidation => ({ ok: false, error: 'bad_guide', field });

/** A list of strings matching `re`, at most `max`, with no repeats and none of `forbidden`. Null when it is not that. */
function list(v: unknown, re: RegExp, max: number, forbidden?: ReadonlySet<string>): string[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > max) return null;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string' || !re.test(x) || forbidden?.has(x) || out.includes(x)) return null;
    out.push(x);
  }
  return out;
}

export function validateGuideDraft(v: unknown, opts: { requireSlug?: boolean } = {}): GuideValidation {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail('guide');
  const o = v as Record<string, unknown>;
  const official = o.official === true;

  let id: string | null = null;
  let revision: number | null = null;
  if (o.id !== undefined && o.id !== null) {
    if (typeof o.id !== 'string' || !UUID_RE.test(o.id)) return fail('id');
    id = o.id;
    if (typeof o.revision !== 'number' || !Number.isInteger(o.revision) || o.revision < 1) return fail('revision');
    revision = o.revision;
  }

  let slug: string | null = null;
  if (opts.requireSlug) {
    if (typeof o.slug !== 'string' || !SLUG_RE.test(o.slug)) return fail('slug');
    slug = o.slug;
  }

  const title = cleanText(o.title);
  if (len(title) < 1 || len(title) > GUIDE_LIMITS.title) return fail('title');
  const tagline = cleanText(o.tagline);
  if (len(tagline) > GUIDE_LIMITS.tagline) return fail('tagline');
  const body = cleanText(o.body);
  if (len(body) < 1 || len(body) > GUIDE_LIMITS.body) return fail('body');
  const byline = cleanText(o.byline);
  if (!official && (len(byline) < 1 || len(byline) > GUIDE_LIMITS.byline)) return fail('byline');

  const sets = list(o.sets, SET_ID_RE, GUIDE_LIMITS.sets);
  if (!sets || sets.length < 1) return fail('sets');
  const tribes = list(o.tribes, TRIBE_RE, GUIDE_LIMITS.tribes);
  if (!tribes) return fail('tribes');
  const pairsWith = list(o.pairsWith, TRIBE_RE, GUIDE_LIMITS.pairsWith);
  if (!pairsWith) return fail('pairsWith');

  if (typeof o.iconCard !== 'string' || !CARD_ID_RE.test(o.iconCard) || FORBIDDEN_KEYS.has(o.iconCard)) return fail('iconCard');
  const core = list(o.core, CARD_ID_RE, GUIDE_LIMITS.core, FORBIDDEN_KEYS);
  if (!core || core.length < 1) return fail('core');
  const enablers = list(o.enablers, CARD_ID_RE, GUIDE_LIMITS.enablers, FORBIDDEN_KEYS);
  if (!enablers) return fail('enablers');
  const mentions = list(o.mentions, CARD_ID_RE, GUIDE_LIMITS.mentions, FORBIDDEN_KEYS);
  if (!mentions) return fail('mentions');

  // A plain object, so it serialises and compares normally. The refusals below are what keep `__proto__` (which would
  // be dropped silently on assignment) and Object's other member names out of its keys and its values.
  const aliases: Record<string, string> = {};
  if (o.aliases !== undefined && o.aliases !== null) {
    if (typeof o.aliases !== 'object' || Array.isArray(o.aliases)) return fail('aliases');
    const entries = Object.entries(o.aliases as Record<string, unknown>);
    if (entries.length > GUIDE_LIMITS.aliases) return fail('aliases');
    const listed = new Set([...core, ...enablers, ...mentions]);
    for (const [word, target] of entries) {
      const w = cleanText(word);
      if (len(w) < 1 || len(w) > GUIDE_LIMITS.aliasWord || FORBIDDEN_KEYS.has(w)) return fail('aliases');
      if (typeof target !== 'string' || FORBIDDEN_KEYS.has(target) || !listed.has(target)) return fail('aliases');
      aliases[w] = target;
    }
  }

  let forkedFrom: string | null = null;
  if (o.forkedFrom !== undefined && o.forkedFrom !== null) {
    if (typeof o.forkedFrom !== 'string' || !UUID_RE.test(o.forkedFrom)) return fail('forkedFrom');
    forkedFrom = o.forkedFrom;
  }

  return { ok: true, draft: { id, revision, slug, official, byline, sets, tribes, pairsWith, iconCard: o.iconCard, title, tagline, body, core, enablers, mentions, aliases, forkedFrom } };
}

/** The jsonb document `guide_save` and `guide_import_builtins` read (snake_case keys). */
export function draftToSqlDoc(d: GuideDraft): Record<string, unknown> {
  return {
    id: d.id,
    revision: d.revision,
    slug: d.slug,
    official: d.official,
    byline: d.byline,
    sets: d.sets,
    tribes: d.tribes,
    pairs_with: d.pairsWith,
    icon_card: d.iconCard,
    title: d.title,
    tagline: d.tagline,
    body: d.body,
    core: d.core,
    enablers: d.enablers,
    mentions: d.mentions,
    aliases: d.aliases,
    forked_from: d.forkedFrom,
  };
}
