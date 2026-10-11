/**
 * GUIDES: the word filter and the reserved "by" lines (spec section 3). The game's first word filter.
 *
 * It is deliberately basic: whole-word matching after normalising case, accents, common letter swaps and stretched
 * letters, plus a few strong stems matched inside longer words. It is not a defence against a determined author;
 * Report and Hide (step 4) are. The owner reviews WORDS before publishing ships (step 3).
 *
 * Server and tests only: NOT exported from index.ts, so the list never ships in the player's bundle.
 * Dependency-free. Generated VERBATIM into supabase/functions/_shared/guidesWordFilter.ts.
 */
import type { GuideDraft } from './validate';

/** Matched as a whole word. */
const WORDS: readonly string[] = [
  'shit', 'shitty', 'cunt', 'bitch', 'asshole', 'dick', 'cock', 'pussy', 'whore', 'slut', 'bastard', 'retard', 'rape', 'rapist',
  'nigga', 'kike', 'spic', 'chink', 'tranny', 'nazi', 'hitler',
];
/** Matched anywhere inside a word: stems that do not occur inside innocent words. */
const STEMS: readonly string[] = ['fuck', 'nigger', 'faggot', 'bullshit'];

const SWAPS: Readonly<Record<string, string>> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };

/**
 * Lower case, accents stripped, letter swaps undone. "!" stands in for the letter i only INSIDE a word, which is when
 * a letter or another swap character follows it ("sh!t"). Anywhere else it is punctuation and is left alone, so it
 * ends the word like any other mark ("shit!" is the word "shit").
 */
const fold = (text: string): string =>
  text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/!(?=[a-z013457@$])/g, 'i')
    .replace(/[013457@$]/g, (c) => SWAPS[c] ?? c);

/** The words of a text: runs of a to z. */
const tokens = (text: string): string[] => fold(text).split(/[^a-z]+/).filter(Boolean);

/** "shiiiit" -> "shiit": runs of three or more become two. */
const squeeze2 = (s: string): string => s.replace(/(.)\1{2,}/g, '$1$1');
/** "shiit" -> "shit": every run becomes one. */
const squeeze1 = (s: string): string => s.replace(/(.)\1+/g, '$1');

const hasDouble = (s: string): boolean => /(.)\1/.test(s);
const WORD_SET: ReadonlySet<string> = new Set(WORDS);
/** Listed words with no doubled letter may also be matched fully squeezed ("shiit"). A word WITH a doubled letter
 *  is not, or "Niger" would match a longer listed word once both are squeezed. */
const WORD_SET_SQUEEZED: ReadonlySet<string> = new Set(WORDS.filter((w) => !hasDouble(w)));

export function isBlockedText(text: string): boolean {
  for (const t of tokens(text)) {
    const two = squeeze2(t);
    const one = squeeze1(t);
    if (WORD_SET.has(two) || WORD_SET_SQUEEZED.has(one)) return true;
    // A stem with a doubled letter is only matched un-squeezed, for the same reason as WORD_SET_SQUEEZED.
    for (const stem of STEMS) if (two.includes(stem) || (!hasDouble(stem) && one.includes(stem))) return true;
  }
  return false;
}

/** Stored with repeated letters collapsed, to match the collapsed input in isReservedByline. */
const RESERVED_PHRASES: readonly string[] = ['teamascent', 'ascentteam', 'ascentofficial'].map(squeeze1);
const RESERVED_WORDS: ReadonlySet<string> = new Set(['admin', 'moderator', 'developer', 'official'].map(squeeze1));

/** True when a "by" line would pass a guide off as the team's, or as staff. Repeated letters are collapsed before
 *  comparing, on both sides, so "Teaam Ascent" and "Aadmin" match the reserved lists. */
export function isReservedByline(text: string): boolean {
  const toks = tokens(text).map(squeeze1);
  const joined = squeeze1(toks.join(''));
  if (RESERVED_PHRASES.some((p) => joined.includes(p))) return true;
  return toks.some((t) => RESERVED_WORDS.has(t));
}

/** The first text rule a draft breaks, naming the field (never the word), or null. */
export function guideTextProblem(d: GuideDraft): { error: 'blocked_text' | 'reserved_name'; field: string } | null {
  if (isBlockedText(d.title)) return { error: 'blocked_text', field: 'title' };
  if (isBlockedText(d.tagline)) return { error: 'blocked_text', field: 'tagline' };
  if (isBlockedText(d.body)) return { error: 'blocked_text', field: 'body' };
  if (Object.keys(d.aliases).some(isBlockedText)) return { error: 'blocked_text', field: 'aliases' };
  if (!d.official) {
    if (isBlockedText(d.byline)) return { error: 'blocked_text', field: 'byline' };
    if (isReservedByline(d.byline)) return { error: 'reserved_name', field: 'byline' };
  }
  return null;
}
