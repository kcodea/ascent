/**
 * DOC BOT 2.0 WP E — the target sub-grammar (grown 2026-09-11 from the three anchored shapes the first parser
 * knew into the general noun-phrase the corpus actually prints).
 *
 * A target phrase is  [determiner] [modifiers…] NOUN [location / relation tails…]  — "2 random friendly Dwarves",
 * "the right-most minion in the Shop", "a minion of each type", "your left and right-most minions", "the
 * highest-Health minion from your hand", "a Spirit on your board and in your hand". The grammar is
 * position-anchored and returns null (no consumption) when the head is not a noun it knows: it never guesses
 * a subject out of prose. `scope` is a normalized free-vocabulary string (modifiers + noun + tails, kebab
 * case) so a comparator can pattern-match it; `count` is the printed cardinality when the text prints one.
 *
 * Pure over the string — no engine state.
 */
import { AURA_TARGET_RE } from './lexicon';
import type { ParsedTarget } from './types';

export const COUNT_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
export const countOf = (w: string): number => COUNT_WORDS[w.toLowerCase()] ?? Number(w);
export const COUNT_RE = 'a|an|one|two|three|four|five|six|seven|\\d+';

/** Tribe / class nouns, singular and plural, as the corpus prints them. */
const TRIBE_NOUN =
  'Beasts?|Demons?|Dragons?|Dwarves|Dwarfs?|Dwarve|Kobolds?|Mechs?|Undead|Imps?|Spirits?|Celestials?|Rubies|Ruby'
  + '|Fodder|Attachments?|Magnetic Mechs?|Magnetics?|Golems?|Revelers?|Whelps?|Troopers?|Growths?|Nanobots?|Dwarven Ales?|Ales?'
  + '|Shop [Ss]pells?|shop spells?|Shop [Mm]inions?|Shop upgrades|rerolls|Refreshes|spells?|minions?|units?|cards?'
  + '|friends?|allies|ally|enemies|enemy|Echo minions?|Shout minions?|Rally minions?|Choose One cards?|End of Turn minions?'
  + '|Echo(?:es)?|Shouts?|Rall(?:y|ies)|hero powers?|Passages|Errands|Gifts?|Clues?|copies|copy|minion types|types|Tiers?';

/** Printed modifiers (all optional, any order, space-joined). */
const MOD =
  'random|other|different|friendly or [Ss]hop|friendly|enemy\'s(?! (?:Health|Attack|stats))|enemy|target|adjacent|next|first|last|left-most and right-most|right-most and left-most|left and right-most'
  + '|left-most|right-most|leftmost|rightmost|weakest|strongest|middle|entire|non-Gilded|Ruby-buffed|Shop-buffed'
  + '|highest-Health|highest-Attack|highest-Tier|lowest-Attack|Gilded|Golden|permanent|stat-granting|surviving|summoned'
  + '|plain|exact|extra|remembered|Shop|shop|Tier \\d+(?: or (?:lower|below))?|end';

const DET = 'a|an|the|your|all of your|all your|all of the|all of|all|each of your|each|both|every|another|one|any|its|their|this|that|those|ALL|these';

/** Location / relation tails that keep belonging to the noun phrase. */
const TAIL =
  'in the Shop|in the shop|in the tavern|in the current Shop|in your hand|in hand|on your board|on board'
  + '|on your board and in your hand|on board and in hand|and in your hand|and in hand|from the Shop|from your hand|from the tavern|from the new tier'
  + '|of each type|of every type|of the same type|of that type|of any type|of those types|of its type|of the same [Tt]ier|of its tier|of that Tier'
  + '|that give stats|and a random minion in your hand|of it|of your most common type|of the targeted minion\'s type|from your (?:next )?opponent\'s (?:warband|board)|from a type you do not control'
  + '|from your (?:Shop )?tier|from the tier above(?: (?:it|your Shop tier))?|one [Tt]ier higher|Tier \\d+ or (?:below|lower)|opposite this|to the left|to the right'
  + '|next to it|and its neighbours|with (?:a )?Shout|with Ward|with Taunt|with Rise|of your last opponent\'s board|that died this combat|that doesn\'t fit|that can\'t fit'
  + '|that killed this|you (?:control|own|summon|sell|buy|play|played this turn|kill next combat)|summoned (?:in|next) combat|(?:you )?summoned this combat'
  + '|in combat|next combat|this combat|in your hand this combat|of the (?:first|last) minion you kill next combat|each turn|you (?:cast|sold|played) this turn';

const NOUN_RE = new RegExp(`^(?:${TRIBE_NOUN})\\b`, 'i');
const MOD_RE = new RegExp(`^(?:${MOD})\\b`, 'i');
const DET_RE = new RegExp(`^(?:${DET})\\b`, 'i');
const COUNT_HEAD_RE = new RegExp(`^(?:${COUNT_RE})\\b`);
const TAIL_RE = new RegExp(`^ (?:${TAIL})\\b`);

const kebab = (s: string): string => s.trim().toLowerCase().replace(/['’]/g, '').replace(/[\s/]+/g, '-');

export interface TargetHit { target: ParsedTarget; len: number }

/**
 * A target phrase anchored at the start of `s`. Returns null (no consumption) for anything else.
 * `allowPronoun` lets "it" / "them" / "this" / "you" stand as a target (object position); subject position
 * passes false so "It also casts …" is not mis-read as a subject noun.
 */
export function targetPhrase(s: string, opts: { allowPronoun?: boolean } = {}): TargetHit | null {
  // The Aura noun (owner ruling 2026-08-28, LG-SCOPE-01): "your Beast Aura" — must precede the generic grammar.
  let m = AURA_TARGET_RE.exec(s);
  if (m && m.index === 0) {
    return { target: { cardinality: 'all', scope: `your-${m[1]!.toLowerCase()}-aura`, friendly: true }, len: m[0].length };
  }
  m = /^(?:this shop|the Shop|your Shop|the shop|the tavern|your entire board|your board|your hand)\b(?! [Ss]pells?\b| [Mm]inions?\b| upgrades?\b| slot\b| tier\b)/i.exec(s);
  if (m) return { target: { cardinality: 'all', scope: kebab(m[0]), friendly: !/tavern|the Shop|the shop/.test(m[0]) }, len: m[0].length };
  if (opts.allowPronoun !== false) {
    m = /^(?:this minion|this|it|them|they|you|the target|itself|herself)\b(?!['’])/i.exec(s);
    if (m) {
      const self = /^(?:this|itself|herself)/i.test(m[0]);
      const scope = /^them|they/i.test(m[0]) ? 'them' : /^you/i.test(m[0]) ? 'you' : /^it$/i.test(m[0]) ? 'it' : self ? 'self' : 'target';
      return {
        target: { cardinality: 'exactly', count: 1, scope, ...(self || scope === 'it' ? { friendly: true } : {}) },
        len: m[0].length,
      };
    }
  }

  let pos = 0;
  let count: number | undefined;
  let det = '';
  const mods: string[] = [];
  const dm = DET_RE.exec(s);
  if (dm) { det = dm[0].toLowerCase(); pos += dm[0].length; if (/^(?:a|an|one|another|any)$/.test(det)) count = 1; }
  else {
    const cm = COUNT_HEAD_RE.exec(s);
    if (cm) { count = countOf(cm[0]); pos += cm[0].length; }
  }
  for (;;) {
    const rest = s.slice(pos).replace(/^ /, '');
    const spaceLen = s.slice(pos).startsWith(' ') ? 1 : 0;
    if (pos > 0 && spaceLen === 0) break;
    const mm = MOD_RE.exec(rest);
    // A word that is both a modifier and a noun ('Shop', 'enemy') is a modifier only when another modifier or a
    // noun follows it ('Shop spells' → mod + noun; 'enemy (' → the noun 'enemy'); a longer multi-word noun
    // ('Shop upgrades', 'Magnetic Mech') outranks the modifier it starts with.
    const nn = NOUN_RE.exec(rest);
    if (mm && nn) {
      const after = rest.slice(mm[0].length).replace(/^ /, '');
      const continues = MOD_RE.test(after) || NOUN_RE.test(after);
      if (!continues || nn[0].length > mm[0].length) break;
    }
    if (!mm) {
      // "your 2 left-most Echoes" / "all 5 minion types" — a count after a determiner.
      const nm = /^(\d+|two|three)\b(?= )/.exec(rest);
      if (nm && det && count === undefined && /left-most|right-most|minion|other|random|highest|lowest|Echo|Shop|Rub/.test(rest.slice(nm[0].length + 1, nm[0].length + 12))) {
        count = countOf(nm[0]); pos += spaceLen + nm[0].length; continue;
      }
      break;
    }
    mods.push(mm[0]);
    pos += spaceLen + mm[0].length;
  }
  const restForNoun = s.slice(pos).replace(/^ /, '');
  const spaceLen = s.slice(pos).startsWith(' ') ? 1 : 0;
  if (pos > 0 && spaceLen === 0) return null;
  let nm = NOUN_RE.exec(restForNoun);
  // A capitalized card-name run as the noun ('Your Dawnclaws', 'all Spear Wardens', 'Money Bots') — only after
  // your/all or, with no determiner, when plural; never after a/an/the (those are the grammar's real nouns).
  if (!nm && mods.length === 0 && (/^(?:your|all|all your)$/i.test(det) || (!det && count === undefined))) {
    const cap = /^[A-Z][\w'’-]+(?: [A-Z][\w'’-]+)*/.exec(restForNoun);
    if (cap && (det || /s$/.test(cap[0])) && !/^(?:Aura|Shop|Tier|Gold)\b/.test(cap[0])) nm = cap;
  }
  if (!nm) return null;
  // "Beast or Dragon" / "Mech or Demon" — a tribe alternation reads as one noun.
  let noun = nm[0];
  let nounLen = nm[0].length;
  const alt = new RegExp(`^ (?:or|and) (?:${TRIBE_NOUN})\\b`).exec(restForNoun.slice(nounLen));
  if (alt) { noun += alt[0]; nounLen += alt[0].length; }
  pos += spaceLen + nounLen;
  const tails: string[] = [];
  const own = /^['’]s (?:Deathrattle|Echo|Shout|stats|Health|Attack)\b/.exec(s.slice(pos));
  if (own) { tails.push(own[0]); pos += own[0].length; }
  for (;;) {
    const tm = TAIL_RE.exec(s.slice(pos));
    if (!tm) break;
    tails.push(tm[0].trim());
    pos += tm[0].length;
  }
  if (!det && count === undefined && mods.length === 0 && tails.length === 0 && !/s$|^(?:Undead|Fodder|Rubies|minions|allies|enemies)$/.test(noun)) {
    // A bare singular noun with no determiner ("minion", "Beast") is not a phrase on its own.
    return null;
  }
  const friendly = /friendly|your|ally|allies|friend|adjacent/.test(`${det} ${mods.join(' ')} ${noun}`) || (/^(?:this|it)$/.test(det))
    ? true : /enemy|enemies/.test(`${mods.join(' ')} ${noun}`) ? false : undefined;
  const random = mods.includes('random');
  const plural = /s$/.test(noun) || /^(?:Undead|Fodder|Rubies)$/i.test(noun) || / (?:and|or) /.test(noun);
  const all = count === undefined && !mods.some((x) => /^next$/i.test(x)) && (plural || /^(?:each|every|all|all of your|all your|all of the|all of|both)$/.test(det));
  const scope = kebab([det === 'your' || det === 'the' ? det : '', ...mods, noun, ...tails].filter(Boolean).join(' '));
  return {
    target: {
      cardinality: all ? 'all' : 'exactly',
      ...(all ? {} : { count: count ?? (det === 'both' ? 2 : 1) }),
      scope,
      ...(friendly !== undefined ? { friendly } : {}),
      ...(random ? { random: true } : {}),
    },
    len: pos,
  };
}
