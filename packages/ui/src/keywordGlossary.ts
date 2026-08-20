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
  { id: 'startofcombat', name: 'Start of Combat', aliases: [], badge: 'SC', def: 'Triggers immediately when combat begins, before any attacks.' },
  { id: 'endofturn', name: 'End of Turn', aliases: [], def: 'Triggers at the end of each of your shop turns.' },
  { id: 'avenge', name: 'Avenge', aliases: [], def: 'Triggers its effect once (x) friendly minions die during combat.' },
  { id: 'rally', name: 'Rally', aliases: [], badge: 'RL', def: 'Triggers each time this minion begins to attack in combat.' },
  { id: 'slaughter', name: 'Slaughter', aliases: [], badge: 'SL', def: 'Triggers whenever this minion kills an enemy.' },
  { id: 'chooseone', name: 'Choose One', aliases: [], def: 'When you play it, pick one of its two effects.' },
  { id: 'dawndusk', name: 'Dawn / Dusk', aliases: ['Dawn', 'Dusk'], def: 'Celestial cards alternate between Dawn and Dusk each combat; the active state picks which half of the effect fires.' },

  // --- Combat keywords ---
  { id: 'taunt', name: 'Taunt', aliases: [], badge: 'T', def: 'Enemies must attack this minion before any other until it is destroyed.' },
  { id: 'ward', name: 'Ward', aliases: ['Divine Shield'], badge: 'DS', def: 'Blocks the first instance of damage it would take, then breaks.' },
  { id: 'execute', name: 'Execute', aliases: ['Venomous'], badge: 'V', def: 'Any damage it deals to a minion destroys that minion. Lost after use.' },
  { id: 'flurry', name: 'Flurry', aliases: ['Windfury'], badge: 'W', def: 'When attacking in combat, attacks twice.' },
  { id: 'rise', name: 'Rise', aliases: ['Reborn'], badge: 'R', def: 'Returns with 1 health when destroyed.' },
  { id: 'cleave', name: 'Cleave', aliases: [], badge: 'C', def: 'Its attack also strikes the minions on both sides of its target.' },
  { id: 'crit', name: 'Critical Strike', aliases: ['Crit', 'Critical'], badge: 'CR', def: 'Its attack has a chance to deal double damage.' },
  { id: 'attachment', name: 'Attachment', aliases: ['Magnetic', 'Magnetize', 'Attach'], badge: 'M', def: 'When played to the left of a mech, it can fuse to it, adding its stats and keywords.' },
  { id: 'immune', name: 'Immune', aliases: [], badge: 'IMM', def: 'Takes no damage.' },
  { id: 'stealth', name: 'Stealth', aliases: [], badge: 'ST', def: "Can't be targeted until it attacks." },
  { id: 'engraved', name: 'Engraved', aliases: [], badge: 'EG', def: 'Keeps all stats gained during combat.' },

  // --- Mechanic nouns ---
  { id: 'consume', name: 'Consume', aliases: ['Consumes'], badge: 'CN', def: 'Devours a minion from shop to gain their stats.' },
  { id: 'fodder', name: 'Fodder', aliases: [], badge: 'FD', def: 'A minion that is automatically consumed by a random friendly demon when it appears in shop.' },
  { id: 'discover', name: 'Discover', aliases: [], def: 'Choose one of three offered cards to keep.' },
  { id: 'ruby', name: 'Ruby', aliases: ['Rubies'], def: 'A Kobold spell that can be applied to minions to permanently increase their stats. Not a shop spell.' },
  { id: 'ale', name: 'Dwarven Ale', aliases: ['Ale', 'Ales'], def: 'A set of Dwarf spells that provide various benefits. Count as shop spells.' },
  { id: 'shopspell', name: 'Shop spell', aliases: ['Shop spells'], def: 'A spell offered from the shop. Cannot be sold.' },
  { id: 'gilded', name: 'Gilded', aliases: ['Golden'], def: 'A single minion formed from 3 copies of itself that gains increased effects and combines all stats.' },
];
