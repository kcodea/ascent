import type { Keyword } from '@game/core';

/**
 * THE glossary — the ONE definition of every keyword / trigger / mechanic term the game's shipped text uses
 * (cards, spells, runes, Equipment, hero powers, Gifts). Three surfaces read it and none carries its own copy:
 *
 *   • the hover pill column (`KeywordDefs`, via `detectCardKeywords`) — every entry with a text hit or badge,
 *     rendered in THIS order (never text-appearance order, so the column never reflows between cards);
 *   • the Compendium glossary (`MinionBook.tsx`) — the same entries sectioned by `section`, each row wearing the
 *     medallion glyph of its `mechanic` (the `MECHANICS` registry) or its own `icon`, and clickable as a card
 *     filter when a card in scope carries it;
 *   • term colouring (`termColour.ts`) — every `name` + `aliases` is painted in rules text.
 *
 * `name` is the DISPLAYED term (post-`terms.ts` renaming — Ward, Echo, Flurry, Execute, Rise, Shout, Attachment,
 * Gilded); classic names live in `aliases` so detection still matches raw text. `badge` is the schema keyword
 * code when the term is also a badge keyword — those entries appear whenever the card carries the badge, even
 * if the word isn't in its text. `detectRe` raises the pill on a lower-case phrase the text uses instead of a
 * capitalised term ("summon … from your hand", "permanently") — those phrases are detected but never coloured.
 *
 * A term is added here in the SAME PR that adds it to shipped text — `keywordGlossaryCoverage.test.ts` walks
 * every shipped text both ways (every coloured term has a definition; every definition is used somewhere, or is
 * listed there as deliberately kept). Definitions are owner-reviewed (spec 2026-08-20; Equip / Starform /
 * Collapse / Amplified verbatim 2026-09-18); the true-up of 2026-09-18 re-read the engine for each. Tribe names
 * are deliberately excluded (they are coloured, not defined).
 */
export type GlossarySection = 'triggers' | 'combat' | 'build' | 'tokens';

/** The Compendium's section order + titles. */
export const GLOSSARY_SECTIONS: readonly { id: GlossarySection; title: string }[] = [
  { id: 'triggers', title: 'Triggers' },
  { id: 'combat', title: 'Combat keywords' },
  { id: 'build', title: 'Build & shop' },
  { id: 'tokens', title: 'Spells & tokens' },
];

export interface KeywordDef {
  /** Stable key + React key. */
  id: string;
  /** Displayed header word, e.g. 'Ward'. */
  name: string;
  /** Extra strings to match in card text (classic names, plurals, etc.). Coloured like the name. */
  aliases: string[];
  /** The schema badge code, when this term is also a badge keyword. */
  badge?: Keyword;
  /** One-line player-facing definition. */
  def: string;
  /** Compendium section. */
  section: GlossarySection;
  /** Extra detection on a lower-case phrase (never coloured). */
  detectRe?: RegExp;
  /** When set, REPLACES the name / alias word-boundary matcher for pill detection AND term colouring: the name is
   *  the displayed header but is never matched on its own. For a term whose bare word is also ordinary text
   *  (Sell: "Sell a friendly minion", "Sells for 2 Gold") so only its keyword form raises the pill. */
  match?: RegExp;
  /** The `MECHANICS` registry id this term IS — the Compendium row takes that mechanic's glyph + card predicate. */
  mechanic?: string;
  /** Compendium glyph for a term with no registry mechanic (`Icon.tsx` name). */
  icon?: string;
  /** false = Compendium only, never a hover pill (Watcher has no text term). Default true. */
  pill?: boolean;
  /** true = the Compendium row is never a card filter (Gilded is a display state, not a card property). */
  inert?: boolean;
}

export const KEYWORD_GLOSSARY: KeywordDef[] = [
  // ── Triggers ───────────────────────────────────────────────────────────────────────────────────────────────
  { id: 'shout', name: 'Shout', aliases: ['Battlecry'], section: 'triggers', mechanic: 'shout', def: 'Triggers when you play this minion from your hand.' },
  { id: 'echo', name: 'Echo', aliases: ['Deathrattle', 'Deathrattles', 'Echoes'], section: 'triggers', mechanic: 'echo', def: 'Triggers when this minion dies.' },
  { id: 'startofcombat', name: 'Start of Combat', aliases: [], badge: 'SC', section: 'triggers', mechanic: 'startCombat', def: 'Triggers immediately when combat begins, before any attacks.' },
  { id: 'startofturn', name: 'Start of Turn', aliases: [], section: 'triggers', icon: 'refresh', def: 'Triggers at the start of each of your shop turns.' },
  { id: 'endofturn', name: 'End of Turn', aliases: [], section: 'triggers', mechanic: 'endTurn', def: 'Triggers at the end of each of your shop turns, before you fight.' },
  { id: 'avenge', name: 'Avenge', aliases: [], section: 'triggers', mechanic: 'avenge', def: 'Avenge (N): triggers each time N of your minions have died this combat.' },
  // Pummel (owner keyword 2026-09-21): the damage-dealt threshold trigger — "**Pummel (40):** …" on Han Gover,
  // "**Pummel (6):** …" on Goldvein. Declared like Avenge (N): the name matches the printed "Pummel (X)" on its
  // word boundary, the number stays in the card text, and the `pummel` mechanic supplies the medallion glyph.
  { id: 'pummel', name: 'Pummel', aliases: ['Pummels'], section: 'triggers', mechanic: 'pummel', def: 'Pummel (X): Triggers each time this minion has dealt another X damage. The damage count carries over between combats.' },
  { id: 'rally', name: 'Rally', aliases: [], badge: 'RL', section: 'triggers', mechanic: 'rally', def: 'Triggers each time this minion begins to attack in combat.' },
  { id: 'slaughter', name: 'Slaughter', aliases: [], badge: 'SL', section: 'triggers', mechanic: 'slaughter', def: 'Triggers whenever this minion kills an enemy.' },
  // Overflow (owner keyword 2026-09-19): the `summonOverflow` trigger's printed form — "**Overflow:** …" on every
  // card / rune that reacts to a summon finding no room. Wording is the owner's verbatim.
  { id: 'overflow', name: 'Overflow', aliases: [], section: 'triggers', mechanic: 'overflow', def: 'When a minion is summoned, but does not have space on your board.' },
  // Sell (owner keyword 2026-09-23): the `onSell` trigger's printed form, "**Sell:** …" on every minion that does
  // something when IT is sold (Hoard Whelp, Salvatore McKlusky, River Drake, Beggy, Cheap Date, Traveling Salesman,
  // the three Revelers). `match` pins detection + colouring to the keyword form: the bare verb is ordinary text on
  // the sell spells ("Sell a friendly minion") and the sell-value lines ("Sells for 2 Gold"), which must not raise
  // a pill that says "this minion". No schema badge and no medallion mechanic; the pill renders from the text hit,
  // like Shout. Wording is the owner's verbatim.
  { id: 'sell', name: 'Sell', aliases: [], section: 'triggers', mechanic: 'sell', match: /(?<![A-Za-z])Sell(?=\s*[:：])/, def: 'Triggers when this minion is sold.' },
  { id: 'bleed', name: 'Bleed', aliases: [], section: 'triggers', mechanic: 'bleed', def: "Marks random enemies at Start of Combat. Every few attacks in the fight, each marked enemy still alive takes this minion's Attack." },
  { id: 'chooseone', name: 'Choose One', aliases: [], section: 'triggers', mechanic: 'chooseOne', def: 'When you play it, pick one of its two effects.' },
  // Compendium-only: no shipped text says "Watcher" — the medallion + codex row name the reactive family.
  // Wording is the owner's verbatim (2026-09-21).
  { id: 'watcher', name: 'Watcher', aliases: [], section: 'triggers', mechanic: 'watcher', pill: false, def: 'A card that triggers off other minions.' },

  // ── Combat keywords ────────────────────────────────────────────────────────────────────────────────────────
  { id: 'taunt', name: 'Taunt', aliases: [], badge: 'T', section: 'combat', mechanic: 'taunt', def: 'Enemies must attack this minion before any other until it is destroyed.' },
  { id: 'ward', name: 'Ward', aliases: ['Divine Shield'], badge: 'DS', section: 'combat', mechanic: 'ward', def: 'Blocks the first instance of damage it would take, then breaks.' },
  // Owner's wording verbatim (2026-09-26). A Resilient Ward also carries Ward (DS), so both pills show.
  { id: 'resilientward', name: 'Resilient Ward', aliases: [], badge: 'RW', section: 'combat', icon: 'shield', def: 'Takes 2 hits to break.' },
  { id: 'execute', name: 'Execute', aliases: ['Venomous'], badge: 'V', section: 'combat', mechanic: 'execute', def: 'Any damage it deals to a minion destroys that minion. Lost after use.' },
  { id: 'flurry', name: 'Flurry', aliases: ['Windfury'], badge: 'W', section: 'combat', mechanic: 'flurry', def: 'When attacking in combat, attacks twice.' },
  { id: 'crit', name: 'Critical Strike', aliases: ['Crit', 'Critical'], badge: 'CR', section: 'combat', mechanic: 'crit', def: 'Its attack has a chance to deal double damage.' },
  // Rise returns the PRINTED body at 1 Health; Rebirth returns the full current body (GAME-RULES, 2026-09-16).
  { id: 'rise', name: 'Rise', aliases: ['Reborn'], badge: 'R', section: 'combat', mechanic: 'rise', def: 'Returns once when destroyed, with its printed stats at 1 Health.' },
  { id: 'rebirth', name: 'Rebirth', aliases: [], badge: 'RB', section: 'combat', mechanic: 'rebirth', def: 'Returns once when destroyed with all of its stats, buffs and keywords.' },
  { id: 'cleave', name: 'Cleave', aliases: [], badge: 'C', section: 'combat', mechanic: 'cleave', def: 'Its attack also strikes the minions on both sides of its target.' },
  { id: 'immune', name: 'Immune', aliases: [], badge: 'IMM', section: 'combat', mechanic: 'immune', def: 'Takes no damage.' },
  { id: 'stealth', name: 'Stealth', aliases: [], badge: 'ST', section: 'combat', mechanic: 'stealth', def: "Can't be attacked until it attacks, then loses Stealth." },
  { id: 'engraved', name: 'Engraved', aliases: [], badge: 'EG', section: 'combat', mechanic: 'engraved', def: 'Keeps all stats gained during combat.' },
  // "permanently" marks a combat-time gain that outlives the fight (LG-DURATION); shop gains are permanent by default.
  // Wording is the owner's verbatim (2026-09-21).
  { id: 'permanent', name: 'Permanent', aliases: [], section: 'combat', icon: 'heart', detectRe: /\bpermanent(?:ly)?\b/, def: 'Imbues/Buffs carry through the run permanently.' },

  // ── Build & shop ───────────────────────────────────────────────────────────────────────────────────────────
  // Attachment welds by DROPPING the card onto a friendly minion that shares one of its types (`magnetizesTo`).
  { id: 'attachment', name: 'Attachment', aliases: ['Magnetic', 'Magnetize', 'Attach'], badge: 'M', section: 'build', mechanic: 'attachment', def: 'Play it directly onto a friendly minion that shares its type to fuse in its stats and keywords.' },
  { id: 'consume', name: 'Consume', aliases: ['Consumes'], badge: 'CN', section: 'build', mechanic: 'consume', def: 'Devours a minion from shop to gain their stats.' },
  { id: 'fodder', name: 'Fodder', aliases: [], badge: 'FD', section: 'build', mechanic: 'fodder', def: 'A minion that is automatically consumed by a random friendly demon when it appears in shop.' },
  { id: 'discover', name: 'Discover', aliases: [], section: 'build', mechanic: 'discover', def: 'Choose one of three offered cards to keep.' },
  // Card text spells this lower-case ("When you spend 5 Gold, …"), never as the capitalised term, so the name
  // match never fires — `detectRe` is the only hit (Coinfire Forewoman, Tapkeeper, and the other gold-sink cards).
  { id: 'spend', name: 'Spend', aliases: [], section: 'build', mechanic: 'spend', detectRe: /\bspend\b/i, def: 'Triggers an effect based on how much Gold you spend this turn.' },
  // LG-IMPROVE-01: "Improve(s) this by +X/+X per N" — the raised number is run-permanent and printed live.
  { id: 'improve', name: 'Improve', aliases: ['Improves', 'Improving'], section: 'build', icon: 'up', detectRe: /\bimprov(?:e|es|ing)\b/, def: 'Raises the number this effect uses for the rest of the run. The card always shows the current value.' },
  // Aura — the run-wide scope noun (owner ruling 2026-08-28): "your <Tribe> Aura". Wording is the owner's
  // verbatim (2026-09-21).
  { id: 'aura', name: 'Aura', aliases: ['Auras'], section: 'build', icon: 'up', def: 'A run wide bonus for every minion that it suits. Carries through shop and combat phases.' },
  // The Spirits' hand-summon (owner design 2026-09-09): an exact copy at the moment of summon, the card stays.
  { id: 'summonfromhand', name: 'Summon from hand', aliases: [], section: 'build', icon: 'house', detectRe: /\bsummon(?:ed|s)?\b[^.]*?\bfrom your hand\b/, def: 'Summons an exact copy of a minion in your hand into combat. The card stays in your hand and can be summoned this way once per combat.' },
  // Equipment minions print "**Equip <Name> (cost):**" — the word "Equip" is the text hit that raises the pill
  // (no schema badge: `on: 'equip'` is an effect trigger, not a keyword). Runes that say "Equip minion" raise it too.
  { id: 'equip', name: 'Equip', aliases: [], section: 'build', mechanic: 'equip', def: 'Can be triggered once per turn, per equipment, for a cost.' },
  { id: 'equipment', name: 'Equipment', aliases: [], section: 'build', icon: 'anvil', def: 'An ability granted by an Equip minion, held in a slot beside your hero power. Rebuilt every Start of Turn from the minions you still have.' },
  // Wording is the owner's verbatim (2026-09-18).
  { id: 'amplified', name: 'Amplified', aliases: ['Amplify', 'Amplifies'], section: 'build', icon: 'gear', def: 'An Amplified Equipment will trigger its effect twice for no additional gold.' },
  { id: 'gilded', name: 'Gilded', aliases: ['Golden', 'Gild', 'Gilding'], section: 'build', icon: 'crown', inert: true, def: 'A single minion formed from 3 copies of itself that gains increased effects and combines all stats.' },

  // ── Spells & tokens ────────────────────────────────────────────────────────────────────────────────────────
  { id: 'shopspell', name: 'Shop spell', aliases: ['Shop spells', 'Shop Spell', 'Shop Spells'], section: 'tokens', icon: 'mana', def: 'A spell offered from the shop. Cannot be sold.' },
  { id: 'ruby', name: 'Ruby', aliases: ['Rubies'], section: 'tokens', icon: 'ember', def: 'A Kobold spell that can be applied to minions to permanently increase their stats. Not a shop spell.' },
  { id: 'ale', name: 'Dwarven Ale', aliases: ['Ale', 'Ales'], section: 'tokens', icon: 'flame', def: 'A set of Dwarf spells that provide various benefits. Count as shop spells.' },
  // Gifts (owner design 2026-08-26): a spell class of its own — see `cards/gifts.ts`.
  { id: 'gift', name: 'Gift', aliases: ['Gifts'], section: 'tokens', icon: 'gift', def: 'A free spell put into your hand by a rune, hero or card. It casts like any spell but is never a Shop spell: never in the Shop, never Discovered, never copied.' },
  { id: 'clue', name: 'Clue', aliases: ['Clues'], section: 'tokens', icon: 'gift', def: 'A free hand spell: give a friendly minion +1/+1, then every later Clue gives +1/+1 more.' },
  // Set 3's Celestial token + its cash-out verb (owner ask 2026-09-12: "Collapse" gets its own pill and the Starform
  // itself is a noun the cards reference, so it is explained on the side too). Neither is a schema badge — the
  // pills render from the text hit alone, like Shout — so `badge` is deliberately absent (the badge test pins the
  // 17 schema codes exactly). The Starform pill shows on every Celestial that names it; the owner wants that.
  // Wording is the owner's verbatim (2026-09-18).
  { id: 'starform', name: 'Starform', aliases: ['Starforms'], section: 'tokens', icon: 'star', def: 'A minion that occupies a Shop slot and stays in place until purchased or destroyed. Purchasing a Starform grants stats to the left-most Celestial.' },
  { id: 'collapse', name: 'Collapse', aliases: ['Collapses'], section: 'tokens', icon: 'skull', def: "Grant 50% of your Starform's stats to 3 Celestials and destroy it." },
];

/** Glossary entries that can raise a hover pill (everything but the Compendium-only rows). */
export const PILL_GLOSSARY: KeywordDef[] = KEYWORD_GLOSSARY.filter((d) => d.pill !== false);

/** Entries by id. */
export const GLOSSARY_BY_ID: Readonly<Record<string, KeywordDef>> = Object.fromEntries(KEYWORD_GLOSSARY.map((d) => [d.id, d]));
