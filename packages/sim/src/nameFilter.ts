/**
 * THE NAME FILTER (owner 2026-11-22: "build the reporting dash and account name and party name flags"; R-NAME-FILTER-01).
 *
 * One list for every name a player chooses: the account display name (`profiles.author`), the Duos team name
 * (`duos_teams.name`) and the Versus room name (the Cloudflare room). Two tiers:
 *  - BLOCK: a short list of slurs. The name is refused (the client says so before saving; the server refuses it too).
 *  - FLAG: a broader list (swearing, sexual words, staff impersonation). The name is allowed, and a row lands in the
 *    moderation queue of the private dev dashboard (apps/dash, Moderation tab) for a person to look at.
 *
 * MIRRORED INTO SQL verbatim: `moderation.name_verdict` in supabase/migrations/2026-11-28-moderation.sql carries the
 * same four lists and the same steps. `apps/dash/src/server/moderation.db.test.ts` fails when the lists or the verdicts
 * drift apart. It also checks that every word of the guides filter (packages/guides/src/wordFilter.ts) and of the DM
 * filter (packages/ui/src/friends/dm/profanity.ts) is caught here, so this is the superset for names.
 *
 * The steps, kept basic on purpose (it is a first pass, a person reviews the flags):
 *  1. camelCase is split ("FagLord" and "XXFagXX" read as "Fag Lord", "XX Fag XX"), accents stripped, lower case;
 *  2. look-alikes are undone: 0 o, 1 i, 3 e, 4 a, 5 s, 7 t, 9 g, @ a, $ s, ! i, | i. The name is ALSO read a second
 *     way with every digit as a space (so "Fag1" is caught as well as "N1gg3r"); a term matching either reading counts;
 *  3. the words are the runs of a to z; `joined` is every word run together (so "n i g g e r" and "x_nigger_x" match);
 *  4. stretched letters: runs of 3+ become 2, then repeated vowels become one, then (for a term with no double letter)
 *     every run becomes one;
 *  5. SUB terms match anywhere in `joined`; WORD terms match a whole word, with a few endings.
 *
 * Pure and dependency-free (the Versus Worker imports it through @game/sim too).
 */

/** Slurs matched anywhere in the name. */
export const NAME_BLOCK_SUB: readonly string[] = ['nigger', 'nigga', 'faggot', 'tranny', 'wetback'];
/** Slurs matched as a whole word (they occur inside innocent words: "spicy", "raccoon"). Endings: s, z. */
// rape / rapist / nazi / hitler blocked too (owner 2026-11-22: "All should be blocked"); they stay in the flag list so other
// forms ("raping", "nazis" past the block endings) are still flagged.
export const NAME_BLOCK_WORDS: readonly string[] = ['fag', 'kike', 'spic', 'chink', 'gook', 'coon', 'dyke', 'retard', 'retarded',
  'rape', 'rapist', 'nazi', 'hitler'];
/** Flagged anywhere in the name. */
export const NAME_FLAG_SUB: readonly string[] = [
  'fuck', 'fuk', 'fck', 'shit', 'cunt', 'bitch', 'pussy', 'whore', 'slut', 'asshole', 'arsehole', 'twat', 'wank', 'jizz',
  'dildo', 'cocksuck', 'dickhead', 'porn', 'penis', 'vagina', 'boob', 'hentai', 'killyourself',
  'teamascent', 'ascentteam', 'ascentofficial', 'ascentstaff',
];
/** Flagged as a whole word. Endings: s, es, z, ed, er, ers, ing, y. */
export const NAME_FLAG_WORDS: readonly string[] = [
  'ass', 'arse', 'tits', 'cum', 'cock', 'dick', 'prick', 'bastard', 'sex', 'anal', 'kys', 'stfu', 'gtfo', 'wtf',
  'rape', 'rapist', 'nazi', 'hitler', 'heil', 'negro',
  'admin', 'administrator', 'moderator', 'mod', 'developer', 'official', 'staff',
];

const BLOCK_ENDINGS = ['', 's', 'z'];
const FLAG_ENDINGS = ['', 's', 'es', 'z', 'ed', 'er', 'ers', 'ing', 'y'];
const SWAP_FROM = '0134579@$!|';
const SWAP_TO = 'oieastgasii';
/** The first seven look-alikes are digits. */
const DIGIT_SWAPS = 7;

export type NameVerdict = { verdict: 'ok'; term: null } | { verdict: 'flag' | 'block'; term: string };

const sq2 = (s: string): string => s.replace(/(.)\1{2,}/g, '$1$1');
const vsq = (s: string): string => s.replace(/([aeiou])\1+/g, '$1');
const sq1 = (s: string): string => s.replace(/(.)\1+/g, '$1');
const hasDouble = (s: string): boolean => /(.)\1/.test(s);
const hasDoubleVowel = (s: string): boolean => /([aeiou])\1/.test(s);

/** Steps 1 to 3: the words of a name, read with the look-alike digits as letters (`digits` false: as spaces). */
export function nameWords(name: string, digits = true): string[] {
  let s = name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
  s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let out = '';
  for (const ch of s) {
    const i = SWAP_FROM.indexOf(ch);
    out += i < 0 ? ch : !digits && i < DIGIT_SWAPS ? ' ' : SWAP_TO[i];
  }
  return out.split(/[^a-z]+/).filter(Boolean);
}

/** The forms of a word (or of the joined name) a term is compared with, given the term's own doubled letters. */
function forms(x: string, term: string): string[] {
  const two = sq2(x);
  const out = [two];
  if (!hasDoubleVowel(term)) out.push(vsq(two));
  if (!hasDouble(term)) out.push(sq1(x));
  return out;
}

const subHit = (joined: string, terms: readonly string[]): string | null =>
  terms.find((t) => forms(joined, t).some((f) => f.includes(t))) ?? null;

const wordHit = (words: string[], terms: readonly string[], endings: readonly string[]): string | null =>
  terms.find((t) => words.some((w) => forms(w, t).some((f) => endings.some((e) => f === t + e)))) ?? null;

/** Block (a slur), flag (for review) or ok, with the list term that matched. */
export function nameVerdict(name: string): NameVerdict {
  const readings = [nameWords(name, true), nameWords(name, false)].filter((w) => w.length > 0);
  const hit = (sub: readonly string[], words: readonly string[], endings: readonly string[]): string | null => {
    for (const w of readings) {
      const t = subHit(w.join(''), sub) ?? wordHit(w, words, endings);
      if (t) return t;
    }
    return null;
  };
  const block = hit(NAME_BLOCK_SUB, NAME_BLOCK_WORDS, BLOCK_ENDINGS);
  if (block) return { verdict: 'block', term: block };
  const flag = hit(NAME_FLAG_SUB, NAME_FLAG_WORDS, FLAG_ENDINGS);
  if (flag) return { verdict: 'flag', term: flag };
  return { verdict: 'ok', term: null };
}

/** True when the name may not be used at all (the client checks before saving; the server refuses it too). */
export const isBlockedName = (name: string): boolean => nameVerdict(name).verdict === 'block';

/** The error code the server answers for a refused name (the Duos team setter already used it). */
export const NAME_BLOCKED = 'name_blocked';

/** What the player reads when a name is refused (player text style: short plain sentences, no dashes). */
export const NAME_BLOCKED_TEXT = 'That name is not allowed. Please pick another one.';

/** The key a moderator's reset remembers (that account or team cannot take the same name back). */
export const nameKey = (name: string): string => sq1(nameWords(name).join(''));
