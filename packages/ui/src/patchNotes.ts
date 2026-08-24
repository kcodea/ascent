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
 *
 * TWO READING LEVELS (owner ask 2026-08-24): each change has a one-line `text` (the SUMMARY, shown by default)
 * and may carry `details: string[]` — the granular, per-change specifics revealed by the title screen's
 * **Detailed** toggle. When you add a change, write the summary AND, whenever the change has real substance
 * (exact numbers, several sub-parts, a list of cards/heroes touched), the `details` bullets too. Keep both
 * player-facing and spoiler-light. A change with no `details` simply shows its summary in both modes.
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
  /** Plain-English, player-facing. One change per entry. The SUMMARY line, shown in both reading modes. */
  text: string;
  /** Optional granular breakdown, revealed by the title-screen "Detailed" toggle. Player-facing + spoiler-light,
   *  one specific per bullet (exact numbers, the individual cards/heroes touched, the sub-parts of the change). */
  details?: string[];
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
    label: 'Patch Notes & Save Fix',
    changes: [
      { category: 'UI / Info', text: 'Patch Notes now has a “Detailed” toggle that expands every change into its full specifics.', details: [
        'Summary view shows the one-line headline for each change.',
        'Detailed view reveals the exact numbers and sub-parts beneath each one.',
      ] },
      { category: 'UI / Info', text: 'Save & Quit now brings you back with the exact time left on your turn, instead of resuming at 0 with the board locked.' },
    ],
  },
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
      { category: 'New Hero', text: 'Fibbsy joins the roster. His power, Ruby Wealth, turns 1 Gold into 2 Rubies and can be used twice a turn.', details: [
        'Starts with 15 Armor.',
        'Ruby Wealth costs 1 Gold and mints 2 Rubies.',
        'Usable twice per turn, not once.',
      ] },
      { category: 'Hero Change', text: 'Brackus can no longer be handed out by Mimic or the Power Shifter spell — adopting a start-of-game power mid-run did nothing.' },
      { category: 'Rune Change', text: 'Rune of Beastial Swarm now shows its current +X/+X value on its pill, not just the countdown to the next improve.' },
      { category: 'Card Change', text: 'Fixed a bug where a minion summoned mid-combat (e.g. by Bullseye or Mammoth) could gain its Avenge immediately — Avenge now counts from the moment it arrives.', details: [
        'A summoned minion now starts its Avenge count at 0 instead of inheriting every friendly death that happened before it arrived.',
        'Affected any minion pulled into combat by another (Bullseye, Mammoth, and similar).',
      ] },
      { category: 'UI / Info', text: 'Hero power pills now show live trackers and current values during combat — Aevor’s kills, Gorun’s attack bonus, Cindara’s Avenge counter, and Vale’s per-type buff all tick as the fight happens.', details: [
        'Aevor: the kill count toward the next Tempest step ticks up as enemies fall.',
        'Gorun: the attack-bonus value and its progress to the next improve update mid-fight.',
        'Cindara: a live X/4 Avenge tracker toward the next Whelp.',
        'Vale: the per-type buff grows with each spell cast this game.',
      ] },
      { category: 'UI / Info', text: 'A hero’s second power (Void) now shows the full pills — cost, tracker and value — exactly like the main power.' },
      { category: 'UI / Info', text: 'Fibbsy’s power previews the Ruby it will mint on hover, at its current value.' },
    ],
  },
  {
    date: '2026-08-24',
    label: 'Tutorial & Save',
    changes: [
      { category: 'UI / Info', text: 'The Learn Ascent tutorial now climbs to Tier 6, teaches the rune system, and uses tier-accurate shops.', details: [
        'Tiers up all the way to 6 across the course.',
        'Shops only ever offer minions your current tier has unlocked — and the course explains that link.',
        'A Runeforge round introduces runes with clear direction.',
        'A spotlight now sits over the Tier-Up button when the step calls for it.',
      ] },
      { category: 'UI / Info', text: 'A prominent “Save & Quit” button leaves a run exactly where you left it, and the board is now snapshotted when the turn timer hits 0 so a crash resumes from that point.', details: [
        'Save & Quit sits as the primary button in the pause menu.',
        'The board is captured the moment the turn timer reaches 0, so an unexpected close resumes from there.',
      ] },
    ],
  },
  {
    date: '2026-08-23',
    label: 'Hero Batch',
    changes: [
      { category: 'New Hero', text: 'Aevor joins the roster. Tempest unlocks after 15 kills, then buffs your flanks +4/+4 at end of turn — growing every 15 kills.', details: [
        'Starts with 16 Armor.',
        'Tempest stays locked until your minions have killed 15 enemies.',
        'Once unlocked, it grants your two flank minions +4/+4 at end of turn.',
        'The grant grows by +4/+4 for every further 15 kills.',
      ] },
      { category: 'New Hero', text: 'Gorun joins the roster. Blade Mastery grants attackers +3 Attack, improving every 8 attacks.', details: [
        'Starts with 11 Armor.',
        'Your attacking minions get +3 Attack from the very first swing — no unlock.',
        'The bonus grows by +3 for every 8 attacks made.',
      ] },
      { category: 'New Hero', text: 'Cindara joins the roster. Hoard summons a Whelp every 4 friendly deaths and improves your Whelps +2/+2.', details: [
        'Starts with 9 Armor.',
        'Every 4 friendly deaths in combat, summon a 1/1 Whelp that attacks immediately.',
        'Improving Whelps adds +2/+2 — applied live to both existing and newly summoned Whelps.',
      ] },
      { category: 'Hero Change', text: 'Fi and Coran are temporarily in Practice only while their hero quests are reworked — they are marked “Not currently enabled in Play”.', details: [
        'Both remain fully playable in Practice.',
        'They cannot be handed out through a power Discover (Mimic / Void / Power Shifter) while pulled.',
      ] },
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
      { category: 'Hero Change', text: 'Cia is now Ayse — a new “Ace” reward suit, a 20% chance per card to be enchanted, enchantable spells, and enchanted cards possible from the first shop.', details: [
        'Renamed from Cia to Ayse, with a new "Ace" reward suit.',
        'Each shop card has a 20% chance to arrive enchanted.',
        'Spells can now be enchanted too.',
        'Enchanted cards can appear as early as the first shop.',
      ] },
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
