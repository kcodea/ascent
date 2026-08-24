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
];
