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
    date: '2026-09-21',
    label: 'Plain-language text pass',
    changes: [
      {
        category: 'UI / Info',
        text: 'Glossary: the Orbit and Dawn / Dusk entries are gone. They are not in the game. Watcher, Permanent and Aura are reworded.',
        details: [
          'Watcher: A card that triggers off other minions.',
          'Permanent: Imbues/Buffs carry through the run permanently.',
          'Aura: A run wide bonus for every minion that it suits. Carries through shop and combat phases.',
          'Orbit and Dawn / Dusk no longer appear as keyword boxes on cards or as Compendium rows.',
          'Tooltips, the post-combat summary, quest lines, rank messages and these patch notes now read in the same plain style: short sentences, no dashes joining clauses.',
        ],
      },
    ],
  },
  {
    date: '2026-09-21',
    label: 'Ladder row portraits',
    changes: [
      {
        category: 'UI / Info',
        text: 'Recent Games and the Hall of Champions: bigger hero portraits in the portrait ring, larger rune pills, and the warband sits clear of its caption.',
        details: [
          "Each row's hero portrait now sits in the same gold portrait ring the Career page and hero select use, about a third larger than before.",
          'The rune pills on Recent Games grew, with a bigger emblem and larger name text. They still wrap when a run took many runes.',
          'The seven warband cards moved down so their frames no longer run into the FINAL TEAM / WINNING WARBAND caption, on every screen size.',
        ],
      },
    ],
  },
  {
    date: '2026-09-21',
    label: 'Title screen: your portrait, name and rank',
    changes: [
      {
        category: 'UI / Info',
        text: "The title screen shows your portrait large in the top-right with your name and rank; Sign in / Sign out moved into Settings.",
        details: [
          "Your avatar now sits in the game's gold portrait ring, top-right of the main menu. Click it to change your avatar, or click your name on the ring's edge to rename yourself. Your current rank (say Bronze III) shows in a badge under your name once you have one.",
          "The old \"Sign in\" / \"Account\" button in that corner is gone. Sign in (and Sign out, once you're signed in) now live at the bottom of Settings; signing in still only takes an email and a one-time code.",
        ],
      },
    ],
  },
  {
    date: '2026-09-21',
    label: 'Title screen: your portrait, name and rank',
    changes: [
      {
        category: 'UI / Info',
        text: "The title screen shows your portrait large in the top-right with your name and rank; Sign in / Sign out moved into Settings.",
        details: [
          "Your avatar now sits in the game's gold portrait ring, top-right of the main menu. Click it to change your avatar, or click your name on the ring's edge to rename yourself. Your current rank (say Bronze III) shows in a badge under your name once you have one.",
          "The old \"Sign in\" / \"Account\" button in that corner is gone. Sign in (and Sign out, once you're signed in) now live at the bottom of Settings; signing in still only takes an email and a one-time code.",
        ],
      },
    ],
  },
  {
    date: '2026-09-21',
    label: 'Menu sidebar',
    changes: [
      {
        category: 'UI / Info',
        text: "Career, Leaderboard, Hall of Champions, Recent Games and the Mode screen now carry a left sidebar with Back and the main menu, so you can jump between them without returning to the title; the Career page's side columns grew to fill wide screens; the Mode screen sits on the same navy backdrop.",
        details: [
          'The sidebar holds Back at the top and, centred below it, Play, Career, Leaderboard, Hall of Champions, Recent Games and Settings. The screen you are on is the blue plaque.',
          "Back keeps doing what it did on each screen: a player's Career opened from the Leaderboard still returns to the Leaderboard; the Mode screen's Back returns to the title menu.",
          "On the Career page the centre column now stops growing once the seven cards are at full size, and any extra width goes to the stats and Seasonal Ranked columns instead of sitting empty beside the cards.",
          'The Mode screen (Play / Learn / Practice) uses the same navy backdrop as the ladder pages.',
          'Settings opened from one of these screens now offers Main menu instead of a Save & Quit no run could honour; on a laptop-width window the Career page stacks its columns so the seven cards stay readable.',
        ],
      },
    ],
  },
  {
    date: '2026-09-21',
    label: 'Career match history',
    changes: [
      { category: 'UI / Info', text: 'Career match history: hero portraits now wear the portrait ring, and the fight record reads as a bare N–M.' },
    ],
  },
  {
    date: '2026-09-21',
    label: 'Leaderboard crests',
    changes: [
      { category: 'UI / Info', text: 'Leaderboard: rank crests are now the size of the placement medallions, with a readable division plate.' },
    ],
  },
  {
    date: '2026-09-21',
    label: 'Career match history',
    changes: [
      { category: 'UI / Info', text: 'Career match history: hero portraits now wear the portrait ring, and the fight record reads as a bare N–M.' },
    ],
  },
  {
    date: '2026-09-21',
    label: 'Rank screen: the demotion effect',
    changes: [
      {
        category: 'UI / Info',
        text: "Losing a division or a medal now plays its own effect (and sound) on the rank screen.",
        details: [
          "Dropping a division (say Gold II to Gold III) and dropping a medal after a lost demotion game both play it: a shock off your crest, the old crest falls away in a shower of shards, and the new one settles in. It mirrors the promotion burst.",
          "Skipping the animation (click the rank display or Skip) still settles instantly and silently.",
        ],
      },
    ],
  },
  {
    date: '2026-09-20',
    label: 'Medal ranks: season 3 and the post-game rank screen',
    changes: [
      {
        category: 'UI / Info',
        text: "The ladder is now a medal and a division instead of a number: Bronze, Silver, Gold, Platinum, Diamond and Ascendant, three divisions each (III up to I), 100 points per division. Everyone starts season 3 at Bronze III. Your rank is settled by the server after every ranked lobby, and the end of every ranked game plays it out: VICTORY (or your placement), your crest, and the division bar moving from where you were to where you are.",
        details: [
          'Points by finish: 1st +40, 2nd +28, 3rd +16, 4th +6, 5th -6, 6th -16, 7th -28, 8th -40. Only ranked lobbies count; Practice and the tutorial never move your rank.',
          "Reaching 100 points unlocks a PROMOTION GAME rather than promoting on the spot (anything past 100 is discarded). Moving up a division (say Gold III to Gold II) takes a top-4 finish in that game; moving up a medal (Gold I to Platinum III) takes 1st place. A won promotion starts the next division at 0, not at the game's points.",
          'A lost promotion game (5th–8th) just costs its normal points from 100; climb back to 100 and the gate reopens. At a medal gate, a 2nd–4th finish neither promotes nor gains. You stay at 100, still promotion-ready.',
          'Dropping below 0 inside a medal demotes one division and keeps the remainder (Gold II 10 after an 8th place lands on Gold III 70). Bronze III can never fall below 0. Ascendant I has no cap, so points keep climbing.',
          "Dropping OUT of a medal is gated too: a loss at a medal's lowest division (Gold III) stops at 0 and arms a DEMOTION GAME for your next ranked lobby. A top-4 finish keeps you in the medal and your points apply from 0. A 5th–8th drops you to the previous medal's division I with 100 minus that game's loss (an 8th lands on Silver I 60). Arriving at 0 by winning a medal promotion does not arm it; only a loss there does.",
          'The post-game screen shows the actual points applied (a capped award at the gate says so), the outcome line when there is one ("Promotion game ready" or "Demotion game"), and CONTINUE, which is always usable and fades you back to the menu. Click the rank display or Skip to settle the animation instantly.',
          "If the rank update hasn't come back yet the screen says \"Updating rank…\". A result that can't reach the server is kept and retried, never lost, and shows \"Rank update pending\" with a Retry. Practice games show your placement and \"Unrated\".",
          "Your crest, division and bar now appear on your Career page's Seasonal Ranked card and on the Leaderboard, which orders players by division first, then points.",
          "Your career-best rank never goes down. Leaderboards sort by division first, then points.",
          'Previous-season ratings are archived, not deleted; the new season starts everyone fresh.',
        ],
      },
    ],
  },
  {
    date: '2026-09-20',
    label: 'Kobe nerf',
    changes: [
      { category: 'Card Change', text: 'Kobe now plays one permanent Ruby (gilded: two) on itself and adjacent Kobolds when it takes damage, down from three (gilded six).' },
    ],
  },
  {
    date: '2026-09-20',
    label: 'Ladder pages backdrop',
    changes: [
      { category: 'UI / Info', text: 'Career, Leaderboard, Hall of Champions and Recent Games now sit on the deep navy backdrop the loading screen uses (the same one as the new rank screen) instead of the title art.' },
    ],
  },
  {
    date: '2026-09-20',
    label: 'Leaderboard rows',
    changes: [
      { category: 'UI / Info', text: "The Leaderboard's rows are now big and clean: a large rank medallion, the hero portrait, the player's handle with their favourite hero, the rating as a big gold MMR number, games played, and a CAREER PAGE button that opens that player's Career (WATCH still plays their latest run). The strip of card tiles showing each player's latest board is gone. That lives on their Career page." },
    ],
  },
  {
    date: '2026-09-20',
    label: 'Career: match wins by placement + Heroes portrait grid',
    changes: [
      {
        category: 'UI / Info',
        text: "On the Career page a match is now won or lost by placement: top 4 is a win, 5th to 8th a loss. Each Match History banner shows WIN or LOSS under the hero (the fight record is a small caption), the Win Rate trend is your share of top-4 finishes, and the Heroes tab is a grid of every hero you've played as a portrait with its games played. Hover or tab onto one for its W–L record, win rate, average placement, 1st-place wins, best placement and last played.",
      },
    ],
  },
  {
    date: '2026-09-20',
    label: 'Every round counts',
    changes: [
      { category: 'UI / Info', text: "Your W–L record now counts every round of a run. The first two rounds used to be skipped as \"calibration\" (a leftover of the old course), so a 15-round game read 9–4; the HUD, end screen, Career, Recent Games and the Hall all count all rounds now." },
    ],
  },
  {
    date: '2026-09-20',
    label: 'Leaderboard, Hall of Champions + Recent Games redesign',
    changes: [
      {
        category: 'UI / Info',
        text: "The Leaderboard, the Hall of Champions and Recent Games have been rebuilt in the Career page's style: gold-framed banners, podium medallions, circular hero portraits, and every board shown as real card tiles you can hover to inspect.",
        details: [
          "Leaderboard: a proper ranked table with gold, silver and bronze medallions for the top 3, your own row highlighted and scrolled into view, each player's rating, games played and their latest recorded board as card tiles (with how that game ended), plus a Watch button for their latest run.",
          "Hall of Champions: each victory is one banner with the champion's hero portrait and handle, their fight record and round-by-round pips, the winning warband as card tiles, the runes and quests they finished with, and the board's round-17 record.",
          "Recent Games: each recording is a banner with the player's hero and handle, the final team as card tiles, the runes they took (emblem + name), the outcome block (VICTORY or placement, date and time, W–L record, run length and rounds), and one Watch Replay button. A recording that doesn't start at round 1 is labelled as a partial recording.",
          'Hovering any board tile on these pages now opens the full card reveal (it used to open behind the page).',
        ],
      },
    ],
  },
  {
    date: '2026-09-20',
    label: 'Career page rebuild + replay viewer',
    changes: [
      {
        category: 'UI / Info',
        text: "The Career page is rebuilt as three columns: your most-played hero with 1st Place Wins / Top 4 Finish / Avg Placement / Favorite Tribe, a Match History of your last 25 server runs as tall banners (hero + record, the final team as full card tiles, the runes you picked, VICTORY or your placement, date, run length, Gold spent, and Watch Replay), and Seasonal Ranked showing your MMR as a single number above your Avg Placement / Win Rate / APM trends over 7, 30 or 90 days. A new Heroes tab lists every hero you've played with runs, 1st-place wins, fight record, average and best placement, and last played.",
        details: [
          "Match History reads only your account's server runs, the last 25, newest first. Only that column scrolls. The hero panel and the Ranked card stay put.",
          "Each banner shows the final team as 7 full-size card tiles (gilded frames and stat badges included) and the run's rune picks with their art; hover a rune for its text.",
          'The rating delta and divisions are gone from Seasonal Ranked. It is your current MMR, nothing else.',
          "The Heroes tab folds every run you've played: runs, 1st-place wins, total fight W–L with win rate, average and best placement, last played. Most-played first. Your tab choice is remembered.",
          "The replay viewer's round rail lost its Power column (the stat wasn't reliable). The rail can now be dragged from any point of its surface; a plain click on a Recruit / Combat cell still seeks.",
          'Hovering a card while a replay plays now opens the same related-card and keyword previews you get live. A recorded drag no longer hides them.',
        ],
      },
    ],
  },
  {
    date: '2026-09-20',
    label: 'Top-milestone badge effect',
    changes: [
      {
        category: 'UI / Info',
        text: "A minion whose Attack or Health reaches the top milestone (5000) gains a glowing effect on that badge in the shop, your warband and combat alike. It stays lit for the rest of that minion's life, even if the stat later drops.",
      },
      {
        category: 'UI / Info',
        text: 'The top-milestone Attack and Health badge effects have a refreshed look.',
      },
    ],
  },
  {
    date: '2026-09-19',
    label: 'Per-tier milestone badge colours',
    changes: [
      {
        category: 'UI / Info',
        text: "Milestone stat badges now wear their own colour at each tier. The disc behind the frame, and the buffed digit on the top frames, shifts as a stat climbs past 50, 150, 500, 2000 and 5000, instead of one Attack colour and one Health colour across every tier.",
      },
    ],
  },
  {
    date: '2026-09-19',
    label: 'Damage meters: reset + live counter',
    changes: [
      {
        category: 'Card Change',
        text: "Goldvein's damage meter now resets after every combat: it reads 0/6 in the shop instead of sitting at 6/6 once it has fired.",
        details: [
          "Once per combat means the meter starts every fight fresh, progress and payout both. Damage it dealt in an earlier fight no longer counts toward the next one.",
          'In combat the counter climbs with each hit and stops at 6/6 once the Gold is banked; it does not lap around to promise a second payout.',
        ],
      },
      {
        category: 'UI / Info',
        text: "Damage-meter counters (Goldvein, Han Gover) show progress toward the NEXT payout, and a payout lands on 0. Han Gover at 47 damage reads 7/40, not 47/40.",
      },
      {
        category: 'UI / Info',
        text: "Damage-meter counters tick in real time in combat as each hit lands, including the blow that ends the fight, and the final reading stays on the card through the end of combat.",
        details: [
          "Goldvein's counter did not move in combat at all before this; only Han Gover's did.",
        ],
      },
    ],
  },
  {
    date: '2026-09-19',
    label: 'Overflow keyword, Yeti, Goldvein, Han Gover cap',
    changes: [
      {
        category: 'New Card',
        text: 'Goldvein joins the Kobolds: a Tier 1 2/3 that banks 3 Gold for next turn the first time it has dealt 6 damage in a combat.',
        details: [
          "Its damage meter works like Han Gover's: every landed hit it deals counts. When it reaches 6, you gain 3 Gold next turn, on top of the Gold cap. Unlike Han Gover's, the meter resets after every combat. See the follow-up patch.",
          'Once per combat: a second crossing in the same fight pays nothing, and a Goldvein that Rises does not get a second payout. The next fight re-arms it.',
          'Gilded: 6 Gold, still once per combat.',
        ],
      },
      {
        category: 'Card Change',
        text: 'Chipwick Prospector has left Set 3. It is still a Set 2 card.',
      },
      {
        category: 'New Card',
        text: 'Yeti joins the Neutrals: a Tier 6 0/12 that throws the first hit it takes each combat back at 2 random enemies.',
        details: [
          "The first time Yeti takes damage in a fight, the same amount is dealt to 2 different random enemies (just the one if only one is standing). It fires once per combat. A Yeti that Rises does not get a second throw.",
          'The thrown damage is real damage: it pops a Ward, is shrugged off by Immune, and a kill resolves on the spot with its Echo.',
          'Gilding doubles the body and nothing else.',
        ],
      },
      {
        category: 'Card Change',
        text: "Han Gover now reads \"(Max 2 per hit)\": one hit pays at most 2 Ales however many 40-damage marks it crosses.",
        details: [
          'The meter still counts the full damage of the hit, so the next 40 dealt pays again as normal.',
          'Gilded Han Gover still gets 2 Ales per crossing. The first crossing in a hit fills the cap, so a second crossing in the same hit pays nothing extra.',
        ],
      },
      {
        category: 'UI / Info',
        text: 'Overflow is now a keyword: every card and rune that reacts to a summoned minion finding no room on your board reads "Overflow: …", with its own pill, Compendium entry and medallion.',
        details: [
          'Overflow: when a minion is summoned, but does not have space on your board.',
          'Rewritten to the keyword form: Squatimus, Flowing Monk, Bicycle Bob, Cratering Hulk, Rune of Overflow and Rune of the Crowded Crypt. What they do is unchanged.',
        ],
      },
    ],
  },
  {
    date: '2026-09-19',
    label: 'Settle-time buff ribbons',
    changes: [
      { category: 'UI / Info', text: "A buff that lands when a card earned in combat comes home to your hand (Gangplank paying out Han Gover's Ale, for example) now plays its ribbon once the shop is revealed instead of silently under the arena. Dual-type minions included." },
    ],
  },
  {
    date: '2026-09-19',
    label: 'Replay Win % fix',
    changes: [
      {
        category: 'UI / Info',
        text: "Replay viewer: the estimated Win % (~) on older recordings now accounts for the recorded player's runes, quests, spell power and auras. It read ~0% on fights that were actually won.",
        details: [
          'The estimate used to re-fight each round with both sides stripped of their run-level effects, so a Beast build carried by Rune of Beastial Swarm or Rune of Warding looked hopeless on paper.',
          "The player's side is now rebuilt from the round's last shop state exactly as the real fight was; the opponent's side uses what the recording carries about it, so the number stays marked ~ on old recordings.",
          'New recordings are unaffected: their Win % is the exact figure the Combat Summary showed.',
        ],
      },
    ],
  },
  {
    date: '2026-09-19',
    label: 'Effect cleanup crash',
    changes: [
      { category: 'UI / Info', text: "Fixed a crash in the shop when the effect budget trimmed an effect whose scene had already been torn down (\"Cannot read properties of null (reading 'indexOf')\")." },
    ],
  },
  {
    date: '2026-09-19',
    label: 'Replay viewer',
    changes: [
      {
        category: 'UI / Info',
        text: "Replay viewer: the Power column now measures a board against the boards players actually had at that exact round, so it no longer drops off a cliff between round 12 and 13 with no change to the board.",
        details: [
          'Power used to compare a board with a bracket of rounds (10–12, 13–15, …); crossing a bracket edge swapped the yardstick and the number could fall from 99 to 11 in one round.',
          'Now every round has its own yardstick, the recorded boards at that round, and 50 means "the typical board at this round". A board that stands still while the field grows still loses Power, because the field really did grow.',
        ],
      },
      {
        category: 'UI / Info',
        text: "Replay viewer: the round rail is now a full table you can collapse and drag, with Recruit / Combat jump cells, Power and Win % columns, shop sounds, and the recorded player's cursor.",
        details: [
          'Each round row has two cells: Recruit jumps to that round’s shop, Combat plays that round’s fight from its start. The cell you are watching is highlighted.',
          "Power: the board's strength at the end of the recruit turn (0–100). Win %: the game's own win chance for that fight. It is exact on new recordings. Older ones show an estimate marked ~ once it has been computed.",
          'Drag the rail anywhere by its ⋮⋮ handle; collapse it to a slim badge with ◂. Your placement is remembered.',
          'Shop actions (buys, plays, rolls, upgrades…) now play their sounds during a replay. A 🔊 toggle on the transport turns them off.',
          "New recordings capture the player's pointer between drags; playback shows a small gauntlet moving with it (🖱 toggle). Older replays simply have no cursor.",
          'During a replayed drag the original card now lifts out of its row while the ghost travels, instead of staying put until the drop.',
        ],
      },
    ],
  },
  {
    date: '2026-09-19',
    label: 'Kobold tune',
    changes: [
      { category: 'Card Change', text: 'Gemheart Carver is now Tier 3 at 5/3 (was Tier 4, 6/5).' },
      { category: 'Card Change', text: 'Kurse is now Tier 4 at 7/4 (was Tier 5, 10/5).' },
    ],
  },
  {
    date: '2026-09-19',
    label: 'Kurse + Pickles',
    changes: [
      {
        category: 'New Card',
        text: "Kurse (Tier 5 Kobold, 10/5): Avenge (3), summon a 1/1 Gemheart Golem, plus this minion's Rubies.",
        details: [
          "Gemheart Carver's Golem on an Avenge trigger: after every three friendly deaths in a combat, a Golem lands beside Kurse carrying every Ruby stacked on Kurse at that moment.",
          'Fires each time the count is reached, so six friendly deaths is two Golems. A full board loses the Golem.',
          'Gilded: one Golem at double stats, the same as Gemheart Carver.',
        ],
      },
      { category: 'Card Change', text: "Pickles: the Ruby branch now gives 3 Rubies (was 2); Gilded 6 (was 4)." },
    ],
  },
  {
    date: '2026-09-19',
    label: 'No ghost rematches',
    changes: [
      { category: 'UI / Info', text: "When the table is odd and you fight a ghost (a fallen seat's board), it is never the seat you fought last round or the one you eliminated. The next most recent ghost stands in, and if the only ghost would be a rematch, another seat takes the bye." },
    ],
  },
  {
    date: '2026-09-18',
    label: 'Dissipate',
    changes: [
      {
        category: 'New Card',
        text: 'Dissipate (Tier 5 spell, 4 Gold): sell a friendly minion and give its stats to the right-most minion in the Shop.',
        details: [
          'The minion is genuinely sold. You get its Gold, and everything that triggers on a sale triggers.',
          'Its current stats, buffs included, land on the right-most MINION in the Shop (spells are skipped).',
          'With no minion in the Shop the spell cannot be cast: it stays in your hand and nothing is sold.',
          'Available in Set 2 and Set 3.',
        ],
      },
      {
        category: 'UI / Info',
        text: 'The Equipment cost coin always shows a number. A free activation reads "0", and a discounted one turns green.',
        details: [
          'A 0-cost Equipment used to show no coin at all; it now shows 0.',
          'When a rune has cut the cost below the printed price, the coin goes green, like every other discount.',
        ],
      },
      {
        category: 'UI / Info',
        text: "Cage Breaker: the destroyed minion now finishes dying before the Discover opens, instead of the pick covering it.",
      },
    ],
  },
  {
    date: '2026-09-18',
    label: 'Rune Batch',
    changes: [
      {
        category: 'Rune Change',
        text: 'Eleven Set 3 runes reworked or repriced. The spell-count runes now count every spell, the Reveler runes count to 3, and the Equipment runes lost their caps and gained teeth.',
        details: [
          'Rune of Charted Skies now costs 2 and reads "After you cast 3 spells, get a copy of one of them. (Once per turn)". Every spell counts (Shop spells, Rubies, Clues, Gifts), and the copy is one of those three at random.',
          'Rune of the Astral Refrain: "After you cast 3 spells, get 2 copies of the second one." Every spell counts here too.',
          'Rune of the Astral Draft now costs 4 (was 6).',
          'Rune of Eventide: "After you Consume or Collapse a Starform, give your Shop spells +1/+1. (Once per turn)". It no longer hands out spells.',
          'Rune of Festival Wages: "After you sell 3 Revelers, your next card costs 0." Every third Reveler sold in a turn arms it.',
          'Rune of the Festival Circuit now costs 4 and reads "After you sell 3 Revelers, get a random Celestial. Your Revelers buff Celestials." While held, your Revelers’ sell buffs reach your Celestials too.',
          'Rune of Dismantling no longer caps at once per turn. Every Equip minion you sell fires its Equipment for free first, and every fire plays out.',
          'Rune of Quick Release: the sold minion’s own Equipment is never the discounted one. Only another Equipment is free.',
          'Rune of Empty Hands: the Discovered minion’s Equipment now costs 0 AND is Amplified permanently.',
          'Rune of the Dream Mirror: EVERY stat gain on a minion in your hand is now mirrored onto a random friendly minion (was the first each turn).',
          'Rune of the Endless March: a friendly Undead that rises now summons a Spear Warden (was a 1/1 Skeleton).',
        ],
      },
    ],
  },
  {
    date: '2026-09-18',
    label: 'Glossary True-Up',
    changes: [
      {
        category: 'UI / Info',
        text: 'Every keyword is now explained in one place: the hover pills beside a card, a rune or your Equipment and the Compendium glossary read the same definitions, with new entries for Amplified, Equipment, Start of Turn, Orbit, Bleed, Improve, Aura, Gifts, Clues, summoning from hand and permanent gains. The Compendium glossary is now legible (dark text on the cream panels) and Rune of Amplification reads simply "Equipment you do not use becomes Amplified."',
        details: [
          'Amplified pill: "An Amplified Equipment will trigger its effect twice for no additional gold." It shows on Rune of Amplification, Rune of the Grand Workshop, the Calibration Wrench and Calibration Master, and is coloured in text like other keywords.',
          'Runes now show keyword pills on hover (the same column a card hover shows), and the Equipment slot tooltip lists the pills its text uses.',
          'Definitions checked against the rules: Rise returns the printed stats at 1 Health; Rebirth returns the full body; Dawn is the left half of your board, Dusk the right, the exact middle counts as both; Attachment fuses onto a friendly minion that shares its type; Stealth is lost when the minion attacks.',
          'The Compendium glossary is sectioned Triggers / Combat keywords / Build & shop / Spells & tokens and no longer carries its own copy of any definition.',
        ],
      },
    ],
  },
  {
    date: '2026-09-18',
    label: 'Equipment Neutrals',
    changes: [
      {
        category: 'New Card',
        text: 'Three new Set 3 Neutrals built around Equipment: Shredder, Calibration Master and Rig.',
        details: [
          'Shredder (Tier 4, 8/4): "End of Turn: give your left-most and right-most minions +4/+4 for every Equipment unused this turn." The card prints the total it will grant right now; a lone minion is both ends and is buffed once. Gilded +8/+8.',
          'Calibration Master (Tier 5, 9/6): "Equip Calibration Wrench (1): your next Equipment activation is Amplified." Whatever Equipment you press next triggers twice, never the Wrench itself, and the charge carries across turns until you use it. Gilded: your next two activations.',
          'Rig (Tier 3, 4/4): "When you use Equipment, this gains +4/+4." Every activation from the slot counts, the Calibration Wrench included; a Rig in your hand does not grow. Gilded +8/+8.',
        ],
      },
      {
        category: 'Card Change',
        text: 'Tauntbreaker has left the Set 3 pool.',
      },
    ],
  },
  {
    date: '2026-09-18',
    label: 'Han Gover, Blazer & the Rise order',
    changes: [
      {
        category: 'New Card',
        text: 'Han Gover is a Tier 4 Dwarf/Undead who hands you a Dwarven Ale every 40 damage he deals.',
        details: [
          'Tier 4, 4/7, Dwarf AND Undead. "When this deals 40 damage, get an Ale." Gilded: get 2 Ales.',
          'Every hit he lands counts: attacks, retaliation, any damage he deals. The tally KEEPS COUNTING across combats (27 this fight, 13 more next fight, and the Ale arrives).',
          'The Ale flies to your hand the moment the threshold is crossed in combat, and is waiting for you in the next shop.',
          'His progress shows on the card as a step counter (N/40), in the shop and in combat, like every other every-N tracker.',
        ],
      },
      {
        category: 'Card Change',
        text: 'Blazer is now Tier 3 at 2/7 (was Tier 4, 3/8). Its Flurry + Rally Ruby play is unchanged.',
      },
      {
        category: 'Card Change',
        text: 'Rise and Echo now resolve in the right order everywhere: the minion dies, its Echo fires, and only THEN does it try to Rise.',
        details: [
          'Applies to every Rise (and Rebirth) minion, in combat and in the shop: a Deathfibrillated minion, Warden Rodrick, anything that dies with Rise.',
          'The Echo goes first and its summons land in the slot the minion just left. On a full board that means the summon fits and it is the Rise that finds no room. The minion stays dead, and that counts as an overflow (Squatimus and friends pay off).',
          'A Rise minion whose Echo does not summon anything still rises on a full board, because its own slot is still free.',
          'Previously the rising minion held its slot through its Echo, so its summon overflowed and the minion came back. That read as "it rose before its Echo".',
        ],
      },
    ],
  },
  {
    date: '2026-09-18',
    label: 'Bloodpot on Frank; Compendium search',
    changes: [
      { category: 'Card Change', text: 'Alchemist Frank can Bloodpot himself again. Bloodpot is the one Equipment exempt from the "no card targets itself" rule.' },
      { category: 'Card Change', text: 'Picksy moves to Tier 5.' },
      { category: 'Card Change', text: "Comet (Cometius) and Nimbus: 'your next spell casts N additional times' now reaches every spell. A Clue or a Ruby cast next is repeated too, and its ×N badge shows the real count." },
      { category: 'UI / Info', text: 'Compendium: a search now drills down by the tribe (or Spells / Gifts) you have lit in the left rail. Search "equip", then pick Kobolds. The search box reads in the same grey as the rail.' },
    ],
  },
  {
    date: '2026-09-18',
    label: 'Bicycle Bob, Robinson & Adeptus',
    changes: [
      {
        category: 'UI / Info',
        text: 'The Undead Aura sound can overlap itself again when rises come a few tenths of a second apart; only a burst inside the same few frames collapses into one sound (tunable in the Buff tuner). Rising Tide gets its new portrait.',
      },
      {
        category: 'New Card',
        text: 'Bicycle Bob joins the Undead: a Tier 4 3/9 that gives a random other Undead +1/+1 whenever a summoned minion does not fit. The gift improves by +1/+1 for every Undead you played this turn.',
        details: [
          'Fires in the shop and in combat, and the buff is permanent either way.',
          'Play two Undead this turn and each overflow hands out +3/+3; a gilded Ben doubles it.',
          'Ben never buffs himself. The card prints the current grant in the shop, in your hand and in combat.',
        ],
      },
      {
        category: 'Card Change',
        text: 'Robinson is now Tier 4 and a 5/7 (was Tier 3, 3/6).',
      },
      {
        category: 'Card Change',
        text: "Adeptus is now Tier 4, and its Echo gives your Shop spells +1/+1 (was +1 Attack only). Gilded: +2/+2.",
      },
    ],
  },
  {
    date: '2026-09-18',
    label: 'Kobold, Undead & Neutral reworks',
    changes: [
      {
        category: 'Card Change',
        text: "Kobold reworks: Kobe now plays permanent Rubies whenever it takes damage, Boulderdash gains Flurry, Korn and the Kob's Rally Ruby is permanent, Livewire spreads its Rubies to random Kobolds, and Dual Rubetta's improves your Rubies by +1/+1.",
        details: [
          'Kobe: Taunt. When this takes damage, play 3 permanent Rubies on this and adjacent Kobolds (was a Start of Combat cast of 2).',
          'Boulderdash: Flurry. Rally: cast 3 permanent Rubies on this. It swings twice, so the Rally pays twice.',
          'Korn and the Kob: Rally: cast a permanent Ruby on this (it carries back to your board after combat).',
          'Livewire: whenever you cast a Shop spell, cast a Ruby on this and 2 other random Kobolds (was: adjacent minions).',
          "Dual Rubetta's (Kaura L'roft): improve your Rubies by +1/+1 (was +1/+2) and cast a Ruby on your left-most and right-most Kobold.",
        ],
      },
      {
        category: 'Card Change',
        text: 'Spear Warden is now a 4/2 that HAS +4/+2 for every Spear Warden that died this game. It is a true death count, not an Echo.',
        details: [
          'Every Spear Warden death counts once: in combat, in the shop (Cage Breaker, a Deathfibrillator), a copy, a gilded copy, a Rune of the Warden token.',
          'Triggering its old Echo without a death (Deathsayer, Echohorn) no longer grows it, and Echo multipliers no longer double it.',
          'The card prints its current total in place, in the shop and in combat.',
        ],
      },
      {
        category: 'Card Change',
        text: "Deathsayer's Rally now triggers your left-most Echo AND your left-most Shout.",
      },
      {
        category: 'Card Change',
        text: "Neptus's Rally now gives a copy of the first Shop spell you cast this turn on EVERY attack (the once-per-combat limit is gone).",
      },
      {
        category: 'Card Change',
        text: 'Arena Heckler is now a 6/5: Start of Combat, it gives the minion opposite it Taunt and attacks it immediately.',
      },
      {
        category: 'Card Change',
        text: 'Paragon gives +5/+5 (was +4/+4).',
      },
      {
        category: 'Card Change',
        text: "No card can target itself any more. Cage Breaker and EMS's Deathfibrillator can no longer be aimed at themselves, and the same rule now applies to every aimed Shout, aimed Equipment and random-friendly effect.",
        details: [
          'Aimed Shouts (Cage Breaker, Auric Runemaster, Gravetwin, Graverobber, Brood Whelp, Twilight Emissary, Baby Gastrid, Appetite Agent, Runic Beetle) never offer their own body as a target; alone on the board they play as a plain body.',
          'Aimed Equipment (Bloodpot, Titan Hammer, Deathfibrillator) can no longer be used on the minion that granted it.',
          'Random-friendly effects (Gangplank, Drunken Oaf, Billings, Runekeg, Flowing Monk, Squirl Scout, Orbiting Familiar, Candle Conduit, Rot Weaver, and every minion that casts an aimed spell) never pick the minion itself.',
          'Positional effects ("adjacent", "left-most", "on this") and Paragon\'s "a minion of every type" are unchanged.',
        ],
      },
    ],
  },
  {
    date: '2026-09-18',
    label: 'Spirit + Celestial reworks',
    changes: [
      {
        category: 'Card Change',
        text: 'Seven Set 3 Spirits and Celestials reworked, and a Starform Collapse now feeds 3 Celestials.',
        details: [
          'Kindled Sprite is now 1/3: "Rally: gain +1 Attack permanently for every Spirit played this turn." The Attack it gains in a fight comes home with it; the card prints the total it will gain right now.',
          'Stardust Peddler is now 2/5: "When you spend 5 Gold, create a Starform, or give it +3/+3." A per-card Gold meter (the counter under the card shows N/5); gilded +6/+6.',
          'Sugarnova is now 4/2: "Shout: give your next Shop spell +4/+4" (gilded +8/+8). The bonus carries through combat if you do not spend it, every Shop spell offer and hand spell shows the boosted number in green, and exactly the next Shop spell you cast uses it up.',
          'Aspect: "When you play a Spirit, give 3 random Spirits +2/+2. Improves every 3 times this triggers." The improvement is +2/+2 per step (gilded +4/+4); the card prints its current grant and the counter shows the countdown.',
          'Crash Course: "The first Star Crash you cast on this each turn casts an additional time". It now works like Mirrorwing, but only for Star Crash (gilded: 2 additional times). It no longer spreads to other Celestials.',
          'Roundabout: "End of Turn: create a Starform and give it +10/+10" (gilded +20/+20). With a Starform already out, only the +10/+10 lands. The old Start-of-Turn create and End-of-Turn "eat the Shop" are gone.',
          'Old Timber: "Start of Combat: give your Spirits +3/+2. Improves for every Spirit played". That is +3/+2 more for each Spirit played since it was played. The card prints the current total.',
          "Collapse now grants half the Starform's stats (rounded up) to 3 random friendly Celestials (was 2). Fuse Aldrin's extra hits still land on top; Rune of the Supernova still hits all of them instead.",
        ],
      },
    ],
  },
  {
    date: '2026-09-18',
    label: 'Stat pass',
    changes: [
      {
        category: 'Card Change',
        text: 'A balance pass over 35 minions: most of the low-tier bodies got a little sturdier, a few late-game cards were trimmed, and Chronos finally has a body worth protecting.',
        details: [
          'Cosmo Express 2/1, Star Seed 2/2, Tidebud 2/3, Defender 3/2, Flame Reveler 4/3, Geode Guardian 3/3, Highway Hustler 3/4, Noggin 4/1, Seedling Spirit 2/4, Striker 3/3, Tide Reveler 3/4.',
          'Brunni 3/2, Adeptus 5/1, Coinfire Forewoman 3/5, Delver 5/3, Footman Captain 4/1, Gravestar Seer 0/8, Halfsies 4/4.',
          'Bellringer Voss 4/4, Blade Thrower 6/5, Blaster 8/2, Broad-Axe Brakka 5/3, Double Dealer 6/6, Gemheart Carver 6/5, Jewel 5/5, Jumpstart Jules 6/7, Uncle Orc 5/8, Wayfinder 4/2.',
          'Billings 5/6, Chronos 5/7, Drakko 3/5, Edward Keg-hands 5/7, Lodestar 5/5, Tide Caller 6/5, Twinning 4/7.',
        ],
      },
      {
        category: 'Card Change',
        text: 'Rising Tide and Squatimus now give +3/+4 (Rising Tide down from +4/+5, Squatimus up from +2/+2); Gilded doubles as before.',
      },
      {
        category: 'Card Change',
        text: 'Equipment costs retuned: Blast Pump 2, Coffin Flop 3, Deathfibrillator 3, Comet 3, Prismatic Pick 1.',
        details: [
          'Blast Pump 1 → 2 and Coffin Flop 2 → 3, Deathfibrillator 2 → 3 (a little more expensive).',
          'Comet 4 → 3 and Prismatic Pick 2 → 1 (cheaper).',
        ],
      },
      {
        category: 'Card Change',
        text: 'Pillager no longer appears in the Set 3 shop (it still exists as a rune reward).',
      },
    ],
  },
  {
    date: '2026-09-18',
    label: 'Rune tribe tags',
    changes: [
      {
        category: 'UI / Info',
        text: 'Runes are now tagged with the tribe they relate to: every Ruby rune counts as Kobold, every Dwarven Ale rune as Dwarf, every Attachment rune as Mech, and a rune that hands you a tribal minion carries that tribe. The Runeforge offers a tagged rune only in a run that has that tribe, and the Compendium filters by it.',
      },
    ],
  },
  {
    date: '2026-09-18',
    label: 'Compendium tier chart',
    changes: [
      {
        category: 'UI / Info',
        text: 'The Compendium now charts your selection by Tier: a bar graph in the tier row shows how many minions (or spells, or gifts) sit at each Tier for the tribes you have filtered to. Click a bar to filter that Tier.',
        details: [
          'The tier row stays put on the Runes and Heroes tabs instead of vanishing and shifting the whole window.',
          'Gifts have their own section under Spells.',
          'Hover any card or rune to see the cards it relates to (the token it summons, the spell it casts, the card a rune grants). These were rendering behind the book before.',
          'The Runes tab lists only the runes of the set you are looking at, and its tribe buttons filter to the runes that relate to a tribe.',
          'The operating-system tooltip (the little yellow box) no longer appears anywhere in the game.',
          'A card that gives you a Dwarven Ale now previews one Ale on hover instead of all five, a different one each time.',
        ],
      },
    ],
  },
  {
    date: '2026-09-18',
    label: 'Coloured terms',
    changes: [
      {
        category: 'UI / Info',
        text: "Every tribe name and mechanic word in card, spell, rune and hero-power text is now coloured wherever it appears, not only the ones that happened to be in bold. The Equip, Starform and Collapse keyword pills now show on the cards that use them, with clearer definitions, and Vaultkeeper's printed grant now ticks live in combat as spells are cast.",
        details: [
          `Previously a tribe or keyword only took its colour when the card text bolded it, so plain mentions (Seedling Spirit's "Spirit", "Discover a Beast", "Collapse your Starform") read as ordinary text. They now colour on the shop, hand, board, combat, Compendium and hover surfaces alike.`,
          `Keyword pills: "Equip" (Can be triggered once per turn, per equipment, for a cost.), "Starform" (occupies a Shop slot until purchased or destroyed; buying it grants its stats to your left-most Celestial) and "Collapse" (grant 50% of your Starform's stats to 3 Celestials and destroy it).`,
          "Vaultkeeper: its \"+N/+N\" and \"spells to next step\" now count spells cast DURING the fight (yours and, for an opponent's Vaultkeeper, theirs), instead of only updating after combat.",
        ],
      },
    ],
  },
  {
    date: '2026-09-17',
    label: 'Gamble joins Set 3',
    changes: [
      {
        category: 'New Card',
        text: 'The Gamble spell is now in the Set 3 pool as well: roll a die and get a random minion or spell of that Tier.',
      },
      {
        category: 'New Card',
        text: 'Rune of Gambling, a new Basic rune in every set: get a Gamble, repeat every turn, and your Gambles grant BOTH a minion and a spell of the rolled Tier.',
      },
    ],
  },
  {
    date: '2026-09-18',
    label: 'Art Batch',
    changes: [
      {
        category: 'UI / Info',
        text: 'Grand Larceny gets its illustration (the last Gift without one); Old Timber, Sylus, Branch Manager and Jumpstart Jules wear new portraits, and a handful of card-art framings were re-tuned.',
      },
    ],
  },
  {
    date: '2026-09-17',
    label: 'Gamble joins Set 3',
    changes: [
      {
        category: 'New Card',
        text: 'The Gamble spell is now in the Set 3 pool as well: roll a die and get a random minion or spell of that Tier.',
      },
      {
        category: 'New Card',
        text: 'Rune of Gambling, a new Basic rune in every set: get a Gamble, repeat every turn, and your Gambles grant BOTH a minion and a spell of the rolled Tier.',
      },
    ],
  },
  {
    date: '2026-09-17',
    label: 'A real die',
    changes: [
      {
        category: 'UI / Info',
        text: "The Gambler's roll and the Gamble spell now roll a real die. A 3D die tumbles and settles on the number. It hops in place on the power button for the Gambler, and for Gamble it is THROWN from where you released the card, bouncing across the table in the direction you flicked.",
        details: [
          "The Gambler's die lands on the power button and the number stays there for the rest of the turn, as before.",
          'Gamble: flick the card as you release it and the die rolls that way (a faster flick throws a little farther); release it still and it rolls toward the middle of the board. It bounces three times, rolling on the felt, and always stays on the table.',
          'Gamble: the die is coloured by the tier it rolled, and the card you won arrives the moment the die comes to rest on its final bounce.',
          'Both rolls now have a sound as the die leaves your hand.',
          'The roll only shows the result the game already decided, so replays and shared runs roll the same way every time.',
          'Reduced-motion: the die simply appears on its face, with no tumble or burst.',
        ],
      },
    ],
  },
  {
    date: '2026-09-17',
    label: 'Targeting sparkles linger',
    changes: [
      { category: 'UI / Info', text: 'When you finish aiming a spell or hero power, the targeting line\'s sparkles now drift and fade out on their own instead of blinking away with the line.' },
    ],
  },
  {
    date: '2026-09-17',
    label: 'Undead Aura + Spirit tendril sounds',
    changes: [
      { category: 'UI / Info', text: 'The Undead Aura surge now has its own sound cue, in the Shop and mid-combat. It never overlaps itself. Back-to-back rises share one cue.' },
      { category: 'UI / Info', text: "A Spirit's buff ribbon now lands with its own sound, one cue per minion it reaches, in the Shop, at Start and End of Turn, and in combat." },
    ],
  },
  {
    date: '2026-09-16',
    label: 'Apples scales on both ends',
    changes: [
      { category: 'Card Change', text: 'Apples: the "Give this shop" option now gains your Shop-spell bonus too, and its printed number shows the live value. Both ends of the Choose One scale the same way.' },
    ],
  },
  {
    date: '2026-09-16',
    label: 'Milestone badge colours',
    changes: [
      {
        category: 'UI / Info',
        text: "Milestone badges now read state through the number itself: the digit turns green when a stat is buffed above its base and red when it's reduced. The disc behind the frame is a fixed colour per stat: yellow for Attack, red for Health. The lower frames (plain silver, dagger, gold) no longer glow.",
      },
    ],
  },
  {
    date: '2026-09-16',
    label: 'Second hero power retired',
    changes: [
      { category: 'Hero Change', text: 'Void is out of the hero roster for now (Play and Practice). The second-hero-power mechanic is on hold.' },
      { category: 'Card Change', text: 'The Second Calling Gift is retired: Happy Birthday and Merry Christmas no longer hand it out. A copy already in hand still casts.' },
    ],
  },
  {
    date: '2026-09-16',
    label: 'Undead Aura surge',
    changes: [
      { category: 'UI / Info', text: 'Every rise of your Undead Aura now plays its own surge effect over the board, in the Shop and mid-combat alike. The minions it buffs keep their tendrils.' },
      { category: 'UI / Info', text: 'The "New Undead arrive +X Attack" line no longer appears on Deathswarmer, Forsaken Weaver and Karthus.' },
    ],
  },
  {
    date: '2026-09-16',
    label: 'Two more Set 3 Runes, Rebirth tidy-up, Soul Script Collapse',
    changes: [
      {
        category: 'New Rune',
        text: 'Rune of the Open Hand (Epic, 5): when you summon a minion from your hand, another friendly minion gains its stats.',
        details: [
          "Fires on every minion summoned from your hand that finds room, in combat and in the Shop, and gives the summoned minion's current Attack and Health to a random other friendly minion.",
        ],
      },
      {
        category: 'New Rune',
        text: 'Rune of the Waking Reserve (Epic, 6): at Start of Combat, summon a copy of your highest-stat minion in hand when you have room.',
        details: [
          'Highest Attack + Health in hand; the copy keeps that card\'s stats, keywords and gilding.',
          'The hand card is not marked as summoned, so a Spirit can still summon it later in the same fight.',
        ],
      },
      {
        category: 'Rune Change',
        text: 'Rebirth now follows Rise exactly, apart from bringing back the full minion: a reborn minion\'s Avenge progress restarts, and one that dies on its own attack and returns is next to attack again.',
      },
      {
        category: 'Rune Change',
        text: 'Rune of Soul Script: your Undead are now Collapse targets alongside your Celestials (the Supernova\'s "all your Celestials" includes them), and any Undead whose text Consumes can eat the Starform.',
      },
      {
        category: 'Rune Change',
        text: 'Rune of the Traveling Festival: the extra +2/+2 is paid once per Reveler trigger. Holding a second copy still brings a second Reveler each turn but does not raise the bonus.',
      },
    ],
  },
  {
    date: '2026-09-16',
    label: 'One Yazzus',
    changes: [
      {
        category: 'Card Change',
        text: 'Yazzus is one card again, in every set: your targeted spells cast an additional time (a Gilded Yazzus: two additional times).',
        details: [
          'Every targeted spell counts, not just Shop spells: Rubies, Tower Shields and Clues too.',
          'He is a Tier 7 4/8 everywhere; the separate "Set 3 Yazzus" is gone, and a saved run or replay that had one now shows the one Yazzus.',
          'Rune of Yazzus and Rune of Frontline Glory grant this Yazzus.',
        ],
      },
      {
        category: 'Rune Change',
        text: 'Rune of Frontline Glory leaves Set 3 (it stays a Set 1 rune).',
      },
    ],
  },
  {
    date: '2026-09-16',
    label: 'Rebirth, Amplified Equipment + six Set 3 Runes',
    changes: [
      {
        category: 'New Card',
        text: 'New keyword: Rebirth. When a minion with Rebirth dies it returns once with everything it had: its full stats, buffs, keywords and effects. Rise still brings back the printed card at 1 Health.',
        details: [
          'Rebirth resolves before Rise: a minion holding both comes back whole first, and its Rise is still there for the next death.',
          'Its Echo fires on the Rebirth death, and the death counts for Avenge and death-watchers, just like a Rise.',
          'A Ward the minion carried at any point this combat comes back with it.',
          'The returned minion no longer has Rebirth unless something grants it again.',
        ],
      },
      {
        category: 'Rune Change',
        text: 'Rune of Rebirth now gives a random friendly minion Rebirth at Start of Combat (it no longer grants the exact-copy Echo).',
      },
      {
        category: 'New Rune',
        text: 'Amplified Equipment: Rune of Amplification (4) makes Equipment you do not activate Amplified. Amplified Equipment triggers twice the next time you activate it (max 1 per Equipment). Rune of the Grand Workshop (Epic, 6) Amplifies all your Equipment now and every Start of Turn.',
      },
      {
        category: 'New Rune',
        text: 'Rune of Soul Script (5, Undead + Celestial): Starforms count as Undead, so Undead Consumes, buffs and Auras reach them.',
      },
      {
        category: 'New Rune',
        text: 'Rune of the Red Giant (Epic, 5, Celestial): your Starform has a 50% chance to also Consume a Shop spell when it feeds. You get a copy of that spell and the Starform gains +8/+8.',
      },
      {
        category: 'New Rune',
        text: 'Rune of the Final Gate (Epic, 6, Undead): the first time each combat your board becomes empty, three random Undead that died this combat return.',
      },
      {
        category: 'New Rune',
        text: 'Rune of Dreamed Graves (Epic, 4, Undead): the first minion summoned from your hand each combat gains Rebirth.',
      },
      {
        category: 'UI / Info',
        text: 'The Equipment charge number turns blue while that Equipment is Amplified, and its tooltip says so.',
      },
    ],
  },
  {
    date: '2026-09-16',
    label: 'Set 3 runes: Spirits and Celestials',
    changes: [
      {
        category: 'New Rune',
        text: 'Twenty-four new Set 3 Runes for Spirit, Celestial and Undead runs: eleven in the Runeforge and thirteen in the Epic Runeforge.',
        details: [
          'Tribe faucets: Rune of Basic / Epic Spirits, Celestials and Undead. A minion of that type (two for the Epic) now and every Start of Turn, never above your Shop Tier.',
          'Spirit play-offs: Rune of the Full Hand (every 3rd Spirit played buffs your hand +4/+4), the Chosen Vessel (each Spirit played gives your left-most hand minion +2/+2), Deep Currents (each Spirit played gives 2 random friendly Spirits +2/+2), the Spirit Crown (every 3 Spirits played improve your Shop spells +1/+1).',
          'Reveler runes: the Traveling Festival (a random Reveler every turn, and Revelers pay +2 more), the Growing Chorus (play all three Reveler types: board + hand +5/+5 and your Reveler value +2), Festival Wages (your first Reveler sold each turn makes your next card free), Shared Revelry (the first Flame, Tide and Grove sold each turn trigger twice), the Grand Procession (the first 2 Revelers played each turn return a plain copy), the Festival Circuit (the first 3 Revelers sold each turn each give a random Celestial).',
          "Celestial spell runes: Charted Skies (your 3rd Shop spell each turn Discovers a Shop spell), Falling Embers (a Star Crash every turn, and every Star Crash gives +2/+2 more, with the card showing the new value), the Meteor Shower (your first Star Crash each turn gives another), the Astral Refrain (your 3rd Shop spell each turn hands you copies of that turn's 1st and 3rd), the Astral Draft (Start of Turn: Discover a Shop spell that casts an additional time).",
          'Hand runes: the Dream Mirror (the first time a hand minion gains stats each turn, a random friendly minion gains the same) and Waking Dreams (whenever a hand minion gains stats, your minions +4/+3).',
          'Rune of the Handy Flame hands you a new rune-only Spirit: Handy Flame (Tier 5, 2/13). Whenever it gains stats, a random other minion in your hand gets +6/+4.',
          'Every metered rune shows its live progress on its badge, and the "improves" runes show their current bonus.',
        ],
      },
      { category: 'New Card', text: 'Handy Flame is a Tier 5 Spirit token reached only through its rune. No art yet.' },
    ],
  },
  {
    date: '2026-09-16',
    label: 'Set 3 runes: Starform, Equipment, Undead',
    changes: [
      {
        category: 'New Rune',
        text: 'Nineteen new Set 3 Runes: eight Basic and eleven Epic, built around the Starform, Equipment and the Undead.',
        details: [
          'Starform (Basic): Rune of First Light creates a Starform that starts +8/+8, as does every one you create after, and seeds a new one each Start of Turn if you have none; Rune of Accretion doubles what your Starform gains from the Shop minions it Consumes; Rune of Eventide pays 2 Shop spells and +1/+1 spell power the first time you Consume or Collapse a Starform each turn.',
          "Starform (Epic): Rune of the Open Constellation re-creates a Starform with the consumed one's stats after your first Consume each turn; Rune of the Supernova makes a Collapse reach ALL your Celestials; Rune of Stolen Constellations hands you a copy of every minion your Starform Consumes; Rune of Spellweaving feeds your first 3 stat-granting Shop spells each turn to your Starform too.",
          'Equipment (Basic): Rune of Efficient Tooling takes 2 Gold off your first Equipment activation each turn; Rune of Quick Release makes your next activation free after you sell an Equip minion; Rune of Resonant Arms gives your minions +8/+5 after every third Equipment effect you trigger (the badge counts toward it).',
          "Equipment (Epic): Rune of Overcharge makes your first activation each turn free and charge-less; Rune of Dismantling fires a sold Equip minion's Equipment for free before it leaves (once per turn, at a random friendly minion); Rune of Counterrotation re-triggers three different Equipment once you have activated all three; Rune of Empty Hands Discovers an Equip minion whose Equipment costs 0 for the rest of the run; Rune of the Last Tool gives your Equip minions \"Echo: this minion's Equipment costs 0 next turn\".",
          'Undead: Rune of Last Rites returns a plain copy of the first Undead you destroy in the Shop each turn; Rune of the Crowded Crypt gives your minions +1/+1 permanently whenever a summon does not fit (twice in the Shop); Rune of the Endless March summons a 1/1 Skeleton after a friendly Undead Rises; Rune of the Grave Orbit gives your Starform +15/+15 after combat for each friendly Undead that Rose.',
          'A grafted Echo (Rune of the Last Tool, Contract Rewrite, Rune of Rebirth) now fires on a Shop death as it already did in combat.',
        ],
      },
    ],
  },
  {
    date: '2026-09-16',
    label: 'Echo buffs show their source',
    changes: [
      {
        category: 'UI / Info',
        text: "A buff granted by a minion's Echo now streams its tribe's ribbon from where that minion fell to each minion it pays, in combat and in the shop. Before this an Echo's gift simply appeared with no cue at all.",
        details: [
          'Every Echo that buffs others (Dawn Sentinel, Noggin, Sergey, Grim, Armadiyo, Imp King, Trickster, Equinox Duelist, Lodestar, Chef Raag, …) draws the ribbon a beat after its death has read.',
          'In the shop, an Echo fired by a destroy (Cage Breaker, Graverobber, EMS, a Funeral on Loan return) leaves from the slot the card just vacated.',
          "Wolvie's gift to the next Beast you summon now streams from the fallen Wolvie; a dead Grim's aura on a later Beast does the same.",
          "Flamebanner Marshal's Rally, Ashen Heir's inheritance, a Better Bot welded onto a Mech and a Bloodlust Rally used to land invisibly. Each now shows its ribbon from the minion that granted it.",
          "In the shop, Billings and Coinfire Forewoman's Gold-spent buffs, Gangplank's card-gained buff, and a Reveler's sell payout now show their ribbons too (a sold Reveler's leaves from the slot it was sold from).",
        ],
      },
    ],
  },
  {
    date: '2026-09-16',
    label: 'Milestone frames',
    changes: [
      {
        category: 'UI / Info',
        text: "Milestone badge frames now change at new values: plain silver below 50, the silver dagger at 50, gold at 150, pink at 500, blue at 2000, and a new top crystal frame at 5000.",
      },
      {
        category: 'UI / Info',
        text: "The celebration when a stat crosses a milestone now bursts in that tier's own colour, matching the frame it just earned, instead of the same gold every time.",
      },
    ],
  },
  {
    date: '2026-09-16',
    label: 'Echohorn strikes on time',
    changes: [
      {
        category: 'UI / Info',
        text: "Echohorn's attack no longer freezes reared-back and then lands late: when the Echo it triggers resolves inside the wind-up (a summon, a buff), it now pauses briefly for the Echo and then strikes with its hit landing on contact, like every other Rally swing.",
        details: [
          'The frozen-pose hold is kept only for Echoes that play out in beats of their own (a Fel Spikes spray, a re-fired Shout, a summoned charger), where the swing waits for them and then lands.',
          "A held Echohorn whose blow was absorbed by the defender's Ward no longer stays frozen for the rest of the fight. The Ward absorb counts as its strike landing.",
        ],
      },
    ],
  },
  {
    date: '2026-09-15',
    label: 'Runeforge commits',
    changes: [
      { category: 'UI / Info', text: 'The Runeforge no longer offers a way to leave without a rune. Pick one of the offered Runes. The free re-roll is still there.' },
    ],
  },
  {
    date: '2026-09-15',
    label: 'Adopted hero-power prices',
    changes: [
      {
        category: 'Hero Change',
        text: "A hero power you pick up mid-run (Void's turn-4 picks, Mimic's disguises, Power Shifter) now starts its price clock the turn you take it. Rounded Spellbook costs 3 on the turn you pick it, not 0.",
        details: [
          "Rounded Spellbook and Buyout used to count their discount from turn 1 even when you adopted them later, so a Void picking Rounded Spellbook on turn 4 got it free from the start and its cost coin was blank. They now start at their full price (3 / 11) on the pick turn and fall 1 a turn from there, exactly like Hunch and Harlan do from turn 1.",
          "All In pays out from 1 Gold on the pick turn (it used to arrive with several turns already banked). Dragon Tamer starts at its full 5.",
          "Dynamite Dig's first dig is free for a new wielder, whatever the power it replaced had spent. Gild arrives ready even if the power it replaced was used, and its 75-Gold recharge now works for a Void, a Mimic or a Power Shifter, not only for Indy.",
        ],
      },
      { category: 'UI / Info', text: "Both of Void's hero-power buttons show the cost coin for any power that costs Gold, and the coin reads exactly what the power will charge. Passives (Empowering Vines and kin) still show their passive badge instead of a coin." },
    ],
  },
  {
    date: '2026-09-15',
    label: 'Hand buff cue',
    changes: [
      { category: 'UI / Info', text: 'A card in your hand getting stronger now bursts and pops in place with a new effect, in the Shop, at End of Turn and mid-combat alike. That covers a minion gaining stats, or a spell, Ruby or token whose printed value goes up. It replaces the old grow-and-sparkle on spells, and hand minions finally get a cue too.' },
    ],
  },
  {
    date: '2026-09-15',
    label: 'Bounce cue',
    changes: [
      {
        category: 'UI / Info',
        text: 'When a spell or Ruby bounces onto a different minion because of where it first landed, a ribbon now streaks from the first target to the second. One per bounce, so a doubled bounce reads as two.',
        details: [
          "Plays for Star Crash's second landing, Crash Course's extra Star Crashes, Reflector's spread, Rune of Distillation (a Shop minion to your left-most), Rune of Redirection (left-most to right-most), Rune of the Conduit, and Trouble in combat.",
          'Rubies get a red ribbon; spells get a first-pass purple-and-blue one that will be tuned later.',
          'A spell that simply casts AGAIN on the same minion (Mirrorwing, Nimbus, Yazzus, Prismcaster) does not use this cue. It will get its own.',
        ],
      },
    ],
  },
  {
    date: '2026-09-15',
    label: 'Start of Combat / End of Turn buffs show their source',
    changes: [
      {
        category: 'UI / Info',
        text: 'Start of Combat and End of Turn buffs now show where they come from: every minion that gets stats from another minion, a rune or a hero power gets its own ribbon (or rune sparkle) from that source.',
        details: [
          "Old Timber's Start of Combat gift to your Spirits now streams a Spirit ribbon to each one (it used to land with no effect at all).",
          "Emissary's United Front and Aevor's Tempest now draw a ribbon from the hero-power button to each minion they pay (both used to land silently).",
          'End of Turn ribbons (Kringle, Striker, Mother Moss…) aim at the slot each card is settling into, not wherever it is drawn mid-bounce.',
        ],
      },
    ],
  },
  {
    date: '2026-09-14',
    label: 'Tendrils: Celestial + Equipment',
    changes: [
      { category: 'UI / Info', text: 'Celestials such as Wishing Star have their own buff ribbon (a moonlit periwinkle) instead of the generic one.' },
      { category: 'UI / Info', text: 'Equipment that buffs your minions without its own effect (Spiritbinder, the Stellar Lens’s board half) now draws the buff ribbon from the minion that granted it, like any minion-to-minion buff.' },
    ],
  },
  {
    date: '2026-09-14',
    label: 'Starform creation',
    changes: [
      { category: 'Card Change', text: 'The Starform always returns to the right-most Shop slot on a refresh. You can still drag it around during the turn.' },
      { category: 'UI / Info', text: 'A Starform being created has its own burst-and-ring cue on its slot. Forming one in a full Shop no longer pulls the eaten minion across the row or shuffles the other offers. It simply appears where that minion stood.' },
    ],
  },
  {
    date: '2026-09-14',
    label: 'Tendril aim fix',
    changes: [
      { category: 'UI / Info', text: 'A buff ribbon aimed at a minion you just dropped now lands on its slot on the board, not on the spot where you let go of it (Aspect buffing the Spirit you played showed it).' },
    ],
  },
  {
    date: '2026-09-14',
    label: 'Rocket Power + counters + Spirit tendril',
    changes: [
      { category: 'Card Change', text: 'Rocket Power: Shout, give this shop +3/+3, then repeat it for every Shop spell you cast this turn. It used to do nothing with no spell cast.' },
      { category: 'UI / Info', text: "The step counter on a hovered card no longer sits on top of the card name. It now rides just under the plate's bottom gem." },
      { category: 'UI / Info', text: 'Spirits have their own buff ribbon: when a Spirit buffs another minion, a warm gold-and-green tendril streams between them.' },
    ],
  },
  {
    date: '2026-09-14',
    label: 'Milestone badges',
    changes: [
      {
        category: 'UI / Info',
        text: 'Attack and Health badges now sit in tiered frames that light up as a unit grows, with a celebration when a stat hits a new milestone in the shop.',
      },
    ],
  },
  {
    date: '2026-09-14',
    label: 'Set 3 rune roster',
    changes: [
      {
        category: 'Rune Change',
        text: 'Set 3 Runeforges now draw from 115 Basic and 98 Epic runes. 64 runes from Sets 1 and 2 whose mechanics Set 3 has join the pool: the Ruby, Dwarven Ale, Dwarf, Kobold, Undead and Shop-consume packages. Sets 1 and 2 are unchanged.',
        details: [
          'Basic (30): Gemcutting, Overtime, Distillation, Last Call, Basic Dwarves, Basic Kobolds, Engraving, Investment, Recollection, Resonance, Ruby Resonance, Shared Pour, Shifting Facets, the Flagship, the Gem Dividend, Compounding Wages, Facetwright, Full Measure, Heavy Payroll, Kegheart, Refraction, Shared Spoils, the Brew, the Living Geode, Mountain Trade, the First Round, the Gem Sage, the Unbroken Vein, the Warden, Contraband.',
          'Epic (34): Rising Graves, Gemstorm, Runic Exchange, the Open Market, Epic Dwarves, Epic Kobolds, the Shared Table, the Spellstone, Attacking Gems, Engraving Gems, Gemscript, Gemspam, Living Treasure, Mykel, Profit Sharing, Redirection, the Gem Golem, the High King, Yazzus, Lazarus, Ruby Shrapnel, the Bottomless Cask, the Conduit, the Deepening Vein, the Lapidary, the Motherlode, Baal, Double Fisting, Kobold Bebes, the Chef, Bucky, Mastery, the Spearline, Frontline Glory.',
          'In Set 3, Rune of Yazzus and Rune of Frontline Glory grant the Set 3 Yazzus (Tier 7). A Starform eating a Shop minion counts as your first Shop consume for Rune of the Open Market.',
        ],
      },
    ],
  },
  {
    date: '2026-09-14',
    label: 'Celestial + Spirit batch',
    changes: [
      {
        category: 'Card Change',
        text: 'A Celestial pass: Star Seed, Stardust Peddler, The Great Attractor, Roundabout, Lens Grinder, Wishing Star, Rocket Power (was Shooting Star), Twinning (was Twin Star) and Black Hole (was Accretion) all changed.',
        details: [
          'Star Seed: an existing Starform now gets +4/+4 (was +2/+2).',
          'Stardust Peddler: whenever you buy a minion, create a Starform if you have none. Otherwise give it +1/+2.',
          'The Great Attractor: Shout, give this shop +4/+3, then your Starform consumes the highest-Health minion. It used to eat the highest Tier, with no buff.',
          'Roundabout: now Tier 5, 7/5. End of Turn: your Starform consumes the whole Shop. Start of Turn: create one if you have none.',
          'Lens Grinder: now Tier 4, 4/6. Stellar Lens (2): create a Starform, then give this shop +7/+7 (was +10/+10, no create).',
          'Wishing Star: Shout, give adjacent minions +3/+4. It was Shout and Echo, this shop +2/+2.',
          'Rocket Power (was Shooting Star): no Flurry. Shout, this shop +3/+3 for every Shop spell cast this turn.',
          'Twinning (was Twin Star): now Tier 5.',
          'Black Hole (was Accretion): your Starform consumes 3 random Shop minions. No Star Crash any more.',
        ],
      },
      {
        category: 'Card Change',
        text: "Spell tuning: Crescendo gives +2/+2 per Spirit played (was +1/+1); Lantern of Souls gives your Undead Aura +5 Attack (was +3); Staff of Guel gives +3/+3 (was +2/+2) and reads \"Give minions in the shop +3/+3\"; Aspect's Blessing is now \"a random minion in your hand +3/+2, or a random friendly minion +2/+1\".",
      },
      {
        category: 'Card Change',
        text: 'Common Ground is no longer offered in Set 3.',
      },
      {
        category: 'UI / Info',
        text: 'New icons for the Star Destroyer and Stellar Lens, new Stellar Chorus spell art, and refreshed portraits for Picksy and Flame Reveler.',
      },
    ],
  },
  {
    date: '2026-09-14',
    label: 'Drag feel',
    changes: [
      {
        category: 'UI / Info',
        text: 'Your warband now opens a slot to make room a little sooner as you drag a minion up from hand. You no longer have to lift it as far before the board reacts.',
      },
    ],
  },
  {
    date: '2026-09-14',
    label: 'Celestial + Spirit colours',
    changes: [
      {
        category: 'UI / Info',
        text: 'Celestial and Spirit cards now show their tribe name on the plate gem like every other tribe, and carry a tribe colour (their names, bold rules text and medallion glyph had been unpainted).',
      },
    ],
  },
  {
    date: '2026-09-14',
    label: 'Ruby targeting',
    changes: [
      {
        category: 'UI / Info',
        text: 'Rubies (and Ruby Transfer) now get their own targeting effect when you aim them from hand, distinct from the normal spell targeting look.',
      },
    ],
  },
  {
    date: '2026-09-14',
    label: 'Set 3 art pass',
    changes: [
      {
        category: 'UI / Info',
        text: "A Set 3 art pass: new portraits for Lodestar, Stardust Peddler, Maestro Lux, Twin Star, Wishing Star, Zenith, Constellation Prime and Shooting Star; new spell art for Crescendo, Shared Spirit, Star Crash, Hand Soap and both branches of Aspect's Blessing, Rush Order and Split Decision; refreshed art for Plummet, Sugarnova, Aspect and twenty-odd more minions, the Magnifying Glass, Accretion, Lantern of Souls, Dragonflame and Flutter.",
      },
    ],
  },
  {
    date: '2026-09-14',
    label: 'Warden rework',
    changes: [
      {
        category: 'Hero Change',
        text: "Warden's Aegis now costs 3 Gold (was 4): give a friendly minion Ward, then give your minions with Ward +5 Attack.",
        details: ['The buff is a flat +5 Attack to every Warded minion, the fresh one included. It no longer scales +Tier/+Tier+1 and no longer adds Health. It can be used on a minion that already has Ward. The Ward half adds nothing, but every Warded minion still gets the +5 Attack.'],
      },
    ],
  },
  {
    date: '2026-09-14',
    label: 'Set 3 renames',
    changes: [
      {
        category: 'Card Change',
        text: 'Thirty Set 3 minions have new names. Names only: stats, effects and art are unchanged.',
        details: [
          'Celestials: Horizon Courier → Cosmo Express · Starpath Vendor → Sugarnova · Falling Star Herald → Plummet · Crashborn Adept → Crash Course · Accretion Warden → The Great Attractor · Eclipse Warden → Totality · Orbit Keeper → Roundabout · Corona Devotee → Solburn · Star Charter → Maestro Lux · Nova Herald → Fuse Aldrin.',
          'Spirits: Dreamcurrent Mystic → Lullaby Lou · Gathering Guide → Branch Manager · Festival Keeper → Tally · Bondweaver Shaman → Knot · Spirit Artificer → Revelsmith · Festival Treasurer → Smokey Joe · Festival Luminary → Limelight · Slumbering Colossus → Dozer · Forest Colossus → Old Timber · Nurturer → Mother Moss.',
          'Kobolds: Facetbound Martyr → Shardluck · Dealer → Double Dealer · Veinchant Delver → Delver · Prismpick Artificer → Picksy · Runespark Channeler → Livewire · Splitpick Apprentice → Pickles.',
          'Neutrals: Equipment Charger → Jumpstart Jules · Splitboon Adept → Halfsies · Warband Recruiter → Uncle Orc. Undead: Soul-Lantern Hierophant → Wick Mortis.',
        ],
      },
    ],
  },
  {
    date: '2026-09-14',
    label: 'Spiritbinder fix',
    changes: [
      {
        category: 'Card Change',
        text: "Spiritbinder (Bondweaver Shaman's Equipment) now gives a RANDOM Spirit on your board and a random Spirit in your hand +6/+6. It no longer asks for a target.",
        details: ['It could be aimed at a non-Spirit, which the card never promised. Picking its own Spirit on the board (the Shaman itself included) closes that; the hand half was already random.'],
      },
    ],
  },
  {
    date: '2026-09-14',
    label: 'Targeting look',
    changes: [
      {
        category: 'UI / Info',
        text: 'New targeting effect when you aim a targeted spell, hero power or equipment: a custom glowing lasso that follows your cursor.',
        details: [
          'The aim line now plays a fully authored effect (built in the FX workshop) instead of the old default line. It is the same look across spell casts, targeted hero powers, and the two-target picker.',
          'It can layer more than the lasso now (a custom image / stream that rides your cursor), so the targeting look is tunable rather than fixed.',
          'The impact effects that fire on the target when you release are unchanged.',
        ],
      },
    ],
  },
  {
    date: '2026-09-13',
    label: 'Spiritbinder + art',
    changes: [
      {
        category: 'UI / Info',
        text: 'Stellar Chorus (and Clues) in the Shop now show the exact value they will grant right now. The tavern kept printing the base +2/+2 after spells had been cast, while the same card in hand read the true total.',
      },
      {
        category: 'Card Change',
        text: "Bondweaver Shaman's Equipment is now called Spiritbinder (was Spiritbringer). Same effect.",
      },
      {
        category: 'UI / Info',
        text: 'New art for Spiritbinder, Revelmaker and the Comet Equipment, plus refreshed portraits for Neptus, Cometius and Spirit Artificer.',
      },
    ],
  },
  {
    date: '2026-09-13',
    label: 'Celestials: Starform rules v2',
    changes: [
      {
        category: 'Card Change',
        text: 'The Starform now costs Gold, and buying it feeds it to your left-most Celestial. It appears at 6 Gold and gets 1 cheaper with every Shop refresh.',
        details: [
          'The token spawns at 6 Gold. Every refresh, paid or free, takes 1 off, down to 0. The lower price carries into your next turn; a brand-new Starform (including one Zenith re-creates) starts at 6 again.',
          'Buying it: your LEFT-most Celestial on the board consumes it and gains all of its stats. With no Celestial on board the Gold is still spent and the token is simply gone.',
          'Every normal discount applies to it: Rune of Cadence, Trade-In, the Friends-and-Family Gift, the Thymepiece window, a free first buy. The coin on the card always shows what you will pay.',
          'It still counts as a minion bought (Stardust Peddler and every "whenever you buy" effect hear it). The old free "buy to dismiss" is gone.',
        ],
      },
      {
        category: 'New Card',
        text: 'Star Destroyer is an Equipment you hold whenever you have a Starform. Use it (0 Gold, once per turn) to remove the Starform from the Shop with no other effect.',
        details: [
          'It sits in the Equipment rail beside anything your minions grant, with its own once-per-turn charge, and leaves the rail the moment the Starform is gone.',
          'Using it is a clean removal: nothing gains stats, nothing counts as bought, and Zenith does not re-create the token.',
        ],
      },
      {
        category: 'Card Change',
        text: 'Collapse is now 2 random friendly Celestials (was 3), each gaining half the Starform’s stats rounded up. Corona Devotee now Collapses instead of Consuming; Nova Herald becomes a passive that adds 2 extra Collapse hits.',
        details: [
          'Corona Devotee: "Shout: Collapse your Starform." (gilded: each hit gains the full stats). Its old Consume is now what buying the token does.',
          'Nova Herald: "When you Collapse a Starform, it buffs 2 additional random Celestials." (gilded: 4). The extra hits can land on the same Celestial more than once. With two Celestials one can take three hits and the other one. Two Heralds add 4.',
          'A Collapse with a single Celestial gives it the one hit plus every extra; with none, the token still breaks and the stats go nowhere.',
        ],
      },
      {
        category: 'UI / Info',
        text: 'The Starform pull animation now plays once per Collapse hit, so a Celestial hit twice pulls twice; a Star Destroyer removal plays nothing.',
      },
    ],
  },
  {
    date: '2026-09-12',
    label: 'Celestials: the Starform',
    changes: [
      {
        category: 'Card Change',
        text: 'Corona Devotee, Nova Herald and Twin Star read shorter: "Consume your Starform", "Collapse your Starform" and "this does, too". Same effects.',
        details: [
          'Corona Devotee: "Shout: Consume your Starform." (gilded: "…for double its stats"). It still gains every stat the token had.',
          'Nova Herald: "Shout: Collapse your Starform." (gilded: "…each gains its full stats"). The Collapse keyword box beside the card explains the split.',
          'Twin Star: "Whenever your Starform gains stats, this does, too." (gilded: "this gains double").',
        ],
      },
      {
        category: 'UI / Info',
        text: 'Collapse now has its own keyword box beside the card, and so does the Starform. Hover a Celestial that names either and the side panel explains it.',
      },
      {
        category: 'UI / Info',
        text: 'The Starform has its own consume animation. A beam of starlight and a rush of particles fly from whatever is being consumed to whatever gains: the meal into the token, the token into Corona Devotee, and one pull to each of the three Celestials when Nova Herald collapses it.',
      },
      {
        category: 'Card Change',
        text: 'Thymes and its Thymepiece are reworked: instead of banking time for next turn, using the Thymepiece makes every card in the Shop cost 1 less Gold for the next 8 seconds.',
        details: [
          'Thymepiece still costs 3 Gold to use and needs no target. Gilded Thymes: 2 less Gold, same 8 seconds.',
          'It applies to cards only: Shop minions, the spell slot and any spell offers in the row. Upgrading the Shop and refreshing cost what they always did. Prices never go below 0.',
          'The 8 seconds run on the turn clock, so anything that pauses the clock (a Discover, a Choose One, aiming) pauses the discount too. While it is active every Shop price shows the green discounted coin, and the Equipment slot counts it down ("−1 Gold · 6s").',
        ],
      },
      {
        category: 'Card Change',
        text: 'Comet Conductor is now Neptus, and Orrery Artificer is now Cometius. Same cards, new names.',
      },
      {
        category: 'Card Change',
        text: 'Lantern of Souls now reads "Give your Undead Aura +3 Attack." Same effect; the live text shows spell power on both stats (for example +3/+1).',
      },
      {
        category: 'UI / Info',
        text: 'Scaling spells now print their current value in place, in green, instead of adding a "Now +X/+Y" note at the end.',
        details: ['Stellar Chorus with two spells already cast reads "Give a minion +8/+8" in green rather than "+2/+2 … Now +8/+8". Patch Job and Crescendo follow the same rule.'],
      },
      {
        category: 'New Card',
        text: 'Set 3 Celestials: sixteen new minions, a new spell and a new Equipment built around the Starform. The Starform is a 1/1 Celestial token that lives in your Shop, grows from every shop buff and consume, and is cashed in by your Celestials.',
        details: [
          'The Starform sits in the Shop like any offer. Its printed stats are the counter, with no rules text. It survives every refresh in its own slot, keeps "this shop" buffs the others lose, and eats the right-most Shop minion when it is created into a full row. Buying it costs 0 Gold and simply dismisses it (that still counts as a minion bought).',
          'Star Seed (T1): Shout, create a Starform, or give the one you have +2/+2. Dawn Sentinel (T1): Taunt. Echo, a random friendly Celestial +2/+1.',
          'Stardust Peddler (T2): whenever you buy a minion, your Starform +1/+1. Wishing Star (T2): Shout AND Echo, this shop +2/+2.',
          'Accretion Warden (T3): Shout, your Starform consumes the highest-Tier Shop minion (ties go right). Shooting Star (T3): Flurry. Shout, this shop +3/+3 for each Shop spell you cast this turn. The card prints the live total. Eclipse Warden (T3): Avenge (3), get a Star Crash.',
          'Orbit Keeper (T4): End of Turn, Starform +2/+2. Start of Turn, create one if you have none. Corona Devotee (T4): Shout, consume your Starform and gain all its stats. Star Charter (T4): Shout, Discover a Celestial.',
          "Lens Grinder (T5): Equip Stellar Lens (2 Gold), this shop +10/+10. Lodestar (T5): Echo, a friendly Celestial gains this minion's stats. That means its full, undamaged stats.",
          'Twin Star (T6): whenever your Starform gains stats, this gains the same. Nova Herald (T6): Shout, collapse your Starform; 3 random friendly Celestials each gain half its stats (rounded up).',
          'Zenith (T7): whenever you cast a spell (Rubies too), your Starform +3/+3; when it collapses or is consumed, a new one appears with half its stats. Constellation Prime (T7): your Star Crashes land their +5/+7 on the chosen Celestial an extra time, and its Shout gets you 2 Star Crashes.',
          'Accretion (new T3 Celestial spell): your Starform consumes the highest-Health Shop minion, and you get a Star Crash either way.',
          'Star Crash can now be aimed at the Starform itself: it grows the token, and the second +5/+7 still lands on a random friendly minion on your board.',
          'Gilded readings double the numbers: +4/+4 (Star Seed, Wishing Star), +2/+2 per buy (Peddler), double the meal (Accretion Warden, Corona Devotee), +6/+6 per spell (Shooting Star, Zenith), +20/+20 (Stellar Lens), the full stats (Nova Herald, Zenith\'s rebirth), and two extra landings + 4 Star Crashes (Constellation Prime).',
        ],
      },
      {
        category: 'UI / Info',
        text: 'The Choose One window now shows the buffed numbers on a Choose One spell. With spell power up, each option prints in green exactly what it will grant.',
        details: [
          "Aspect's Blessing under +1/+1 spell power offers +4/+2 or +2/+4 in the window, not the printed +3/+1 / +1/+3.",
          "Apples' \"2 random friendly minions\" option shows its live value; its \"this shop +2/+4\" option stays as printed, because that buff never takes spell power.",
          'Crest of the Climb keeps its flat +4 Attack / +4 Health. It is designed not to scale.',
          'Minion Choose Ones (Battlecries) are unchanged: they never took spell power, so their options still print as authored.',
        ],
      },
      {
        category: 'Card Change',
        text: 'Gathering Guide can no longer Discover a copy of itself.',
      },
      {
        category: 'UI / Info',
        text: "Standard Bearer's Rally now fires a beam of light to each minion it empowers, cascading one after another.",
      },
    ],
  },
  {
    date: '2026-09-11',
    changes: [
      {
        category: 'UI / Info',
        text: 'Shop prices now show every discount that the buy actually takes: Festival Treasurer\'s Spirit discount, Rune of Trade-In, Rune of Cadence and the Friends and Family Gift.',
        details: ['Festival Treasurer was working (the Spirit was charged less) but the coin never showed it, so it looked broken. The card now also says how much is banked: "Next Spirit: −N Gold".'],
      },
      {
        category: 'Card Change',
        text: 'Comet Conductor now names the spell its Rally will copy once you have cast one this turn, the way Steward of Spells does.',
      },
      {
        category: 'Card Change',
        text: 'Festival Keeper and Aspect track their progress in the corner counter (the same one Avenge uses) instead of in the card text.',
        details: ['Festival Keeper shows N/3 Spirits toward the next spell; Aspect shows N/3 triggers toward its next improvement. Aspect still prints its current buff live.'],
      },
      {
        category: 'Card Change',
        text: 'Stellar Chorus: spell power now improves the per-spell bonus as well as the base, and the card in your hand shows the exact total it will grant.',
        details: ['With +1 spell power and two spells cast this turn it now grants (2+1) + 2 × (3+1) = +11/+11. Both printed numbers turn green when spell power applies, and the "Now +X/+Y" total appears on the hand card, not only in the shop.'],
      },
      {
        category: 'Card Change',
        text: "Kaura L'roft's Equipment is now called Dual Rubetta's (was Dueling Rubetta's). Same effect, new name on the card and the Equipment.",
      },
      {
        category: 'Card Change',
        text: 'Each Equipment can now be used once per turn on its own. Bonus charges are shared between all your Equipment and are spent first. They show in green.',
        details: [
          'Previously all your Equipment shared a single use per turn. Now every Equipment you hold has its own charge, so with two Equip minions on the board you can activate both each turn.',
          'Bonus charges (Equipment Charger’s Start of Turn grant, 2 when gilded) go into one shared pool that any Equipment can draw from. The pool is spent before an Equipment’s own charge.',
          'The number on an Equipment is its own remaining charge plus the shared pool. It turns green while the pool has charges in it, and drops back to plain for every Equipment the moment the pool is spent.',
        ],
      },
      {
        category: 'Hero Change',
        text: 'Brackus: continuing a saved run no longer re-arms his opening "locked until 70 Gold spent" condition on a later Discover.',
        details: [
          'After Save & Quit → Continue, the next card Brackus picked from any Discover could arrive locked until 70 Gold had been spent. The run-start lock was leaking back in on reload. Fixed: a resumed run keeps exactly the Discover state it was saved with.',
        ],
      },
      {
        category: 'Card Change',
        text: 'Hawkus and Mineral Master now answer every extra Rally a multiplier adds. With Uron on your board, each fires twice per Rally, like Paragon already did.',
        details: [
          'Rally watchers ("whenever you trigger a Rally…") were split across two lists: the free-Rally list knew all three, the multiplier list knew only Paragon. One list now serves both, so a free Rally and an extra Rally reach the same cards.',
          'A Rally watcher that summons (Hawkus triggering an Echo) no longer fires a third time when the summoned body shifts it along the board.',
        ],
      },
      {
        category: 'Card Change',
        text: 'Aspect Choreographer is now simply Aspect. Same card, shorter name.',
      },
      {
        category: 'New Card',
        text: 'Set 3: the Celestials return as eight new minions built around spells: Horizon Courier, Starpath Vendor, Gravestar Seer, Comet Conductor, Falling Star Herald, Crashborn Adept, Astral Spellcore and Orrery Artificer.',
        details: [
          'Horizon Courier (Tier 1, 1/1): Echo, get a random Shop spell.',
          'Starpath Vendor (Tier 2, 2/4): Shout, give your next Shop spell +2/+2.',
          'Gravestar Seer (Tier 3, 3/3, Celestial and Undead): whenever you cast a spell (Rubies included), this gains +4 Attack permanently.',
          'Comet Conductor (Tier 4, 4/5): Rally, get a copy of the first spell you cast this turn. Once per combat.',
          'Falling Star Herald (Tier 4, 4/6): Shout and Echo, get a Star Crash.',
          'Crashborn Adept (Tier 5, 5/8): the first time each turn you cast Star Crash on this, cast it on 2 other friendly Celestials.',
          'Astral Spellcore (Tier 6, 7/9): when you cast 3 Shop spells, give your Celestials +6/+6. Repeatable; only spells cast while it is on your board count, and its counter shows on the card like an Avenge counter.',
          'Orrery Artificer (Tier 6, 6/10): Equip Comet (4 Gold), your next spell casts 2 additional times.',
        ],
      },
      {
        category: 'Card Change',
        text: 'Set 3: Yazzus moves to Tier 7, matching his Set 2 tier. His stats and text are unchanged.',
      },
    ],
  },
  {
    date: '2026-09-10',
    changes: [
      {
        category: 'Rune Change',
        text: 'Runes and heroes are now tribe-gated. A rune that names a tribe on your board (your Dragons, a friendly Kobold) is only offered by the Forge in runs where that tribe is in play, and a hero whose power needs a tribe (Tiff needs Dragons, Flint needs Dwarves) is only offered, or adoptable through Mimic, Void and Power Shifter, in runs that rolled it.',
        details: [
          'Sixty-six runes carry a tribe now: every Dragon, Beast, Demon, Mech, Undead, Dwarf and Kobold rune, including the ones that hand you a tribe body (Kegheart, High King) and the Imp runes (Imps are Demons).',
          'The two Menagerie runes are offered whenever any of their five tribes is in the run.',
          'The hero picker now rolls the run first, so the heroes you are shown fit the tribes you are about to play.',
        ],
      },
      {
        category: 'Card Change',
        text: 'Wording: "other" now always means a same-named copy can still be targeted, and "different" means no copy of that card can. Lieutenant Thane and Menagerie Mammoth read "different" to match what they already do.',
      },
      {
        category: 'New Card',
        text: 'Nine new Set 3 spells.',
        details: [
          "Aspect's Blessing (Tier 1) is a Choose One: a random minion in your hand gets +3/+1, or +1/+3.",
          'Rush Order (Tier 2, Dwarf) is a Choose One: get a random Dwarven Ale, or gain 3 Gold next turn.',
          'Shared Spirit (Tier 2): a random minion on your board and a random minion in your hand get +3/+2.',
          'Star Crash (Tier 3, Celestial): give a Celestial +5/+7; it also casts on a random friendly minion.',
          'Grave Robbery (Tier 3): destroy a friendly minion, get a random Shop spell.',
          'Hand Soap (Tier 4): the left-most minion in your hand gets +8/+8.',
          'Crescendo (Tier 6, Spirit): your minions get +1/+1 for each Spirit you played this turn.',
          'Stellar Chorus (Tier 4): give a minion +2/+2, improved by +3/+3 for each spell of any kind you cast this turn.',
          'Split Decision (Tier 5) is a Choose One: Discover a minion, or Discover a Shop spell.',
        ],
      },
      {
        category: 'Card Change',
        text: 'Set 3 spell pool: nineteen spells left (the next-combat keyword spells among them) and seven tribe spells joined: Ruby Shipment, the Facetwright Choice, Veinstorm, Ruby Transfer, Lantern of Souls, Undead Army, On the House.',
        details: ['Spells are now tribe-gated: a Kobold, Dwarf or Undead spell is offered only when that tribe is one of the run tribes. Neutral spells and the Ales are always available.'],
      },
      {
        category: 'Hero Change',
        text: 'Adopting a hero power (Mimic, Void, Power Shifter) now runs the Gild check immediately. A held pair gilds the moment Midas Touch lands, and a gift card from the new power combines on arrival.',
      },
      {
        category: 'Rune Change',
        text: 'Rune of the Chipper Sticker and Rune of Refreshments now fire when you PLAY a Demon from hand or weld a Demon onto a Mech. They were only firing on token summons.',
      },
      {
        category: 'Card Change',
        text: 'Summon from hand: if the board was full and the copy could not land, the hand card is no longer spent. The next summoner can still bring it out once there is room.',
      },
      {
        category: 'Rune Change',
        text: 'Rune of Attacking Gems now PLAYS real Rubies: Deepdelve Paragon multiplies them, Rune of Battle Refraction repeats them, Rune of Engraving Gems makes them permanent, Rune of the Spellstone counts them as casts, and they show the Ruby-landed effect.',
      },
      {
        category: 'Card Change',
        text: 'Avenge timing, two fixes. A minion summoned by an Echo no longer counts the death that summoned it toward its own Avenge. A minion dying in the same clash as its allies no longer counts those deaths while it is dying.',
      },
      {
        category: 'UI / Info',
        text: 'Xerox reads "Summon an exact copy" (it always was one: gilding and progress ride along). Selfless Sentinel now says Ward, like every other card.',
      },
      {
        category: 'UI / Info',
        text: 'Shop stats now say where they came from. A bought minion lists each source separately (Rune of Reinvestment, Contract Butcher, Staff of Guel…), the Buffs panel itemizes them, and Rune of Reinvestment shows its running total on its badge, ticking live during combat.',
      },
      {
        category: 'Card Change',
        text: 'Enigma now triggers on ANY consume by your minions, including Bob Blart at End of Turn and a Demon fed by Appetite Agent. It only fired when Enigma itself ate. Its shop buff plays the same effect as Contract Butcher.',
      },
      {
        category: 'New Card',
        text: 'Wolves Den (Tier 3 Undead/Beast) joins Set 3. Deathrattle, summon 3 Crypt Wolves.',
      },
      {
        category: 'Card Change',
        text: 'A locked card in your hand (the Disco Dan Setlist, the Brackus Summit pick, an Hourglass Reserve) can no longer be summoned from hand by a Spirit or Rope Wrangler. It can still be buffed in hand, and Handbound Titan still reads its stats.',
      },
      {
        category: 'Card Change',
        text: 'Mend: Armor set in the shop now lasts until damage removes it. It was silently reverting after one round in lobby runs.',
      },
      {
        category: 'Card Change',
        text: 'Appetite Agent: the Demon you target now Consumes a RANDOM Shop minion, as printed. It always took the right-most one.',
      },
      {
        category: 'Card Change',
        text: 'Bob Blart with Bottomless Banquet: the right-most Shop minion is eaten again. The bonus bite was shifting the row so Blart missed it.',
      },
      {
        category: 'UI / Info',
        text: 'A minion destroyed in the shop with Rise (Deathfibrillator, Cage Breaker) now plays its Echo first and rises on its own beat afterwards. Both landed in the same moment before, which read as rising before the Echo.',
      },
      {
        category: 'UI / Info',
        text: 'Opponent cards in combat now print the live values of their OWNER: Vaultkeeper, Chef Raag, Steward of Spells, Drunken Oaf, Runesnout Archivist, the Revelers, Runic Archivist, Spell Warden and more read as they did on the board of that player, instead of falling back to base text.',
      },
      {
        category: 'Card Change',
        text: 'The Kindled Sprite on a served Spirit board now gains Attack for the Spirits its owner played that turn. It was fighting at zero.',
      },
      {
        category: 'UI / Info',
        text: 'The Revelers, Festival Luminary, Kindled Sprite and Nurturer now print their live value in the shop, on Discover and in combat, not only on your board and hand.',
      },
      {
        category: 'UI / Info',
        text: 'Shop rolls now weight each card by the copies left in the shared pool. A card down to its last copy is rarer in proportion; before, it was as likely as a full stack until it ran out.',
      },
      {
        category: 'UI / Info',
        text: 'Paragon now strikes each minion it empowers with a bolt of lightning when it triggers a Rally.',
      },
    ],
  },
  {
    date: '2026-09-09',
    label: 'Set 3 Spirits II',
    changes: [
      {
        category: 'New Card',
        text: 'The last seven Spirits, built around a new idea: summoning a minion FROM YOUR HAND. The card stays in your hand. A copy fights.',
        details: [
          'Summon from hand: the copy has the card\'s stats, keywords and gilding at that moment; the card stays in hand (greyed for the fight) and can be summoned only once per combat. Buffs it gains later never reach the copy.',
          'Tide Caller (Tier 5): Echo, summon the highest-Health minion from your hand. Dreaming Deep (Tier 7): the same, and the copy gets Ward.',
          'Seedling Spirit (Tier 2): Rally, summon a random Spirit from your hand.',
          'Handbound Titan (Tier 6): Start of Combat, gain the stats of the highest-Health minion in your hand, this combat.',
          'Flamebanner Marshal (Tier 6): Rally, 2 friendly Spirits gain the Attack of the highest-Attack minion in your hand, this combat.',
          'Hearth Whisperer (Tier 2): Taunt. Whenever it takes damage, a random minion in your hand gets +1/+2, permanently.',
          'Slumbering Colossus (Tier 4): while in your hand, every Spirit you play gives it +4/+4.',
        ],
      },
    ],
  },
  {
    date: '2026-09-09',
    label: 'Set 3 Spirits I',
    changes: [
      {
        category: 'New Card',
        text: 'A new tribe for Set 3: Spirits. Seventeen arrive now: the Revelers you sell for a growing reward, and the Spirits that count how many you play.',
        details: [
          'Flame, Tide and Grove Reveler (Tiers 2, 2, 4): when you sell one, your Spirits get +X Attack (Flame), +X Health (Tide), or every minion gets +X/+X (Grove). X is shared by all three and goes up by one each time. A golden Reveler pays double.',
          'Revelator (Tier 5) and Spirit Artificer\'s Revelmaker (Tier 4 Equip, 2 Gold) hand you a random Reveler. Festival Treasurer (Tier 5): each Reveler you sell makes your next Spirit this turn 1 cheaper, up to 3. Grand Procession (Tier 7): the first Flame, Tide and Grove Reveler you sell each turn return a plain copy to your hand.',
          'Festival Luminary (Tier 6): Shout, 3 random Spirits get +1/+1 plus your Reveler bonus.',
          'Kindled Sprite (Tier 1): Rally, +1 Attack per Spirit played this turn. Nurturer (Tier 3): End of Turn, a random Spirit gets +3/+4, repeated for every Spirit played this turn.',
          'Festival Keeper (Tier 3): after every 3 Spirits you play, get a random spell (progress carries over). Aspect Choreographer (Tier 5): whenever you play a Spirit, 3 random Spirits get +1/+1, improving every 3 triggers. Forest Colossus (Tier 6): Start of Combat, your Spirits get +1/+1 for each Spirit played since it was played.',
          'Tidebud (Tier 1): Shout, a random Spirit on your board and one in your hand get +2 Health. Bondweaver Shaman (Tier 3): Equip Spiritbringer (2), a Spirit on your board and one in hand get +6/+6. Gathering Guide (Tier 4): Shout, if you control a Spirit, Discover a Spirit. Dreamcurrent Mystic (Tier 4): whenever you cast a Shop spell, a minion in your hand gets +4/+6.',
          'Every scaling Spirit prints its current number on the card. Spirits can also be a Practice tribe surge.',
        ],
      },
    ],
  },
  {
    date: '2026-09-09',
    label: 'Forsaken Mage + fixes',
    changes: [
      {
        category: 'Card Change',
        text: 'Forsaken Mage now grows your Undead Aura when you cast ANY spell, not only Shop spells. Rubies, Tower Shields and Clues included.',
      },
      {
        category: 'UI / Info',
        text: 'Hovering a card in your hand no longer floats its referenced card high over the board. The preview sits level with the card.',
      },
      {
        category: 'UI / Info',
        text: 'Clue has its art, and the Set 3 Undead portraits picked up the latest masters.',
      },
      {
        category: 'UI / Info',
        text: 'Hovering Inspector Pell now previews a Clue at its current value, and Clue power shows in the buffs panel beside Ruby power.',
      },
    ],
  },
  {
    date: '2026-09-09',
    label: 'Set 3 Neutrals III',
    changes: [
      {
        category: 'New Card',
        text: 'The last three Set 3 Neutrals: Highway Hustler, Warband Recruiter and Equipment Charger. The Neutral roster is complete.',
        details: [
          'Highway Hustler (Tier 2, 2/3): Equip Whiplass-o (2), steal the highest-Tier minion in the Shop. A gilded Hustler steals two.',
          'Warband Recruiter (Tier 4, 4/5): Rally, summon a random Rally minion and get a copy of it. Works in combat and when a Rally is triggered in the shop.',
          'Equipment Charger (Tier 4, 6/2): Start of Turn, gain an Equipment charge for the turn. Golden gives two.',
        ],
      },
    ],
  },
  {
    date: '2026-09-09',
    label: 'Set 3 Neutrals II',
    changes: [
      {
        category: 'New Card',
        text: 'Two more Set 3 Neutrals, each with a new kind of free hand spell: Defender hands out Tower Shields, Inspector Pell investigates for Clues.',
        details: [
          'Defender (Tier 2, 2/2): Shout, get 2 Tower Shields. A Tower Shield is a free spell: give a friendly minion +2/+1 and Taunt.',
          'Inspector Pell (Tier 3, 2/5): Equip Magnifying Glass (1), get 2 Clues. A Clue is a free spell: give a friendly minion +1/+1, then every Clue after it gives +1/+1 more.',
          'Tower Shields and Clues count as spells you cast, but they are not Shop spells: nothing copies them, and they take no spell power. The Set 3 Yazzus repeats them, as it does every targeted spell.',
        ],
      },
    ],
  },
  {
    date: '2026-09-09',
    label: 'Set 3 Neutrals I',
    changes: [
      {
        category: 'New Card',
        text: 'The first of Set 3\'s Neutrals: Splitboon Adept, a Set 3 Yazzus, and Blaster returns from the archive, with fifteen returning Neutrals.',
        details: [
          'Splitboon Adept (Tier 3, 3/4): Choose One, give a friendly minion +6/+6, or give adjacent minions +3/+3.',
          "Yazzus (Set 3 only, Tier 6, 4/8): your targeted spells cast an additional time. That now includes Rubies. Set 2's Yazzus is unchanged.",
          'Blaster (Tier 4, 5/3) is back in Set 3: Taunt. Echo, deal 3 damage to all minions.',
          'Returning in Set 3: Cheap Date, Coppercoat Spellsword, Venom, Arena Heckler, Tauntbreaker, Wayfinder, Bellringer Voss, Black Belt Brian, Jensen & Fi, Sylus, Drakko, Chronos, Steward of Spells, Paragon, Mysterious Joker and Salvatore McKlusky.',
        ],
      },
      {
        category: 'Card Change',
        text: 'Sylus the Reaper and Drakko the Drummer are now simply Sylus and Drakko, in every set.',
      },
    ],
  },
  {
    date: '2026-09-09',
    label: 'Prismatic Pick',
    changes: [
      {
        category: 'Card Change',
        text: 'Prismatic Pick\'s first option now lets you Discover a Choose One card instead of handing you a random one.',
        details: [
          "Prismatic Pick (Prismpick Artificer's Equipment): Choose One, Discover a Choose One card, or your next Choose One card this turn gains both effects. A gilded Pick opens the Discover twice.",
        ],
      },
    ],
  },
  {
    date: '2026-09-09',
    label: 'Set 3 Undead',
    changes: [
      {
        category: 'New Card',
        text: 'Eleven new Undead join Set 3, alongside eleven returning Undead.',
        details: [
          'Rising Pup (Tier 1): Taunt, Rise.',
          'Noggin (Tier 2): Rise. Echo, a random friendly Undead gets +2/+2.',
          'Robinson (Tier 3): Equip Coffin Flop (2), Discover an Undead minion.',
          'Adeptus (Tier 3): Echo, your Shop spells get +1 Attack.',
          'EMS (Tier 4): Equip Deathfibrillator (2), give a target Undead Rise, then destroy it.',
          'Cage Breaker (Tier 4): Shout, destroy a friendly Undead to Discover an Undead.',
          'Revenant (Tier 5): after a friendly minion Rises, gains Ward and +7/+7.',
          'Rising Tide (Tier 5): when a friendly minion Rises, your minions on board and in hand get +4/+5.',
          'Squatimus (Tier 5): whenever a summoned minion does not fit, your minions get +2/+2 permanently.',
          'Warden Rodrick (Tier 5): Echo, summon a Spear Warden.',
          'Soul-Lantern Hierophant (Tier 6): Avenge (3), cast Lantern of Souls.',
          'Returning from Set 1: Deathswarmer, Spear Warden, Footman Captain, Mumi, Pillager, Soulsman, Deathsayer, Professor Greg, Sergey, Forsaken Mage and Anubis, Last Gate.',
        ],
      },
      { category: 'Card Change', text: 'Deathswarmer is now a 0/3. Mumi moves to Tier 3 as a 5/2. Sergeant is renamed Sergey with new art. Anubis is now Anubis, Last Gate.' },
      { category: 'Card Change', text: 'Rise now has watchers in both phases: a minion that Rises in the shop triggers Revenant and Rising Tide, and those gains are permanent.' },
      { category: 'Card Change', text: 'Fixed: destroying a minion in the shop no longer fires the Echoes of your OTHER minions (a Footman Captain beside the victim was summoning a Footman).' },
      { category: 'UI / Info', text: 'A minion that Rises in the shop now plays out in beats: the keyword flash, the full death, then the reborn re-form on its return.' },
      { category: 'Card Change', text: 'A risen minion is the card as printed: improvements it had grown (the Echo of Sergey) reset, and it comes back wearing your Auras (Spear Warden, Undead Aura).' },
      { category: 'Card Change', text: 'Rising Tide is now Undead / Spirit. Spirit and Celestial are Set 3 tribes.' },
      { category: 'Card Change', text: 'A minion with Rise keeps its slot while it dies: its Echo fires first, and on a full board an Echo summon overflows instead of taking that slot. The minion comes back.' },
    ],
  },
  {
    date: '2026-09-09',
    label: 'Kobold tweaks',
    changes: [
      { category: 'Card Change', text: 'Gem Bus has been retired from Set 3.' },
      { category: 'Card Change', text: 'Splitpick Apprentice moves to Tier 3 as a 5/3 (was Tier 2, 2/3).' },
    ],
  },
  {
    date: '2026-09-09',
    label: 'Set 3 Dwarves',
    changes: [
      {
        category: 'New Card',
        text: 'Eight new Dwarves join Set 3, alongside fourteen returning Dwarves and the Dwarven Ales.',
        details: [
          'Shift Broker (Tier 1): when you sell a minion, gains +1 Attack.',
          'Striker (Tier 2): End of Turn, gives its neighbours +1 Attack for each card you played this turn.',
          "Pourman (Tier 2): Equip Pourman's Keg (1), cast a random Dwarven Ale.",
          'Hank Pepe (Tier 3): when you play a Dwarf, three other Dwarves get +1/+1.',
          'Tromboneer (Tier 4): Echo, gain 3 Gold next turn, on top of the usual cap.',
          'Kneel (Tier 4): when a Dwarf gains Attack, gains +2 Health. Works in the shop and in combat.',
          "Thymes (Tier 6): Equip Thymepiece (3), 30 more seconds on next turn's timer.",
          'Tankerchief (Tier 7): when a Dwarf gains Attack, gains +1/+4.',
          'Returning from Set 2: Paymaster Pimm, Brunni, Coinfire Forewoman, Gangplank, Baby Gastrid, Blade Thrower, Broad-Axe Brakka, Billings, Doubletap Brewer, Edward Keg-hands, Kringle, Mountainbond, Lieutenant Thane and Tapkeeper.',
        ],
      },
      {
        category: 'Card Change',
        text: 'Kringle (and Striker) now repeat their End of Turn once per card you played, as separate triggers.',
        details: ['Each repeat is its own buff, so anything that watches a Dwarf gaining Attack (Kneel, Tankerchief) reacts once per card played rather than once for the whole End of Turn.'],
      },
      {
        category: 'UI / Info',
        text: 'Striker and Kringle show the Attack they will actually hand out this End of Turn as you play cards.',
      },
    ],
  },
  {
    date: '2026-09-09',
    label: 'Rune of Warding keeps its Engrave',
    changes: [
      {
        category: 'Card Change',
        text: "Rune of Warding's tripled Health now carries back to the shop when the warded minion is Engraved.",
        details: ['A Dragon standing beside a Transcendant (or any Engraved minion) keeps the Health the rune gave it at Start of Combat, like every other combat gain. It was tripled for the fight and quietly lost afterwards.'],
      },
    ],
  },
  {
    date: '2026-09-09',
    label: 'Bug Board round 2',
    changes: [
      { category: 'Hero Change', text: "Kindness's targeted Gifts now do what they say.", details: ["Unbridled Might (+2 Attack, then double), Ironclad Favor (Taunt + double Health), Champion's Regalia (Ward, Critical Strike, Flurry) and Parting Gifts were consuming the card without paying out."] },
      { category: 'Card Change', text: 'A free Rally (Rune of Rallying, Backbeat, Hunting Bell) now triggers Rally watchers like Hawkus, Paragon and Mineral Master.', details: ['It already counted as a Rally for quests; now the cards that react to a Rally react to it too.'] },
      { category: 'Card Change', text: 'Skybound Ascendant now transforms up to Tier 7 on every run, not just with Tier-7 access.', details: ['A Tier-6 neighbour becomes a Tier-7 minion; the card no longer prints "up to Tier 6" outside the Summit.'] },
      { category: 'UI / Info', text: 'Rope Wrangler no longer previews twice the cards it steals during End of Turn.', details: ['Any End-of-Turn effect that casts a spell showed its results doubled in the preview until the turn committed.'] },
    ],
  },
  {
    date: '2026-09-09',
    label: 'Shout FX',
    changes: [
      {
        category: 'UI / Info',
        text: 'When a minion’s Shout fires, it now bursts with a new effect in place of the old medallion pulse. It plays in the shop as it’s played, and in combat when a card re-triggers another minion’s Shout.',
      },
    ],
  },
  {
    date: '2026-09-09',
    label: 'Tribe buff trails',
    changes: [
      {
        category: 'UI / Info',
        text: 'The ribbon that streams from a minion to an ally it buffs is now colored by the buffer’s tribe: green for Beasts, violet for Demons, gold for Dwarves, and so on.',
      },
    ],
  },
  {
    date: '2026-09-08',
    label: 'Ward Break FX',
    changes: [
      {
        category: 'UI / Info',
        text: 'Losing a Ward now bursts with a new effect, a hard spray of shards and a shockwave, whether it is consumed by a hit or lost when its bearer dies. The break sound is unchanged.',
      },
    ],
  },
  {
    date: '2026-09-08',
    label: 'Ward FX',
    changes: [
      {
        category: 'UI / Info',
        text: 'Gaining Ward now has a proper burst, a spray of shards and a ringing shockwave, whenever a minion gains it, in the shop as well as in combat.',
        details: [
          'The new effect plays every way a unit gains Ward mid-combat, and now also in the shop, where a Battlecry, Shout or rune granting Ward to one of your minions previously showed only the dome with no flourish.',
        ],
      },
    ],
  },
  {
    date: '2026-09-04',
    label: 'Effects frame cap',
    changes: [
      {
        category: 'UI / Info',
        text: 'Settings has a new Performance section with an effects frame cap: Display, 60, 120, 144, 240 or 360. It limits combat effects and card motion on high-refresh displays.',
        details: [
          'It caps combat effects and card motion only. The rest of the game still runs at your display’s refresh. To cap the whole game, use your GPU driver’s per-app frame limit.',
          'It cannot raise the rate above the refresh rate of your display, so options above it are shown dimmed and do nothing.',
          'Your choice is remembered between sessions.',
        ],
      },
    ],
  },
  {
    date: '2026-09-03',
    label: 'Standard Bearer',
    changes: [
      {
        category: 'Card Change',
        text: 'Standard Bearer now triggers only when IT attacks, matching its "Rally:" text. It was mistakenly buffing every time any of your Rally minions attacked.',
        details: [
          'Bug fix: Standard Bearer had been acting like Paragon (a board-wide watcher), firing its +3/+3 spread on every friendly Rally, in both the shop and combat.',
          'It is a Rally minion, so its buff still fires each time Standard Bearer swings; it just no longer piggybacks on the Rallies of your other minions. Paragon is unchanged.',
        ],
      },
    ],
  },
  {
    date: '2026-09-03',
    changes: [
      {
        category: 'UI / Info',
        text: 'The golden burst behind combat damage numbers is back in the downloadable and itch.io builds. It had been missing there since it shipped, while showing correctly in development.',
      },
    ],
  },
  {
    date: '2026-09-02',
    label: 'New Buff FX',
    changes: [
      {
        category: 'UI / Info',
        text: 'The first three of the new buff effects are in: a gold shard-burst when a minion buffs itself, a ribbon trail when one minion buffs another, and a violet spray when your whole shop gets buffed.',
        details: [
          'Self-buff: when a minion buffs itself, in the shop, on a combat buff wave, or as it grows while being attacked, it bursts with a spray of gold shards and a ringing shockwave, right on the minion.',
          'Buff trail: when a minion buffs another, a ribbon now streams from the buffer to the minion it pumped, with a flick of shards at the source, and the stat count-up lands as the ribbon arrives.',
          'Shop buff: when the whole tavern is buffed (Demon Horse and friends), a wide violet spray now sweeps up across the shop. If you earn it mid-combat, it blooms on the swing alongside the +A/+H number.',
          'Cards with their own authored effect (Dragonflame, Karwind, Broodfire) keep it; the trail only plays where no card-specific effect exists.',
          'Buffs with no on-board source (spells, a fallen Echo, hero powers) and the board-wide tribe-aura wash are still awaiting their new effects.',
        ],
      },
    ],
  },
  {
    date: '2026-09-02',
    label: 'Bot Levels',
    changes: [
      {
        category: 'UI / Info',
        text: 'Practice bots now have ten difficulty levels instead of three, and the top levels field real utility minions.',
        details: [
          'Level 1 is the old Easy, level 3 the old Medium, level 5 the old Hard. Levels 2 and 4 sit between them.',
          'Levels 6–10 go past the old Hard: bigger boards, a faster tier climb, higher starting tiers, and heavier hits.',
          'From level 6, one to three bot minions each round are real cards with effects: Echoes that Ward allies or spray damage, Venomous, Cleave, Rally and more. Higher levels unlock nastier ones.',
          'Those utility minions use the bot board’s stats for that round, so they scale with the game. Venom stays at 1 Attack.',
          'Your saved Practice setup carries over: Easy, Medium and Hard become levels 1, 3 and 5.',
        ],
      },
    ],
  },
  {
    date: '2026-09-02',
    label: 'Buff FX',
    changes: [
      {
        category: 'UI / Info',
        text: 'The old buff flourishes are being retired to make way for new ones. When a minion is buffed in the shop or in combat, the stat numbers still tick up but the generic ribbon/glow no longer plays. New effects are on the way.',
        details: [
          'Removed the shop/combat “tendril” that reached from a buffer to the minion it pumped, and the “rain-down” version for buffs with no on-board source.',
          'Removed the gold self-buff burst a minion showed when it buffed itself, and the tribe-aura wave that washed across your board.',
          'Card-specific effects are untouched. Dragonflame, Karwind’s flame ring, Broodfire, the tavern Shout burst, and rune/quest reward ribbons all still play.',
          'The stat-badge count-up, the shop-buff number float, and every sound are unchanged.',
        ],
      },
    ],
  },
  {
    date: '2026-09-01',
    label: 'Hero Select',
    changes: [
      {
        category: 'UI / Info',
        text: 'Hero select now shows each hero power’s Gold cost beside its name: (Cost: X), (Cost: Free), or (Passive).',
      },
      {
        category: 'UI / Info',
        text: 'A Main Menu button in the top-left of hero select takes you back to the title.',
      },
    ],
  },
  {
    date: '2026-09-01',
    label: 'Reliquary Beats',
    changes: [
      {
        category: 'UI / Info',
        text: 'Rune of the Reliquary and Rune of the Crucible Choir now play each triggered minion as its own End-of-Turn beat.',
        details: [
          'Each Echo the Reliquary fires gets its own beat, left to right: the minion pulses, the Echo skull plays on it, and its summons or buffs land on that beat.',
          'The Crucible Choir plays its Shout minion, then its Echo minion, the same way.',
          'An Echo that does nothing in the shop no longer claims a beat, and the rune badge bursts once at the end instead of twice.',
        ],
      },
    ],
  },
  {
    date: '2026-09-01',
    label: 'Repeated Shouts',
    changes: [
      {
        category: 'UI / Info',
        text: 'Shouts re-triggered in combat now play out one fire at a time. A Drakko-repeated Shout reads as three, not one.',
        details: [
          'When a minion re-triggers a Shout mid-fight (Dawnclaw, Ryme, Thunderous Sovereign, Chorus Drake, Embercrest and friends), each fire gets its own beat: the re-triggering minion pulses, the owner of the Shout blooms per fire, and each fire floats its own number in turn.',
          'An attack whose swing re-fires Shouts parks at the top of its wind-up while each fire plays out, one at a time with stats rolling per fire, then strikes.',
          'The Combat Log names each fire (Dawnclaw triggers the Shout of Wardkeeper), and the Procs tab lists them under a new Shout section with their count.',
        ],
      },
    ],
  },
  {
    date: '2026-09-01',
    label: 'Frosted Glass',
    changes: [
      {
        category: 'UI / Info',
        text: 'Discover and Choose One now open over the same blurred, darkened backdrop as the hero-select screen.',
      },
    ],
  },
  {
    date: '2026-09-01',
    label: 'Rubetta',
    changes: [
      {
        category: 'UI / Info',
        text: 'A Choose One minion now waits on the board while you pick, and glides back to your hand if you cancel.',
        details: [
          'Nothing is committed until you choose. Cancelling is still completely free.',
        ],
      },
      {
        category: 'UI / Info',
        text: 'A minion buffed as it attacks now shows its new stats BEFORE the swing goes out, instead of mid-lunge.',
      },
      {
        category: 'UI / Info',
        text: 'Everything a minion sets off by attacking now plays while it is still reared back, before the swing lands.',
        details: [
          'Spells cast from an attack, such as Flamebeat Drake and Warflame, resolve in the wind-up with their effects and stats.',
          'Rubies cast on an attack (Boulderdash) and hero-power grants (Gorun) now land their numbers there too.',
          'Previously the lunge finished first and the consequences played afterwards.',
        ],
      },
      {
        category: 'Hero Change',
        text: 'Gorun’s Blade Mastery now has its own effect and sound as it sharpens each swing.',
      },
      {
        category: 'Card Change',
        text: 'Everything a minion sets off by attacking now fully resolves before its own attack lands.',
        details: [
          'A Rally that triggers an Echo, such as Echohorn or Deathsayer, plays out completely first, summons and all.',
          'A summoned minion that attacks immediately resolves its whole attack before the next one is summoned.',
          'If the attacker’s target dies to all that, the attacker simply settles: no damage dealt, and none taken back.',
        ],
      },
      {
        category: 'UI / Info',
        text: 'Each minion’s attack now gets its own moment, instead of sharing one with an attack that just happened.',
      },
      {
        category: 'UI / Info',
        text: 'Broodfire now sets its Dragons alight with its own effect and sound as it buffs them.',
      },
      {
        category: 'UI / Info',
        text: 'Dragonflame now plays its own effect and sound on every cast, wherever it was cast from.',
        details: [
          'From your hand, and from any minion that casts it mid-combat.',
          'A multicast Dragonflame shows one burst per cast, not one per play.',
        ],
      },
      {
        category: 'Card Change',
        text: 'Standard Bearer now gives a minion of each type +3/+3 for the fight, instead of +2/+3 permanently.',
      },
      {
        category: 'Card Change',
        text: 'Mirrorwing and Reflector now re-cast the whole spell, so they double your multicast instead of adding one cast.',
        details: [
          'A spell that was already casting 4 times now casts 8 on a Mirrorwing.',
          'Rune of Shared Reflection spreads full casts too.',
        ],
      },
      {
        category: 'Rune Change',
        text: 'Rune of Hoardflame and Rune of Dragon Breath now hand you their spell the moment you take them.',
        details: [
          'Previously the first copy did not arrive until the following turn.',
          'The every-turn repeat is unchanged.',
        ],
      },
      {
        category: 'New Card',
        text: "Kaura L'roft (Kobold, Tier 4): Equip Dueling Rubetta's, improve your Rubies, then cast a Ruby on your left and right-most Kobold.",
      },
      {
        category: 'Card Change',
        text: 'Porkbelly settles when his Gemheart Golem kills the target, even if that target Rises.',
      },
    ],
  },
  {
    date: '2026-09-01',
    label: 'Dealer',
    changes: [
      {
        category: 'Card Change',
        text: 'Dealer starts watching for your first Choose One the moment she is played, instead of waiting for the next turn.',
        details: [
          'Each Dealer keeps her OWN tracker, so one bought after this turn’s first Choose One still pays for the next one.',
          'Two Dealers on board at the start of a turn is still one card’s worth. They were both waiting for the same first card.',
          'A Gilded Dealer carries two of her own, as her text says.',
        ],
      },
      {
        category: 'New Card',
        text: 'Runespark Channeler (Kobold, Tier 5): whenever you cast a Shop spell, cast a Ruby on adjacent minions.',
      },
      {
        category: 'UI / Info',
        text: 'The (Both) marker now plays on the inspect view too, when the card you are reading will take both halves.',
      },
    ],
  },
  {
    date: '2026-09-01',
    label: 'Rune Arrival',
    changes: [
      {
        category: 'Card Change',
        text: 'Apples now prints what it will actually give: its "2 random friendly minions" half folds in your Spell Power.',
        details: [
          'Only the printed number was wrong. The buff itself always included Spell Power.',
          'Its other half (buffing this Shop) is flat by design and still prints its plain value.',
          'Apples also counts as a stat spell now, so Rune of Thrift discounts it.',
        ],
      },
      {
        category: 'UI / Info',
        text: 'Hovering a card that names a specific Ruby no longer also previews the plain Ruby, and a wide preview is centred instead of jammed against the left edge.',
      },
      {
        category: 'UI / Info',
        text: 'Stat numbers no longer dip to a wrong value (and flash red) while a Ruby lands in combat.',
        details: [
          'A minion buffed mid-fight could briefly show LESS than it had before the buff, then correct itself.',
          'The stats themselves were always right. Only the number on the badge was wrong, and only for a moment.',
        ],
      },
      {
        category: 'UI / Info',
        text: 'Picking a rune no longer blinks on its way to the centre, and the rune you chose now arrives in your tray with an effect of its own.',
        details: [
          'The chosen rune moves in one continuous motion. It used to flicker for a frame as the ceremony took over.',
          'Its badge stays empty while the ceremony plays, then the artwork pops in as the board comes back.',
          'The arrival has its own sound.',
        ],
      },
    ],
  },
  {
    date: '2026-08-31',
    label: 'Rune Sockets',
    changes: [
      {
        category: 'UI / Info',
        text: "During a fight, the opponent's runes now sit in three ornate sockets beside their portrait, always visible, so you can see how many runes they're carrying at a glance.",
        details: [
          'The three sockets always show; a rune the opponent owns fills its socket.',
        ],
      },
    ],
  },
  {
    date: '2026-08-31',
    label: 'Scouting Report',
    changes: [
      {
        category: 'UI / Info',
        text: 'Right-click OR left-click an opponent in the rail to open a bigger, reworked scouting report. Click away to close it.',
        details: [
          'It now shows their shop tier, gilded units (triples), the dominant tribe on their board with a count, three rune sockets, and a titled fight-history table.',
          'Each past fight shows the round, the foe’s portrait, WON/LOST, and the damage. Hover a rune to read what it does.',
          'Clicking a different opponent switches straight to their report; clicking anywhere outside closes it.',
        ],
      },
    ],
  },
  {
    date: '2026-08-31',
    label: 'End of Turn',
    changes: [
      {
        category: 'UI / Info',
        text: 'Cards granted at End of Turn no longer flash at double their number before settling.',
        details: [
          'Most visible on Rope Wrangler, which can hand you five cards at once.',
          'Only the display was affected. You always received the right cards.',        ],
      },
    ],
  },
  {
    date: '2026-08-31',
    label: 'Reflector',
    changes: [
      {
        category: 'Card Change',
        text: "Reflector's text now says it reacts to Rubies as well as Spells, which it always did.",
        details: [
          'Spells and Rubies share its once-per-turn trigger, so a Ruby landing first uses it up. That was invisible from a card that only mentioned Spells.',
          'No change to how the card behaves.',
        ],
      },
    ],
  },
  {
    date: '2026-08-31',
    label: 'Shop Capacity',
    changes: [
      {
        category: 'Rune Change',
        text: 'Rune of Open Enrollment no longer adds an extra Shop slot. It replaces an offer instead, so the Shop keeps its normal size.',
        details: [
          'It used to leave 7 minions in a 6-slot Shop.',
          'When the Shop happens to be short a card, it still simply fills the empty slot.',
          'The replaced minion goes back to the shared pool, exactly like a Refresh.',
        ],
      },
      {
        category: 'UI / Info',
        text: "Coppercoat Spellsword's art is re-cropped.",
      },
    ],
  },
  {
    date: '2026-08-31',
    label: 'Save & Quit',
    changes: [
      {
        category: 'UI / Info',
        text: 'Saving and quitting mid-turn now returns you to the turn with the time you left it on, instead of restarting the round timer.',
        details: [
          'Quitting with 8 seconds left and pressing Continue used to hand back a full turn.',
          'The time was always saved correctly. It was being overwritten on the way back in.',        ],
      },
    ],
  },
  {
    date: '2026-08-31',
    label: 'Gemheart',
    changes: [
      {
        category: 'UI / Info',
        text: 'The Gemheart Golem has new artwork.',
        details: [
          'Every card that summons one shows the new picture. It is a single shared portrait, so the Golem looks the same wherever it comes from.',
          'Nothing about the Golem itself changed: same body, same stats, same Rubies.',
        ],
      },
    ],
  },
  {
    date: '2026-08-30',
    label: 'Forge Facelift',
    changes: [
      {
        category: 'UI / Info',
        text: 'The Runeforge got a visual overhaul: an illustrated backdrop, a gold title plaque, and bigger, cleaner rune tablets.',
        details: [
          'A new forge illustration glows behind the panel.',
          'The stone banner became a gold plaque with a larger title; the Gold pill and rune tablets were resized and reseated.',
          'The anvil icon and the sigil medallion were retired from the forge for a cleaner read (the Compendium keeps the medallion).',        ],
      },
    ],
  },
  {
    date: '2026-08-30',
    label: 'The Pulse',
    changes: [
      {
        category: 'Hero Change',
        text: "The Auctioneer's Pulse now has its own effect and sound, playing on the minion you call back.",
        details: [
          'A burst and a double shockwave land on the target minion, replacing the generic targeting spark.',
          'It comes with its own sound cue.',
          'No change to what the Pulse does. It still triggers a friendly minion’s Shout.',
        ],
      },
    ],
  },
  {
    date: '2026-08-30',
    label: 'Replay Rail',
    changes: [
      {
        category: 'UI / Info',
        text: 'The round metrics beside a replay are simply always shown. The collapse arrow that slid away from your cursor is gone.',
        details: [
          'The arrow was pinned to the edge of the panel it opened, so pressing it moved it out from under the pointer.',
          'Gold, Acts and Tier per round are always visible now.',
        ],
      },
    ],
  },
  {
    date: '2026-08-30',
    label: 'Replay Scrubbing',
    changes: [
      {
        category: 'UI / Info',
        text: 'The replay bar now covers ONE round at a time, so you can pick a round and scrub through it properly.',
        details: [
          'The timer shows your position within the round you are watching, not the whole game. On a long replay a single round used to be about forty pixels of bar.',
          'Pick the round from the rail on the left; the bar then belongs entirely to that round.',
          'Playback speed is a button with a menu (0.5x up to 5x) instead of a slider you had to drag onto the value you wanted.',
          'The whole bar is chunkier, and the scrub track is easier to grab.',
        ],
      },
    ],
  },
  {
    date: '2026-08-30',
    label: 'Watching & Rolling',
    changes: [
      {
        category: 'UI / Info',
        text: 'Replays are for watching, so the board controls no longer respond to clicks. Card art no longer slides sideways when you roll.',
        details: [
          'End Turn, Freeze, Refresh and the rest are inert while a replay plays. They never did anything, but they used to press and play their sound, which read as broken.',
          'Cards can still be hovered and read while you watch.',
          'Shop cards used to grow slightly as they arrived, which dragged their art a few pixels to the left, most visibly on cards whose art sits off-centre. They now rise and fade without growing.',
        ],
      },
    ],
  },
  {
    date: '2026-08-30',
    label: 'Replay Controls',
    changes: [
      {
        category: 'UI / Info',
        text: 'The replay bar can be dragged to scrub, shows how far through you are, and takes the keyboard. Playback speed now carries the shop timer with it.',
        details: [
          'Drag the bar to scrub, instead of clicking one spot at a time, with a handle showing where you are.',
          'An elapsed / total time readout sits beside it.',
          'Space plays and pauses, the arrow keys step a frame at a time, Home and End jump to either end.',
          'The shop countdown used to tick at normal speed whatever the playback speed, so a fast replay disagreed with its own clock. It now runs at the speed you are watching.',
        ],
      },
    ],
  },
  {
    date: '2026-08-30',
    label: 'Replay Ceremony',
    changes: [
      {
        category: 'UI / Info',
        text: 'Watching a replay now shows the rune lock-in ceremony, the same as playing it does.',
        details: [
          'When a recorded player buys a rune, the chosen rune slides to centre, the gold frame clamps shut and the flash goes off. It used to just vanish from the forge.',
          'Replays recorded before today can still show it, unless the purchase was a duplicate rune, in which case the recording cannot say which one was picked and the ceremony is skipped.',
        ],
      },
    ],
  },
  {
    date: '2026-08-30',
    label: 'Clean Entry',
    changes: [
      {
        category: 'UI / Info',
        text: 'Choosing a mode no longer flashes a game board on the way to the menu. Nothing is running until you actually start a run.',
        details: [
          'Pressing Practice showed the board for an instant before the options screen appeared. It no longer does, and the same gap on Play, Rift and Lobby is closed too.',
          'The board is not merely hidden before a run now. It is not running at all.',
        ],
      },
    ],
  },
  {
    date: '2026-08-30',
    label: 'Practice Bots',
    changes: [
      {
        category: 'UI / Info',
        text: 'Practice bots now sit down with the same Resolve and Armor you do, instead of starting on little over half your health.',
        details: [
          'A bot table used to open at 18/17/16/15/14/13/12 against your 30, visible on the round-1 standings. Every seat now starts level with you.',
          'Bot games have not got longer: the bots hit each other harder to make up for the extra health, so a dominant run still finishes on the same clock.',
          'How hard bots hit YOU is unchanged on all three difficulties.',
        ],
      },
    ],
  },
  {
    date: '2026-08-30',
    label: 'Foe Intel',
    changes: [
      {
        category: 'UI / Info',
        text: "Click your opponent's portrait in combat to see their run-wide Buffs Panel, the same window your own portrait opens.",
        details: [
          'Hovering the foe portrait shows the same prompt yours does; the panel drops down below their health pill, with an arrow cue underneath it.',
          "It lists the buffs their board actually brings to the fight: Spell power, Ruby power, and their tribe auras, read from the run that built it.",
          'Opponents with no run-wide buffs show no arrow or prompt, exactly like your own portrait.',
        ],
      },
    ],
  },
  {
    date: '2026-08-30',
    label: 'Gem Portal',
    changes: [
      {
        category: 'UI / Info',
        text: 'The combat curtain now erupts from the End Turn gem. The gem charges up, blooms the blue over the whole scene, then a sweep reveals the arena.',
        details: [
          'A short charge-up on the gem (motes spiraling in, a swelling flare) telegraphs the transition before it fires.',
          'The cover is a circle blooming out of the gem, trailed by stardust and swirling wisps along its edge; the reveal is a clean linear sweep (right-to-left into combat, left-to-right back to shop).',
          'Returning to shop, the End Combat gem drinks the scene back in. Motes and sparks stream into it as the blue closes.',
          'Smoother than before on big screens: the glow front was rebuilt to stay off the main thread.',
        ],
      },
    ],
  },
  {
    date: '2026-08-29',
    label: 'Runeforge',
    changes: [
      {
        category: 'UI / Info',
        text: 'Locking in a rune now gets a short ceremony. The others clear away and your pick takes centre stage.',
        details: [
          'A gold frame closes onto your rune and a flash bursts out as it locks.',
          'The rune is yours the instant you click; the flourish plays over the top and needs no input.',
          'About a second and a half, then straight back to the board.',
        ],
      },
    ],
  },
  {
    date: '2026-08-29',
    label: 'Equipment',
    changes: [
      {
        category: 'UI / Info',
        text: 'Gilding an Equip minion now announces the upgrade. The equip flourish plays again.',
        details: [
          'Playing a Gilded copy over the plain version upgrades what is in your slot, so it gets the same feedback a brand-new Equipment does.',
          'A second Gilded copy after that is silent. The slot is already at its best.',
        ],
      },
      {
        category: 'UI / Info',
        text: 'Your Equipment puffs out when you spend your last use for the turn.',
        details: [
          'Only when you actually run out. Spending one of two uses leaves the other and stays quiet.',
          'If something grants you an extra use, spending that one puffs again.',
        ],
      },
    ],
  },
  {
    date: '2026-08-29',
    label: 'Kringle',
    changes: [
      {
        category: 'UI / Info',
        text: "Kringle's End of Turn buff now lands one hit per card you played, instead of a single lump.",
        details: [
          'Same stats as before. Five cards played is still +5/+10, it just arrives as five hits in a row.',
          'The more you played, the bigger the flurry.',
        ],
      },
    ],
  },
  {
    date: '2026-08-29',
    label: 'Combat Controls',
    changes: [
      { category: 'UI / Info', text: 'The combat controls got a fresh look and tighter placement, and they now hold their spot on the board at any window size. That covers the Summary and End Combat pills and the Skip button.' },
    ],
  },
  {
    date: '2026-08-29',
    label: 'Fixes',
    changes: [
      {
        category: 'UI / Info',
        text: 'A sheen sweeps the Equipment art whenever the slot shows a new one.',
        details: [
          'It plays on the first Equipment you get, and whenever you swap the slot to a different one.',
          'It stays quiet when you play another copy of an Equip minion you already have. The slot is showing the same thing.',
        ],
      },
      {
        category: 'Card Change',
        text: 'Cards that arrive in your hand DURING a fight now trigger the minions that watch for them.',
        details: [
          'Gangplank and Kegheart Dwarf react the moment a card reaches your hand mid-combat, so the payout can help win the fight that earned it. Before, the stats only showed up back in the shop.',
          'A Ruby minted in combat counts as a card arriving, the same as it does in the shop.',
        ],
      },
      {
        category: 'Hero Change',
        text: "Sable: a Soulbound minion that gets tripled no longer breaks the bond.",
        details: [
          'The bond follows the minion into its golden copy, the way its buffs and progress already do.',
          'If BOTH bound minions merge into the same golden, the bond ends for the turn rather than binding that minion to itself.',
        ],
      },
    ],
  },
  {
    date: '2026-08-29',
    label: 'Combat Curtain',
    changes: [
      {
        category: 'UI / Info',
        text: 'Combat entrances got a full makeover: a blue curtain sweeps the board, announces NOW FACING with your opponent, and reveals both armies standing ready, then sweeps the other way back to the shop.',
        details: [
          "Ending your turn sweeps a dark-blue curtain across the whole board; your opponent's portrait and name are announced on it before the arena is revealed.",
          'Both armies are revealed already in position and hold a beat before the first attack.',
          'Returning to the shop plays the curtain in the opposite direction, with everything back in place when it clears.',
          "The fight screen is decluttered: the shop's Tier stone, Refresh crystal, Freeze gem and Gold coin step aside during combat and return with the shop.",
          "Your opponent's hero power now shows beside their portrait during the fight. Hover it to read what it does.",
          'Fights that end your run (or win you the lobby) skip the curtain and go straight to the results.',
        ],
      },
    ],
  },
  {
    date: '2026-08-28',
    label: 'Equipment',
    changes: [
      {
        category: 'New Card',
        text: 'EQUIPMENT: some minions hand you a tool you can use every shop phase, for as long as they live.',
        details: [
          'An Equip minion grants its Equipment the moment you play it. The Equipment appears in its own slot beside your hero power.',
          'Using one costs Gold and spends your Equipment use for the turn. You get one use per turn, shared across every Equipment you hold.',
          'Your hero power is untouched: the two are spent separately, so holding an Equipment never costs you your power.',
          'Lose the minion and you lose its Equipment. Keep it and the Equipment comes back every turn.',
          'A Gilded Equip minion upgrades its Equipment, and holding two sources of the same one keeps the better version.',
        ],
      },
      {
        category: 'New Card',
        text: 'Alchemist Frank is a Tier 1 Neutral who equips the Bloodpot: give a friendly minion +3/+3.',
      },
      {
        category: 'New Card',
        text: 'Titan Sculptor is a Tier 6 Neutral who equips the Titan Hammer: SET a friendly minion to 50/50.',
        details: [
          'It sets, rather than adds. A smaller minion is raised to 50/50, and a bigger one is brought down to it.',
          'Gilded, the Hammer sets 100/100.',
        ],
      },
      {
        category: 'UI / Info',
        text: 'The Equipment slot fades in and out instead of popping.',
      },
      {
        category: 'UI / Info',
        text: 'The equip flourish now only plays when you actually equip something new.',
        details: [
          'Playing a second copy of an Equip minion is silent. You already hold that Equipment.',
          'The minion still counts: it keeps the Equipment alive, and a Gilded copy still upgrades it.',
        ],
      },
      {
        category: 'UI / Info',
        text: 'Holding more than one Equipment? Hover the slot and the others slide out to the right. Click one to switch.',
        details: [
          'Switching is free: it costs no Gold and no use, so you can change your mind before committing.',
          'Each option shows its icon, its name and what it costs right now.',
        ],
      },
    ],
  },
  {
    date: '2026-08-28',
    label: 'Opponents Rail',
    changes: [
      {
        category: 'UI / Info',
        text: 'The opponents rail down the right edge got a full visual pass: a gilded backplate frame, warmer plaques, each opponent’s name on its own banner, and a shield icon on armor.',
        details: [
          'The next opponent you fight is lit brighter in place. A ring, glow and accent bar mark it, replacing the old “Next” label.',
          'A seat’s health now reads larger and bold, and sits in the same spot whether or not the seat has armor.',
          'The scouting card you open by hovering an opponent always stays fully on screen instead of being clipped at the edge.',
        ],
      },
    ],
  },
  {
    date: '2026-08-28',
    label: 'Multipliers',
    changes: [
      {
        category: 'Card Change',
        text: 'Trigger multipliers now say exactly how they combine. "Twice" multiplies, "additional" adds up.',
        details: [
          'Drakko the Drummer: "Your Shouts trigger twice." Two Drakkos are still twice. A multiplier does not stack with itself.',
          'Chronos: "Your End of Turn effects trigger twice." Same rule.',
          'Sylus the Reaper: "Your Echoes trigger 1 additional time." Every copy counts, so two Sylus mean three Echoes.',
          'Zyff and Uron read "an additional time", so they stack too. Two Urons now mean three triggers, where before the second did nothing.',
          'The two kinds combine. Drakko + Zyff means a Shout triggers FOUR times: Zyff adds a trigger, then Drakko doubles the total.',
          'Gilded Drakko and Chronos now read "three times".',
        ],
      },
      {
        category: 'UI / Info',
        text: 'Deaths and Echoes in the shop now animate, the same way they do in combat.',
        details: [
          'A minion destroyed in the shop plays the death dissolve; one that is rising plays its return instead.',
          'The Echo burst plays anytime an Echo triggers in the shop, from a destroy, a rune, or any card that triggers one.',
        ],
      },
      {
        category: 'Card Change',
        text: 'Minions summoned by a shop Echo now arrive where the minion died, and can complete triples.',
        details: [
          "A destroyed minion's summons used to appear at the far right of your board instead of in its place.",
          'Funeral on Loan never checked for triples, so three of a kind could sit uncombined. It does now.',
        ],
      },
    ],
  },
  {
    date: '2026-08-28',
    label: 'Destroy & Rise',
    changes: [
      {
        category: 'Card Change',
        text: 'Rise now works in the shop. A minion destroyed there comes back, just as it would in combat.',
        details: [
          'Graverobber eating a minion with Rise no longer kills it outright: it returns at its base Attack with 1 Health, its Rise spent.',
          'Its Echo still resolves first, so if the Echo fills your board there is no room and the Rise is lost. It is the same rule combat uses.',
          'Funeral on Loan follows the same rule: discover a minion with Rise, play it this turn, and after its Echo it rises and stays on your board.',
        ],
      },
      {
        category: 'UI / Info',
        text: 'Destroying a minion in the shop now plays out instead of happening instantly.',
        details: [
          'The minion shows its death, and its Echo animation if it has one, on its own beat. They used to resolve in a single frame with nothing to see.',
          'Funeral on Loan now visibly places the borrowed minion on your board before its Echo and death play.',
        ],
      },
    ],
  },
  {
    date: '2026-08-28',
    label: 'Choose One Flow',
    changes: [
      {
        category: 'UI / Info',
        text: 'Choose One now asks for your choice BEFORE you pick a target, clicking away cancels and returns the card to your hand, and a card that already does both effects says (Both) and skips the prompt.',
        details: [
          'Play the card, pick your side, then aim. The old flow made you aim first, which meant choosing after you had already committed.',
          'Nothing happens until the choice is settled: a Choose One minion waits in your hand until you pick, so it is never left on the board mid-decision.',
          'Click away from the options (or away while aiming) to cancel. The card comes straight back to your hand with nothing spent and nothing triggered.',
          "When every branch is already switched on, the card no longer asks a question with one answer. That covers a Gilded Orivax, or Facetwright's Choice and Veinbreaker with their runes. It reads (Both) and prints both effects, wherever you see it.",
        ],
      },
    ],
  },
  {
    date: '2026-08-28',
    label: 'Choose One',
    changes: [
      {
        category: 'Card Change',
        text: 'Apples now offers a board buff instead of a second shop buff, and its shop half got bigger.',
        details: [
          'Choose One: give this shop +2/+4 (was +1/+3), or give 2 random friendly minions +1/+1.',
          'The old "next shop +2/+4" option is gone. Both halves used to buff shops, which left the card with nothing to offer a board you already own.',
        ],
      },
      {
        category: 'Card Change',
        text: 'Kringle now pays both ends of your Dwarf line.',
        details: [
          'End of Turn: gives your left AND right-most Dwarves +1/+2 for each card you played this turn (was the left-most Dwarf only).',
          'With a single Dwarf on board, that Dwarf is both ends and is buffed once.',
        ],
      },
      {
        category: 'Card Change',
        text: 'Chef Gary Toast hits harder: +4/+4 per Dwarf played, up from +3/+3.',
      },
      {
        category: 'UI / Info',
        text: 'Six more Choose One cards now wear art for the branch you picked.',
        details: [
          "Runic Beetle, Veinbreaker, Coppercoat Spellsword, Crest of the Climb, Facetwright's Choice and Field Maneuvers each show their own second-option art once resolved.",
        ],
      },
    ],
  },
  {
    date: '2026-08-28',
    label: 'Ruby Wording',
    changes: [
      {
        category: 'UI / Info',
        text: 'Rubies are now CAST, never "played". Every card and rune that hands out a Ruby says so the same way.',
        details: [
          '"Play a Ruby" now reads "Cast a Ruby" on 11 Kobold and Dwarf minions, 2 spells and 6 runes.',
          '"Played" now means one thing everywhere: a card leaving your hand. Rune of the Lapidary still reads "after you play 6 cards". That is a card play, not a Ruby.',
          'Wording only. No Ruby, card or rune changed what it does.',
        ],
      },
    ],
  },
  {
    date: '2026-08-28',
    label: 'Rune Fix',
    changes: [
      { category: 'Rune Change', text: 'Rune of Summoning now gives the +2/+2 it promises. It was quietly paying half.', details: [
        'Every Shop spell you cast improves your Imp Aura by +2/+2, exactly as the rune reads.',
        'Rune of Mastery still doubles it, and a second copy still doubles it again.',
      ] },
    ],
  },
  {
    date: '2026-08-28',
    label: 'Auras',
    changes: [
      {
        category: 'UI / Info',
        text: 'Buffs that follow a whole tribe around are now called Auras. They reach your board, your hand, the shop, and copies you pick up later. Same effects, clearer words.',
        details: [
          'A card that used to read "give your Beasts +8/+8 wherever they are" now reads "give your Beast Aura +8/+8".',
          'Eleven cards and runes were re-worded: Kennelmaster, Trophy Stalker, Grim, Armadiyo, Deathswarmer, Forsaken Mage, Lantern of Souls, Attachment Mechanic, Chorus Engine, Rune of Summoning and Rune of the Cinder Ledger.',
          'Quest rewards that grant one of these buffs read the same new way.',
          'Nothing about what they do changed. The numbers, targets and timing are untouched.',
        ],
      },
    ],
  },
  {
    date: '2026-08-28',
    label: 'Focusing on Runes',
    changes: [
      {
        category: 'UI / Info',
        text: 'Quests are out of the game for now while we focus on Runes.',
        details: [
          'No quest turns: turns 5 and 11 are ordinary Shop turns.',
          'The quest picker no longer appears, and no objectives are tracked.',
          'Runes are unaffected. The Runeforge still opens on turn 6, and the Epic Runeforge on turn 9.',
          'A run already in progress keeps the quest it was carrying, and it still completes and pays out.',
        ],
      },
      {
        category: 'Hero Change',
        text: 'Fi and Coran are temporarily out of the roster while they are redesigned.',
        details: [
          'Both are off the hero list in Play and in Practice.',
          'Their powers were built entirely around Quests, so they come back with the redesign.',
          'Neither can turn up through Mimic, the Void or Power Shifter either.',
        ],
      },
      {
        category: 'Card Change',
        text: 'Henchmen are removed for now. No hero offers one.',
      },
    ],
  },
  {
    date: '2026-08-27',
    label: 'Damage Splash',
    changes: [
      { category: 'UI / Info', text: 'Combat damage numbers now punch out on a golden burst that springs in with a bounce, each at a random tilt.' },
    ],
  },
  {
    date: '2026-08-27',
    label: 'Combat Arena',
    changes: [
      {
        category: 'UI / Info',
        text: 'Combat now has its own board. A wipe of light sweeps across the table as the fight begins, and sweeps back when you return to the shop.',
        details: [
          'The shop board was also re-exported from the newest master, so the two boards match exactly.',
          'Returning to the shop plays the wipe in reverse.',
        ],
      },
    ],
  },
  {
    date: '2026-08-27',
    label: 'Bug Board Round 1',
    changes: [
      { category: 'Card Change', text: 'Great Pot now scales with your spell power, and its text shows the value it will actually give.', details: [
        'The +4/+4 it gives one minion of each type now adds your spell power, like every other stat-granting spell.',
        'Its printed number goes green and live once any spell power is up.',
      ] },
      { category: 'UI / Info', text: "Growth's improved value (from Mushy's rune) now shows everywhere, including the popup when hovering Mushy.", details: [
        'The hover popup and the mid-combat hand fly-in previously kept showing the base +1/+1 while the cast paid more.',
      ] },
      { category: 'UI / Info', text: 'The Refresh button now shows the real price of your next roll: a green 0 while Rune of Window Shopping is paying.', details: [
        'Free rolls from the rune also stay clickable when you have no Gold, matching what a roll actually costs.',
      ] },
    ],
  },
  {
    date: '2026-08-27',
    label: 'Opponent Fidelity',
    changes: [
      {
        category: 'Card Change',
        text: "Opponent boards now fight at full fidelity. Spell marks, grafted Echoes, and Ashen Heir's bank all carry into battle.",
        details: [
          'Parting Cry, Closed Casket and Soren’s Reclaim now work on opponent boards too. A served copy of a board fights with the same marks its owner paid for. Reclaim even destroys the exact minion its owner chose.',
          'An Echo gained in the shop (Echo Mimic, Grave Body, and friends) now actually fires when that minion dies in combat, yours and your opponents’.',
          'A copy summoned "without Echo" now stays Echo-less in combat as well, instead of quietly regaining it when the fight starts.',
          'Ashen Heir’s banked Imp stats now ride into battle: an Imp summoned mid-fight collects the bank. The bank itself stays with your Heir between fights.',
        ],
      },
    ],
  },
  {
    date: '2026-08-27',
    label: 'This Turn Rule',
    changes: [
      {
        category: 'Card Change',
        text: "Effects that last \"this turn\" now correctly persist through that turn's combat. A turn runs from your shop through the fight that ends it.",
        details: [
          'Demand an Encore fixed: its extra Shout triggers now also apply to every Shout triggered in that turn\'s combat (they used to vanish when combat started).',
          'This is now the standing rule for all "this turn" effects. A sweep of every card, rune, gift and hero power that says "this turn" found Demand an Encore was the only one breaking it.',
        ],
      },
    ],
  },
  {
    date: '2026-08-27',
    label: 'Combat Trigger Fixes',
    changes: [
      {
        category: 'Card Change',
        text: 'Shouts triggered in combat now respect your Shout multipliers everywhere.',
        details: [
          'Parting Cry, Embercrest, Rune of Ancestral Roar, Rune of Shared Scripture and Rune of the War Chorus all fired a Shout exactly once, even with a "Battlecries fire 1 more time" minion on board. They now fire the extra times, just like Ryme, Dawnclaw, Thunderous Sovereign and Chorus Drake already did.',
        ],
      },
      {
        category: 'Card Change',
        text: 'The Empty Graves quest reward now triggers Echoes at full strength.',
        details: [
          "The marked minion's \"Rally: trigger your leftmost Echo\" ignored every Echo multiplier (Sylus, Uron, Funeral Engine, first-Echo bonuses) and the marked minion's gilding. It now counts them all, like every other Echo trigger.",
          "The quest's reward text was also rewritten. It still described an older design.",
        ],
      },
      {
        category: 'Card Change',
        text: 'A gilded Exgalloper now summons gilded copies of itself.',
        details: [
          "Its copies are exact copies without the Echo, so a gilded body's copies now carry the Gilded badge too, matching Mirrorhide Rhino.",
        ],
      },
    ],
  },
  {
    date: '2026-08-27',
    label: 'Rune Duplicates',
    changes: [
      { category: 'Rune Change', text: 'Owning a second copy of a rune now always does something. Every duplicate stacks, pays again, or refunds you.', details: [
        "Recurring runes (Coffers, Flagship, Scales, the Deep, Seller's Market, …) fire once more per copy. Two Flagships give your Dwarves +4/+4 per Shop spell.",
        'Meter runes (Foundry, Returning Pack, the Vault, Golden Splinter, …) keep ONE meter but pay double at each trip. Two Returning Packs hand over 2 Beasts per 6 combat summons.',
        'Repeat runes (Wishbone, Shared Pour, the Conduit, Mastery, Corrupted Tome, …) add one more repetition per copy. Two Wishbones fire your Hero Power 3 times.',
        'One-shot runes (Small Fortune, Spare Parts, the Armory, the Altar, the Muster, Treasure Map) simply grant again. A second Treasure Map schedules its own payout.',
        'Start-of-Combat and combat-trigger runes (Rallying, Five Banners, Warding, the Underdog, Savagery, …) fire once per copy in every fight.',
        'Engine runes double their output where a doubling makes sense. Two Runes of Structure hand you 2 Shop spells per Attachment, two Contrabands smuggle 2 Ales / 2 Rubies, two Thrifts make stat spells cost 4 less.',
        "A duplicate that genuinely cannot stack, such as Twin Gilding, instead pays Gold equal to half the rune's cost (rounded up) plus a free refresh. Never a dead buy.",
        'The Runeforge stops offering runes you own whose duplicate would only pay that refund; Rune of Duplication can still reach them deliberately.',
      ] },
      { category: 'Rune Change', text: 'Rune of Held Strength reworked: now "Start of Combat: give your left and right-most minions the stats of the left-most minion card in your hand". It is a standing effect read fresh every fight, instead of a one-shot on purchase.' },
    ],
  },
  {
    date: '2026-08-27',
    label: 'Load Screen Fix',
    changes: [
      { category: 'UI / Info', text: 'The loading bar now fills smoothly over the load, and the logo no longer jumps in size a beat after the screen appears.' },
    ],
  },
  {
    date: '2026-08-27',
    label: 'Art Batch',
    changes: [
      { category: 'UI / Info', text: 'New illustrations: 7 more Gifts, the two Gift runes, and a new Aevor portrait.', details: [
        'Fast Track, Friends and Family, Grave Invitation, Parting Gifts, Second Calling, Special Delivery and Unbridled Might each get their art. 14 of the 15 Gifts are now illustrated.',
        'Happy Birthday and Merry Christmas wear their rune art in the Runeforge.',
        'Aevor has a brand-new portrait.',
      ] },
      { category: 'UI / Info', text: 'Stat pills now abbreviate at 100,000+ (101.1k, 10.6m, 405.1b) so late-game numbers stay readable. Anything up to 99,999 still shows in full.' },
    ],
  },
  {
    date: '2026-08-27',
    label: 'Bug Reporter',
    changes: [
      {
        category: 'UI / Info',
        text: 'You can now report a problem from the main menu too. Hit "Report a Problem" (or Ctrl+B) on the title screen to describe something you saw earlier, no run needed.',
        details: [
          'A menu report carries your description and build info. Use it to log something you spotted mid-game and wanted to write up later.',
        ],
      },
      {
        category: 'UI / Info',
        text: 'Press Ctrl+B any time during a run to report a problem. The game attaches the details automatically and the shop timer pauses while you type.',
        details: [
          'Describe what happened in your own words; the current turn and latest combat details ride along on their own.',
          'Reports send in the background and never interrupt play. Submitted while offline, a report is kept safe and sends when you reconnect.',
        ],
      },
    ],
  },
  {
    date: '2026-08-26',
    label: 'Rulebook rulings',
    changes: [
      { category: 'Card Change', text: 'Six Echo and death-watcher minions now work in the Shop phase too. Anything that fires an Echo or destroys a minion during the Shop (Funeral on Loan, Ossuary Rite, Deathsayer and friends) now sets them off, instead of only combat.', details: [
        'Malphas: its Echo gives Shop minions +8/+8 when fired in the Shop.',
        'Runesnout Archivist: its Echo casts every remembered spell on your Beasts in the Shop.',
        'Scavvers: its Echo triggers an adjacent Rally in the Shop.',
        'Ashen Heir: an Imp destroyed in the Shop hands its stats to a living Imp, or to the next Imp you summon.',
        'Brood Matron: friends dying in the Shop breed Imps (still max 3 per turn).',
        'Echo Mimic: gains the Echo of a friendly minion that dies in the Shop.',
      ] },
      { category: 'Card Change', text: 'Reflector now also reflects Rubies played on it during combat: one bonus Ruby spread to a random friendly minion, once per fight.' },
      { category: 'Card Change', text: 'Veinstorm now folds your spell power into the Rubies it puts on the Shop, like every other stat-granting Shop spell.' },
      { category: 'Card Change', text: 'Pack Leader’s text now says what it always did: it grows from Beasts played in the Shop while it’s on your board.' },
    ],
  },
  {
    date: '2026-08-26',
    label: 'Fixes',
    changes: [
      { category: 'Rune Change', text: 'Unused Shout charges no longer go to waste at combat. Rune of the War Drum and Warm Embers now carry an unspent charge into the fight.', details: [
        'Rune of the War Drum: if you didn’t play a Shout this shop, the first Shout that triggers during combat (a Parting Cry, Ryme, and friends) fires the extra times instead.',
        'Warm Embers’ banked double-charges work the same way: charges you didn’t spend in the shop double the next Shouts triggered in combat.',
        'Both still work exactly as before when you spend them in the shop. This only rescues charges that would have evaporated.',
      ] },
    ],
  },
  {
    date: '2026-08-26',
    label: 'Fixes',
    changes: [
      { category: 'Card Change', text: 'Pack Leader now counts the same Beasts for everyone. When your board is served as an opponent, its Pack Leader fights at full strength. An all-types minion you played was being missed.' },
    ],
  },
  {
    date: '2026-08-26',
    label: 'Fixes',
    changes: [
      { category: 'Card Change', text: 'A minion that counts as ALL types now genuinely triggers every type’s interactions.', details: [
        'Selling an all-types minion now triggers Voicekeeper (and the rest of the sell-a-type family).',
        'Effects that pick "a friendly minion of a type" can now pick an all-types minion.',
        'Rune of Trade-In discounts an all-types minion of the armed type.',
        'Pack Leader counts an all-types minion you played as a Beast.',
      ] },
      { category: 'Rune Change', text: 'Rune of Thrift actually works now. Every Shop spell that gives stats really is 2 Gold cheaper, Ales included, and the shown price matches what you pay.' },
      { category: 'Card Change', text: 'Conductor now fires during combat. Anything that re-triggers its Shout mid-fight, such as a Parting Cry, Ryme, Dawnclaw or Rune of Shared Scripture, now buffs its neighbours for the full snowballed amount, instead of doing nothing.' },
      { category: 'Card Change', text: 'Conductor’s card text now tracks what it will really give.', details: [
        'On your board and in combat it shows the buff it grants RIGHT NOW. It used to read one step high, as if you were about to play another copy.',
        'In the shop it still shows what playing it would grant.',
        'An opponent’s Conductor now shows the opponent’s number, and carries their full snowball into the fight.',
      ] },
      { category: 'Card Change', text: 'Gangplank now triggers for every card that reaches your hand: bought Shop spells, minted Rubies, Discover picks, a full Buyout, and more. It was only counting a few of them.' },
      { category: 'Card Change', text: 'Funeral on Loan: a borrowed Echo minion that summons now fits its summon into the slot the borrowed body leaves behind, instead of doing nothing on a full-looking board.' },
      { category: 'Rune Change', text: 'Rune of the Ornate Clock now MOVES your Epic Runeforge to next turn instead of also giving you the turn-9 one.' },
    ],
  },
  {
    date: '2026-08-26',
    label: 'Gifts',
    changes: [
      { category: 'New Card', text: 'Gifts arrive: a new kind of free spell you are given rather than bought.', details: [
        'A Gift is handed to you by a rune or a hero, never sold in the Shop.',
        'Casting one counts as casting a spell, but a Gift is not a Shop Spell, so nothing can copy or repeat it.',
        'Fifteen to collect, from doubling a minion’s Health to robbing the whole Shop.',
      ] },
      { category: 'New Hero', text: 'Kindness joins the roster. Great Presence Discovers a Gift every 4 turns.', details: [
        'Starts with 15 Armor.',
        'Every fourth turn, choose one Gift from three.',
      ] },
      { category: 'New Rune', text: 'Happy Birthday (Basic) gives a random Gift right away, then another every 2 turns.' },
      { category: 'New Rune', text: 'Merry Christmas (Epic) lets you Discover a Gift immediately, then again every Start of Turn.' },
      { category: 'New Card', text: 'Great Pot is a Tier 4 spell that gives a minion of each type +4/+4.' },
    ],
  },
  {
    date: '2026-08-26',
    label: 'Fixes',
    changes: [
      { category: 'Card Change', text: 'Kringle again shows its full grant. Its text was dropping the Health half the moment you played a card.' },
      { category: 'Rune Change', text: 'A shop buffed “for this turn” now sticks to the minion you buy.', details: [
        'Rune of the Merchant’s Chorus and Night Market Horror buff minions in the shop for the turn. Buying one used to pay only part of what the shop showed.',
        'The bought minion now arrives with the advertised stats and keeps them on the board.',
      ] },
    ],
  },
  {
    date: '2026-08-25',
    label: 'Practice Bots',
    changes: [
      { category: 'UI / Info', text: 'Practice bot games are much shorter. Bots now tier up as the rounds go on, hit harder, and knock each other out instead of stalling in draws.', details: [
        'Bots climb tavern tiers over the game (faster on higher difficulties), so a lost round actually costs Resolve.',
        'Bot damage scales with difficulty. Easy hits softest, Hard hardest.',
        'Each bot now fields a slightly different board, so bot-vs-bot fights resolve instead of mirroring into draws.',
        'Bots start on less health than you, so the table thins out at a sensible pace.',
      ] },
    ],
  },
  {
    date: '2026-08-25',
    label: 'Fixes',
    changes: [
      { category: 'Card Change', text: 'Resonance now works on Baby Gastrid. Re-firing its Shout buffs a random friendly Dwarf instead of doing nothing.' },
      { category: 'Hero Change', text: 'Aevor’s Tempest counter no longer shows a lock icon before it unlocks.' },
    ],
  },
  {
    date: '2026-08-25',
    label: 'Combat Damage',
    changes: [
      { category: 'UI / Info', text: 'Your Health now updates the moment combat ends, instead of staying at its old value until you return to the shop.' },
    ],
  },
  {
    date: '2026-08-24',
    label: 'Load Screen',
    changes: [
      { category: 'UI / Info', text: 'New look for the load screen before the game opens: a larger logo on a deep-blue glow. Its loading bar now fills smoothly over three seconds before the menu appears.' },
    ],
  },
  {
    date: '2026-08-24',
    label: 'Menu Polish',
    changes: [
      { category: 'UI / Info', text: 'Hero select now leads with the ASCENT logo at the top of the screen and a “Select Your Hero” prompt above the heroes.' },
      { category: 'UI / Info', text: 'Tidied the main-menu logo’s size and placement.' },
    ],
  },
  {
    date: '2026-08-24',
    label: 'Practice & Lobby Polish',
    changes: [
      { category: 'UI / Info', text: 'Fixed Practice bot games reporting the wrong placement. Beating the bots now correctly reads as 1st, and your finish reflects how many of the fights you won.' },
      { category: 'UI / Info', text: 'Practice bots now show real portrait icons and random player-style names instead of “Bot 1–7”.' },
      { category: 'UI / Info', text: 'When one player holds two seats in a lobby, the second reads with an adjective, such as “Sneaky Orangez”, instead of “Orangez (2)”.' },
    ],
  },
  {
    date: '2026-08-24',
    label: 'Practice Options',
    changes: [
      { category: 'UI / Info', text: 'Practice now opens a setup screen. Pick your opponents (real players, or scaling bots with Easy / Medium / Hard), health (unlimited or normal elimination), shop-timer speed (1–4×), and an optional tribe surge.', details: [
        'Opponents: real players’ recorded warbands, or effectless bots that only grow in stats.',
        'Bot difficulty: Easy / Medium / Hard curves (only shown when Bots is chosen).',
        'Health: Unlimited (you can’t be eliminated) or Normal (real damage, last one standing).',
        'Time: 1–4× shop-timer speed.',
        'Tribe surge: doubles how often a chosen tribe’s cards appear.',
        'Everything is unrated, and your choices are remembered for next time.',
      ] },
      { category: 'UI / Info', text: 'Bots are simple, effectless opponents that only grow in stats round over round. They are a low-pressure way to practice the real game, at three difficulty curves.' },
      { category: 'UI / Info', text: 'Tribe surge doubles how often the chosen tribe’s cards turn up in your shop.' },
    ],
  },
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
      { category: 'UI / Info', text: 'Added this Patch Notes screen: gameplay changes by date, opened from the title.' },
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
      { category: 'Hero Change', text: 'Brackus can no longer be handed out by Mimic or the Power Shifter spell. Adopting a start-of-game power mid-run did nothing.' },
      { category: 'Rune Change', text: 'Rune of Beastial Swarm now shows its current +X/+X value on its pill, not just the countdown to the next improve.' },
      { category: 'Card Change', text: 'Fixed a bug where a minion summoned mid-combat (by Bullseye or Mammoth, say) could gain its Avenge immediately. Avenge now counts from the moment it arrives.', details: [
        'A summoned minion now starts its Avenge count at 0 instead of inheriting every friendly death that happened before it arrived.',
        'Affected any minion pulled into combat by another (Bullseye, Mammoth, and similar).',
      ] },
      { category: 'UI / Info', text: 'Hero power pills now show live trackers and current values during combat. Aevor’s kills, Gorun’s attack bonus, Cindara’s Avenge counter, and Vale’s per-type buff all tick as the fight happens.', details: [
        'Aevor: the kill count toward the next Tempest step ticks up as enemies fall.',
        'Gorun: the attack-bonus value and its progress to the next improve update mid-fight.',
        'Cindara: a live X/4 Avenge tracker toward the next Whelp.',
        'Vale: the per-type buff grows with each spell cast this game.',
      ] },
      { category: 'UI / Info', text: 'A hero’s second power (Void) now shows the full pills for cost, tracker and value, exactly like the main power.' },
      { category: 'UI / Info', text: 'Fibbsy’s power previews the Ruby it will mint on hover, at its current value.' },
    ],
  },
  {
    date: '2026-08-24',
    label: 'Tutorial & Save',
    changes: [
      { category: 'UI / Info', text: 'The Learn Ascent tutorial now climbs to Tier 6, teaches the rune system, and uses tier-accurate shops.', details: [
        'Tiers up all the way to 6 across the course.',
        'Shops only ever offer minions your current tier has unlocked, and the course explains that link.',
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
      { category: 'New Hero', text: 'Aevor joins the roster. Tempest unlocks after 15 kills, then buffs your flanks +4/+4 at end of turn, growing every 15 kills.', details: [
        'Starts with 16 Armor.',
        'Tempest stays locked until your minions have killed 15 enemies.',
        'Once unlocked, it grants your two flank minions +4/+4 at end of turn.',
        'The grant grows by +4/+4 for every further 15 kills.',
      ] },
      { category: 'New Hero', text: 'Gorun joins the roster. Blade Mastery grants attackers +3 Attack, improving every 8 attacks.', details: [
        'Starts with 11 Armor.',
        'Your attacking minions get +3 Attack from the very first swing. No unlock.',
        'The bonus grows by +3 for every 8 attacks made.',
      ] },
      { category: 'New Hero', text: 'Cindara joins the roster. Hoard summons a Whelp every 4 friendly deaths and improves your Whelps +2/+2.', details: [
        'Starts with 9 Armor.',
        'Every 4 friendly deaths in combat, summon a 1/1 Whelp that attacks immediately.',
        'Improving Whelps adds +2/+2, applied live to both existing and newly summoned Whelps.',
      ] },
      { category: 'Hero Change', text: 'Fi and Coran are temporarily in Practice only while their hero quests are reworked. They are marked “Not currently enabled in Play”.', details: [
        'Both remain fully playable in Practice.',
        'They cannot be handed out through a power Discover (Mimic / Void / Power Shifter) while pulled.',
      ] },
    ],
  },
  {
    date: '2026-08-22',
    label: 'Power Shifter & New Heroes',
    changes: [
      { category: 'New Card', text: 'Power Shifter is a Tier 5 spell that lets you Discover a brand-new hero power to replace your current one.' },
      { category: 'New Hero', text: 'Rayse joins the roster: minions you summon in combat gain +2/+3 and Taunt.' },
      { category: 'New Hero', text: 'Mimic joins the roster: Discover a hero power to wield each turn.' },
      { category: 'New Hero', text: 'Void joins the roster: wield TWO hero powers for the rest of the run.' },
      { category: 'Hero Change', text: 'Cia is now Ayse: a new “Ace” reward suit, a 20% chance per card to be enchanted, enchantable spells, and enchanted cards possible from the first shop.', details: [
        'Renamed from Cia to Ayse, with a new "Ace" reward suit.',
        'Each shop card has a 20% chance to arrive enchanted.',
        'Spells can now be enchanted too.',
        'Enchanted cards can appear as early as the first shop.',
      ] },
      { category: 'Hero Change', text: 'Auctioneer’s hero power no longer waits until turn 3.' },
      { category: 'Card Change', text: 'Rune of Rebirth now prints its granted Echo on the exact minion that received it.' },
      { category: 'UI / Info', text: 'The hero-select screen was redesigned, and Practice now uses the real hero cards: four across, two rows, alphabetical.' },
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
      { category: 'New Card', text: 'Conductor is a snowballing minion that triggers on adjacent Shouts.' },
      { category: 'Card Change', text: 'Oona doubles both stats again; Quillen counts as every type; several minions gained real tribes; Fresh Pages now Discovers on purchase.' },
      { category: 'UI / Info', text: 'The Hero Select Ceremony (pick presentation + explicit Start Game), a keyword-definition panel beside hovered cards, and minion medallion mechanic icons.' },
    ],
  },
  {
    date: '2026-08-19',
    label: 'Runes & Dragons',
    changes: [
      { category: 'New Rune', text: '27 new runes, 6 rune reworks, and Might of Aeon.' },
      { category: 'New Card', text: 'A Dragon batch of 8 Dragons and 2 spells, plus the Standard Bearer minion.' },
      { category: 'Card Change', text: '15 new minions and a set of rebalances; Beefy and Lantern Light no longer fizzle when cast in combat.' },
      { category: 'UI / Info', text: 'Rune triggers now burst on their badge, and the locked third rune slot shows chains.' },
    ],
  },
  {
    date: '2026-08-18',
    label: 'Balance Pass',
    changes: [
      { category: 'Card Change', text: 'A broad Set 1 / Set 2 balance patch: stat tweaks, effect reworks, a new Gildmaster power, and rune tuning.' },
    ],
  },
];
