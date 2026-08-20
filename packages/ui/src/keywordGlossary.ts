import type { Keyword } from '@game/core';

/**
 * The player-facing glossary for the keyword definition panel (`KeywordDefs`). ONE ordered source of truth:
 * `detectCardKeywords` scans a card against this list and the panel renders the hits in THIS order (never
 * text-appearance order, so the column never reflows between cards).
 *
 * `name` is the DISPLAYED term (post-`terms.ts` renaming — Ward, Echo, Flurry, Execute, Rise, Shout,
 * Attachment, Gilded); classic names live in `aliases` so detection still matches raw text. `badge` is the
 * schema keyword code when the term is also a badge keyword — those entries appear whenever the card carries
 * the badge, even if the word isn't in its text.
 *
 * Order: ability triggers, then combat keywords, then mechanic nouns. Definitions are owner-reviewed
 * (spec 2026-08-20). Tribe names are deliberately excluded.
 */
export interface KeywordDef {
  /** Stable key + React key. */
  id: string;
  /** Displayed header word, e.g. 'Ward'. */
  name: string;
  /** Extra strings to match in card text (classic names, plurals, etc.). */
  aliases: string[];
  /** The schema badge code, when this term is also a badge keyword. */
  badge?: Keyword;
  /** One-line player-facing definition. */
  def: string;
}

export const KEYWORD_GLOSSARY: KeywordDef[] = [
  // --- Ability triggers ---
  { id: 'shout', name: 'Shout', aliases: ['Battlecry'], def: 'Triggers when you play this minion from your hand.' },
  { id: 'echo', name: 'Echo', aliases: ['Deathrattle', 'Deathrattles', 'Echoes'], def: 'Triggers when this minion dies.' },
  { id: 'startofcombat', name: 'Start of Combat', aliases: [], badge: 'SC', def: 'Triggers once at the start of combat, before any attacks.' },
  { id: 'endofturn', name: 'End of Turn', aliases: [], def: 'Triggers at the end of each of your shop turns.' },
  { id: 'avenge', name: 'Avenge', aliases: [], def: 'After enough friendly minions have died this combat, triggers its effect.' },
  { id: 'rally', name: 'Rally', aliases: [], badge: 'RL', def: 'Triggers each time this minion attacks in combat.' },
  { id: 'slaughter', name: 'Slaughter', aliases: [], badge: 'SL', def: 'Triggers whenever this minion kills an enemy.' },
  { id: 'chooseone', name: 'Choose One', aliases: [], def: 'When you play it, pick one of its two effects.' },
  { id: 'dawndusk', name: 'Dawn / Dusk', aliases: ['Dawn', 'Dusk'], def: 'Celestial cards alternate between Dawn and Dusk each combat; the active state picks which half of the effect fires.' },

  // --- Combat keywords ---
  { id: 'taunt', name: 'Taunt', aliases: [], badge: 'T', def: 'Enemies must attack this minion before any other.' },
  { id: 'ward', name: 'Ward', aliases: ['Divine Shield'], badge: 'DS', def: 'Blocks the first instance of damage it would take, then breaks.' },
  { id: 'execute', name: 'Execute', aliases: ['Venomous'], badge: 'V', def: 'Any damage it deals to a minion destroys that minion.' },
  { id: 'flurry', name: 'Flurry', aliases: ['Windfury'], badge: 'W', def: 'Attacks twice each combat turn.' },
  { id: 'rise', name: 'Rise', aliases: ['Reborn'], badge: 'R', def: 'The first time it dies, it returns with 1 Health.' },
  { id: 'cleave', name: 'Cleave', aliases: [], badge: 'C', def: 'Its attack also strikes the minions beside its target.' },
  { id: 'crit', name: 'Crit', aliases: ['Critical'], badge: 'CR', def: 'Its attack has a chance to deal double damage.' },
  { id: 'attachment', name: 'Attachment', aliases: ['Magnetic', 'Magnetize', 'Attach'], badge: 'M', def: 'When played, can fuse onto a friendly minion, adding its stats and keywords.' },
  { id: 'immune', name: 'Immune', aliases: [], badge: 'IMM', def: 'Takes no damage.' },
  { id: 'stealth', name: 'Stealth', aliases: [], badge: 'ST', def: "Can't be attacked or targeted until it attacks." },
  { id: 'engraved', name: 'Engraved', aliases: [], badge: 'EG', def: 'Keeps the stat gains it earns during combat (normally combat buffs are shed afterward).' },

  // --- Mechanic nouns ---
  { id: 'consume', name: 'Consume', aliases: ['Consumes'], badge: 'CN', def: 'Devours a friendly minion (usually Fodder) to take its stats.' },
  { id: 'fodder', name: 'Fodder', aliases: [], badge: 'FD', def: 'A disposable minion meant to be eaten by Consume effects for its stats.' },
  { id: 'discover', name: 'Discover', aliases: [], def: 'Choose one of a few offered cards to add.' },
  { id: 'ruby', name: 'Ruby', aliases: ['Rubies'], def: "A spell-like token minted to your hand; drop it on a friendly minion to grant that minion the Ruby's Attack and Health as permanent stats." },
  { id: 'ale', name: 'Dwarven Ale', aliases: ['Ale', 'Ales'], def: "A token brewed by Dwarves; the more Ale you've brewed, the bigger your 'per Ale' payoffs." },
  { id: 'shopspell', name: 'Shop spell', aliases: ['Shop spells'], def: 'A spell cast in the shop (recruit phase), not in combat.' },
  { id: 'gilded', name: 'Gilded', aliases: ['Golden'], def: 'A minion made from three copies — stronger, with a doubled effect.' },
];
