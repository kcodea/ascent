/**
 * THE RULES WIKI — the Compendium's searchable "how does this work?" Q&A (spec
 * docs/superpowers/specs/2026-09-28-rules-wiki-design.md). Entries are data only, one file per topic.
 *
 * VOICE: casual and player-level. Say what the player SEES and can DO, never how it's built (owner 2026-09-28:
 * no "seeded so replays match", just "it's a coin flip"). Every answer is checked against the code when written.
 * `covers` names the approved rules / glossary keywords it leans on, so `rulesWiki.test.ts` reddens the moment
 * one of them changes.
 */

export type WikiTopic = 'basics' | 'shop' | 'combat' | 'keywords' | 'lobby' | 'questsRunes' | 'controls' | 'glossary';

/** The chip row, in display order. */
export const WIKI_TOPICS: readonly { id: WikiTopic; label: string }[] = [
  { id: 'basics', label: 'Basics' },
  { id: 'shop', label: 'Shop' },
  { id: 'combat', label: 'Combat' },
  { id: 'keywords', label: 'Keywords' },
  { id: 'lobby', label: 'Lobby & Rating' },
  { id: 'questsRunes', label: 'Quests & Runes' },
  { id: 'controls', label: 'Controls' },
  { id: 'glossary', label: 'Glossary' },
];

/** What an answer depends on, fingerprinted at the moment the answer was checked. */
export type WikiCover =
  | { rule: string; fp: string } // an approved `R-…` rule id + fingerprint(statement)
  | { keyword: string; fp: string }; // a KEYWORD_GLOSSARY id + fingerprint(def)

export interface WikiEntry {
  /** Stable kebab slug. Never recycled. */
  id: string;
  topic: WikiTopic;
  /** The question, the way a player would ask it. Ends with `?`. */
  q: string;
  /** The answer: casual, a few short sentences, `**bold**` allowed. */
  a: string;
  /** Other phrasings / words a player might search for. Never shown. */
  aliases?: string[];
  /** Ids of related entries, shown as "See also" links. */
  seeAlso?: string[];
  /** The tripwire: what this answer depends on. */
  covers?: WikiCover[];
}
