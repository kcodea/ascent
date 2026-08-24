/**
 * PATCH NOTES — the player-facing, gameplay-only changelog shown from the title screen.
 *
 * ONE ENTRY PER PATCH, NEWEST FIRST. Each entry is a date (the patch's ship date, absolute) with an optional
 * short version label, and a flat list of changes tagged by category. The viewer renders these verbatim, so
 * the text here IS what the player reads — keep it plain-English and spoiler-light (say "reworked", not the
 * internal id).
 *
 * ⚠ MAINTENANCE CONTRACT (owner 2026-08-24): whenever a GAMEPLAY change ships — a new/changed hero, card or
 * rune, or an in-game UI/information change — ADD IT HERE in the same PR, at the top. Non-gameplay work
 * (build, tests, docs, refactors, dev tools) does NOT belong here. See `.claude/skills/ascent-content` and
 * `ascent-gameplay`, which both carry this instruction, and CLAUDE.md's documentation section.
 */

/** The buckets the owner asked for. `UI / Info` covers in-game presentation + information changes (pills,
 *  trackers, tooltips, screens) — never engine/build/tooling. */
export type PatchCategory =
  | 'New Hero'
  | 'New Card'
  | 'Hero Change'
  | 'Card Change'
  | 'New Rune'
  | 'Rune Change'
  | 'UI / Info';

/** Fixed display order + accent hue token for each category (so a patch's changes group predictably and the
 *  same category always wears the same colour). The hue tokens resolve in styles.css. */
export const PATCH_CATEGORY_ORDER: PatchCategory[] = [
  'New Hero', 'Hero Change', 'New Card', 'Card Change', 'New Rune', 'Rune Change', 'UI / Info',
];

export interface PatchChange {
  category: PatchCategory;
  /** Plain-English, player-facing. One change per entry. */
  text: string;
}

export interface PatchNote {
  /** Absolute ship date, YYYY-MM-DD. Shown as the patch's headline. */
  date: string;
  /** Optional short version/label (e.g. "Hero Batch"). Shown beside the date when present. */
  label?: string;
  changes: PatchChange[];
}

/** Newest first. PREPEND new entries. */
export const PATCH_NOTES: PatchNote[] = [
  {
    date: '2026-08-24',
    label: 'Menu Polish',
    changes: [
      { category: 'UI / Info', text: 'Added this Patch Notes screen — gameplay changes by date, opened from the title.' },
      { category: 'UI / Info', text: 'Title-screen button tooltips now use the game’s own styling instead of the plain browser tooltip.' },
      { category: 'UI / Info', text: 'Hero power and rune hover tooltips are 30% larger and easier to read.' },
    ],
  },
  {
    date: '2026-08-24',
    label: 'Fibbsy & Hero Power Pills',
    changes: [
      { category: 'New Hero', text: 'Fibbsy joins the roster. His power, Ruby Wealth, turns 1 Gold into 2 Rubies and can be used twice a turn.' },
      { category: 'Hero Change', text: 'Brackus can no longer be handed out by Mimic or the Power Shifter spell — adopting a start-of-game power mid-run did nothing.' },
      { category: 'Rune Change', text: 'Rune of Beastial Swarm now shows its current +X/+X value on its pill, not just the countdown to the next improve.' },
      { category: 'Card Change', text: 'Fixed a bug where a minion summoned mid-combat (e.g. by Bullseye or Mammoth) could gain its Avenge immediately — Avenge now counts from the moment it arrives.' },
      { category: 'UI / Info', text: 'Hero power pills now show live trackers and current values during combat — Aevor’s kills, Gorun’s attack bonus, Cindara’s Avenge counter, and Vale’s per-type buff all tick as the fight happens.' },
      { category: 'UI / Info', text: 'A hero’s second power (Void) now shows the full pills — cost, tracker and value — exactly like the main power.' },
      { category: 'UI / Info', text: 'Fibbsy’s power previews the Ruby it will mint on hover, at its current value.' },
    ],
  },
  {
    date: '2026-08-24',
    label: 'Tutorial & Save',
    changes: [
      { category: 'UI / Info', text: 'The Learn Ascent tutorial now climbs to Tier 6, teaches the rune system, and uses tier-accurate shops.' },
      { category: 'UI / Info', text: 'A prominent “Save & Quit” button leaves a run exactly where you left it, and the board is now snapshotted when the turn timer hits 0 so a crash resumes from that point.' },
    ],
  },
  {
    date: '2026-08-23',
    label: 'Hero Batch',
    changes: [
      { category: 'New Hero', text: 'Aevor joins the roster. Tempest unlocks after 15 kills, then buffs your flanks +4/+4 at end of turn — growing every 15 kills.' },
      { category: 'New Hero', text: 'Gorun joins the roster. Blade Mastery grants attackers +3 Attack, improving every 8 attacks.' },
      { category: 'New Hero', text: 'Cindara joins the roster. Hoard summons a Whelp every 4 friendly deaths and improves your Whelps +2/+2.' },
      { category: 'Hero Change', text: 'Fi and Coran are temporarily in Practice only while their hero quests are reworked — they are marked “Not currently enabled in Play”.' },
    ],
  },
  {
    date: '2026-08-22',
    label: 'Power Shifter & New Heroes',
    changes: [
      { category: 'New Card', text: 'Power Shifter — a Tier 5 spell that lets you Discover a brand-new hero power to replace your current one.' },
      { category: 'New Hero', text: 'Rayse joins the roster: minions you summon in combat gain +2/+3 and Taunt.' },
      { category: 'New Hero', text: 'Mimic joins the roster: Discover a hero power to wield each turn.' },
      { category: 'New Hero', text: 'Void joins the roster: wield TWO hero powers for the rest of the run.' },
      { category: 'Hero Change', text: 'Cia is now Ayse — a new “Ace” reward suit, a 20% chance per card to be enchanted, enchantable spells, and enchanted cards possible from the first shop.' },
      { category: 'Hero Change', text: 'Auctioneer’s hero power no longer waits until turn 3.' },
      { category: 'Card Change', text: 'Rune of Rebirth now prints its granted Echo on the exact minion that received it.' },
      { category: 'UI / Info', text: 'The hero-select screen was redesigned, and Practice now uses the real hero cards — four across, two rows, alphabetical.' },
    ],
  },
  {
    date: '2026-08-21',
    label: 'Hero Quests & Runeforge',
    changes: [
      { category: 'Rune Change', text: 'Rune of the Wheel is now a standing aura on your shop, not a one-off buff each refresh.' },
      { category: 'UI / Info', text: 'A granted quest’s reward now shows beside its objective on the hero-power tooltip.' },
      { category: 'UI / Info', text: 'The hero-select board backdrop is heavily blurred so the cards read cleanly, plus more hero voice lines.' },
    ],
  },
  {
    date: '2026-08-20',
    label: 'The Runeforge',
    changes: [
      { category: 'New Rune', text: '30 new runes and 16 rune-only minions arrive with the Runeforge batch.' },
      { category: 'New Card', text: 'Conductor — a snowballing minion that triggers on adjacent Shouts.' },
      { category: 'Card Change', text: 'Oona doubles both stats again; Quillen counts as every type; several minions gained real tribes; Fresh Pages now Discovers on purchase.' },
      { category: 'UI / Info', text: 'The Hero Select Ceremony (pick presentation + explicit Start Game), a keyword-definition panel beside hovered cards, and minion medallion mechanic icons.' },
    ],
  },
  {
    date: '2026-08-19',
    label: 'Runes & Dragons',
    changes: [
      { category: 'New Rune', text: '27 new runes, 6 rune reworks, and Might of Aeon.' },
      { category: 'New Card', text: 'A Dragon batch — 8 Dragons and 2 spells — plus the Standard Bearer minion.' },
      { category: 'Card Change', text: '15 new minions and a set of rebalances; Beefy and Lantern Light no longer fizzle when cast in combat.' },
      { category: 'UI / Info', text: 'Rune triggers now burst on their badge, and the locked third rune slot shows chains.' },
    ],
  },
  {
    date: '2026-08-18',
    label: 'Balance Pass',
    changes: [
      { category: 'Card Change', text: 'A broad Set 1 / Set 2 balance patch — stat tweaks, effect reworks, a new Gildmaster power, and rune tuning.' },
    ],
  },
];
