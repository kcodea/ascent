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
    date: '2026-08-31',
    label: 'Save & Quit',
    changes: [
      {
        category: 'UI / Info',
        text: 'Saving and quitting mid-turn now returns you to the turn with the time you left it on, instead of restarting the round timer.',
        details: [
          'Quitting with 8 seconds left and pressing Continue used to hand back a full turn.',
          'The time was always saved correctly — it was being overwritten on the way back in.',
        ],
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
          'No change to what the Pulse does — it still triggers a friendly minion’s Shout.',
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
        text: 'The round metrics beside a replay are simply always shown — the collapse arrow that slid away from your cursor is gone.',
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
          'The timer shows your position within the round you are watching, not the whole game — on a long replay a single round used to be about forty pixels of bar.',
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
        text: 'Replays are for watching — the board controls no longer respond to clicks — and card art no longer slides sideways when you roll.',
        details: [
          'End Turn, Freeze, Refresh and the rest are inert while a replay plays. They never did anything, but they used to press and play their sound, which read as broken.',
          'Cards can still be hovered and read while you watch.',
          'Shop cards used to grow slightly as they arrived, which dragged their art a few pixels to the left — most visibly on cards whose art sits off-centre. They now rise and fade without growing.',
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
        text: 'The replay bar can be dragged to scrub, shows how far through you are, and takes the keyboard — and playback speed now carries the shop timer with it.',
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
          'When a recorded player buys a rune, the chosen rune slides to centre, the gold frame clamps shut and the flash goes off — it used to just vanish from the forge.',
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
        text: 'Choosing a mode no longer flashes a game board on the way to the menu — nothing is running until you actually start a run.',
        details: [
          'Pressing Practice showed the board for an instant before the options screen appeared. It no longer does, and the same gap on Play, Rift and Lobby is closed too.',
          'The board is not merely hidden before a run now — it is not running at all.',
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
          'A bot table used to open at 18/17/16/15/14/13/12 against your 30 — visible on the round-1 standings. Every seat now starts level with you.',
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
        text: "Click your opponent's portrait in combat to see their run-wide Buffs Panel — the same window your own portrait opens.",
        details: [
          'Hovering the foe portrait shows the same prompt yours does; the panel drops down below their health pill, with an arrow cue underneath it.',
          "It lists the buffs their board actually brings to the fight — Spell power, Ruby power, and their tribe auras — read from the run that built it.",
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
        text: 'The combat curtain now erupts from the End Turn gem — the gem charges up, blooms the blue over the whole scene, then a sweep reveals the arena.',
        details: [
          'A short charge-up on the gem (motes spiraling in, a swelling flare) telegraphs the transition before it fires.',
          'The cover is a circle blooming out of the gem, trailed by stardust and swirling wisps along its edge; the reveal is a clean linear sweep (right-to-left into combat, left-to-right back to shop).',
          'Returning to shop, the End Combat gem drinks the scene back in — motes and sparks stream into it as the blue closes.',
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
        text: 'Locking in a rune now gets a short ceremony — the others clear away and your pick takes centre stage.',
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
        text: 'Gilding an Equip minion now announces the upgrade — the equip flourish plays again.',
        details: [
          'Playing a Gilded copy over the plain version upgrades what is in your slot, so it gets the same feedback a brand-new Equipment does.',
          'A second Gilded copy after that is silent — the slot is already at its best.',
        ],
      },
      {
        category: 'UI / Info',
        text: 'Your Equipment puffs out when you spend your last use for the turn.',
        details: [
          'Only when you actually run out — spending one of two uses leaves the other and stays quiet.',
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
          'Same stats as before — five cards played is still +5/+10, it just arrives as five hits in a row.',
          'The more you played, the bigger the flurry.',
        ],
      },
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
          'It stays quiet when you play another copy of an Equip minion you already have — the slot is showing the same thing.',
        ],
      },
      {
        category: 'Card Change',
        text: 'Cards that arrive in your hand DURING a fight now trigger the minions that watch for them.',
        details: [
          'Gangplank and Kegheart Dwarf react the moment a card reaches your hand mid-combat, so the payout can help win the fight that earned it — before, the stats only showed up back in the shop.',
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
        text: 'Combat entrances got a full makeover: a blue curtain sweeps the board, announces NOW FACING with your opponent, and reveals both armies standing ready — then sweeps the other way back to the shop.',
        details: [
          "Ending your turn sweeps a dark-blue curtain across the whole board; your opponent's portrait and name are announced on it before the arena is revealed.",
          'Both armies are revealed already in position and hold a beat before the first attack.',
          'Returning to the shop plays the curtain in the opposite direction, with everything back in place when it clears.',
          "The fight screen is decluttered: the shop's Tier stone, Refresh crystal, Freeze gem and Gold coin step aside during combat and return with the shop.",
          "Your opponent's hero power now shows beside their portrait during the fight — hover it to read what it does.",
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
        text: 'EQUIPMENT — some minions hand you a tool you can use every shop phase, for as long as they live.',
        details: [
          'An Equip minion grants its Equipment the moment you play it. The Equipment appears in its own slot beside your hero power.',
          'Using one costs Gold and spends your Equipment use for the turn — you get one use per turn, shared across every Equipment you hold.',
          'Your hero power is untouched: the two are spent separately, so holding an Equipment never costs you your power.',
          'Lose the minion and you lose its Equipment. Keep it and the Equipment comes back every turn.',
          'A Gilded Equip minion upgrades its Equipment, and holding two sources of the same one keeps the better version.',
        ],
      },
      {
        category: 'New Card',
        text: 'Alchemist Frank — a Tier 1 Neutral who equips the Bloodpot: give a friendly minion +3/+3.',
      },
      {
        category: 'New Card',
        text: 'Titan Sculptor — a Tier 6 Neutral who equips the Titan Hammer: SET a friendly minion to 50/50.',
        details: [
          'It sets, rather than adds — a smaller minion is raised to 50/50, and a bigger one is brought down to it.',
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
          'Playing a second copy of an Equip minion is silent — you already hold that Equipment.',
          'The minion still counts: it keeps the Equipment alive, and a Gilded copy still upgrades it.',
        ],
      },
      {
        category: 'UI / Info',
        text: 'Holding more than one Equipment? Hover the slot and the others slide out to the right — click one to switch.',
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
        text: 'The opponents rail down the right edge got a full visual pass — a gilded backplate frame, warmer plaques, each opponent’s name on its own banner, and a shield icon on armor.',
        details: [
          'The next opponent you fight is lit brighter in place — a ring, glow and accent bar mark it, replacing the old “Next” label.',
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
        text: 'Trigger multipliers now say exactly how they combine — "twice" multiplies, "additional" adds up.',
        details: [
          'Drakko the Drummer: "Your Shouts trigger twice." Two Drakkos are still twice — a multiplier does not stack with itself.',
          'Chronos: "Your End of Turn effects trigger twice." Same rule.',
          'Sylus the Reaper: "Your Echoes trigger 1 additional time." Every copy counts, so two Sylus mean three Echoes.',
          'Zyff and Uron read "an additional time", so they stack too — two Urons now mean three triggers, where before the second did nothing.',
          'The two kinds combine: Drakko + Zyff means a Shout triggers FOUR times — Zyff adds a trigger, then Drakko doubles the total.',
          'Gilded Drakko and Chronos now read "three times".',
        ],
      },
      {
        category: 'UI / Info',
        text: 'Deaths and Echoes in the shop now animate, the same way they do in combat.',
        details: [
          'A minion destroyed in the shop plays the death dissolve; one that is rising plays its return instead.',
          'The Echo burst plays anytime an Echo triggers in the shop — from a destroy, a rune, or any card that triggers one.',
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
        text: 'Rise now works in the shop — a minion destroyed there comes back, just as it would in combat.',
        details: [
          'Graverobber eating a minion with Rise no longer kills it outright: it returns at its base Attack with 1 Health, its Rise spent.',
          'Its Echo still resolves first, so if the Echo fills your board there is no room and the Rise is lost — the same rule combat uses.',
          'Funeral on Loan follows the same rule: discover a minion with Rise, play it this turn, and after its Echo it rises and stays on your board.',
        ],
      },
      {
        category: 'UI / Info',
        text: 'Destroying a minion in the shop now plays out instead of happening instantly.',
        details: [
          'The minion shows its death, and its Echo animation if it has one, on its own beat — they used to resolve in a single frame with nothing to see.',
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
          'Play the card, pick your side, then aim — the old flow made you aim first, which meant choosing after you had already committed.',
          'Nothing happens until the choice is settled: a Choose One minion waits in your hand until you pick, so it is never left on the board mid-decision.',
          'Click away from the options (or away while aiming) to cancel. The card comes straight back to your hand with nothing spent and nothing triggered.',
          "When every branch is already switched on — a Gilded Orivax, or Facetwright's Choice and Veinbreaker with their runes — the card no longer asks a question with one answer. It reads (Both) and prints both effects, wherever you see it.",
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
        text: 'Apples now offers a board buff instead of a second shop buff — and its shop half got bigger.',
        details: [
          'Choose One: give this shop +2/+4 (was +1/+3), or give 2 random friendly minions +1/+1.',
          'The old "next shop +2/+4" option is gone — both halves used to buff shops, which left the card with nothing to offer a board you already own.',
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
        text: 'Rubies are now CAST, never "played" — every card and rune that hands out a Ruby says so the same way.',
        details: [
          '"Play a Ruby" now reads "Cast a Ruby" on 11 Kobold and Dwarf minions, 2 spells and 6 runes.',
          '"Played" now means one thing everywhere: a card leaving your hand. Rune of the Lapidary still reads "after you play 6 cards" — that is a card play, not a Ruby.',
          'Wording only. No Ruby, card or rune changed what it does.',
        ],
      },
    ],
  },
  {
    date: '2026-08-28',
    label: 'Rune Fix',
    changes: [
      { category: 'Rune Change', text: 'Rune of Summoning now gives the +2/+2 it promises — it was quietly paying half.', details: [
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
        text: 'Buffs that follow a whole tribe around — on your board, in your hand, in the shop, and onto copies you pick up later — are now called Auras. Same effects, clearer words.',
        details: [
          'A card that used to read "give your Beasts +8/+8 wherever they are" now reads "give your Beast Aura +8/+8".',
          'Eleven cards and runes were re-worded: Kennelmaster, Trophy Stalker, Grim, Armadiyo, Deathswarmer, Forsaken Mage, Lantern of Souls, Attachment Mechanic, Chorus Engine, Rune of Summoning and Rune of the Cinder Ledger.',
          'Quest rewards that grant one of these buffs read the same new way.',
          'Nothing about what they do changed — the numbers, targets and timing are untouched.',
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
          'Runes are unaffected — the Runeforge still opens on turn 6, and the Epic Runeforge on turn 9.',
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
        text: 'Henchmen are removed for now — no hero offers one.',
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
        text: 'Combat now has its own board — a wipe of light sweeps across the table as the fight begins, and sweeps back when you return to the shop.',
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
      { category: 'Card Change', text: 'Great Pot now scales with your spell power — and its text shows the value it will actually give.', details: [
        'The +4/+4 it gives one minion of each type now adds your spell power, like every other stat-granting spell.',
        'Its printed number goes green and live once any spell power is up.',
      ] },
      { category: 'UI / Info', text: "Growth's improved value (from Mushy's rune) now shows everywhere — including the popup when hovering Mushy.", details: [
        'The hover popup and the mid-combat hand fly-in previously kept showing the base +1/+1 while the cast paid more.',
      ] },
      { category: 'UI / Info', text: 'The Refresh button now shows the real price of your next roll — a green 0 while Rune of Window Shopping is paying.', details: [
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
        text: "Opponent boards now fight at full fidelity — spell marks, grafted Echoes, and Ashen Heir's bank all carry into battle.",
        details: [
          'Parting Cry, Closed Casket and Soren’s Reclaim now work on opponent boards too — a served copy of a board fights with the same marks its owner paid for (Reclaim even destroys the exact minion its owner chose).',
          'An Echo gained in the shop (Echo Mimic, Grave Body, and friends) now actually fires when that minion dies in combat — yours and your opponents’.',
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
        text: 'Effects that last "this turn" now correctly persist through that turn\'s combat — a turn runs from your shop through the fight that ends it.',
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
          'Parting Cry, Embercrest, Rune of Ancestral Roar, Rune of Shared Scripture and Rune of the War Chorus all fired a Shout exactly once, even with a "Battlecries fire 1 more time" minion on board — they now fire the extra times, just like Ryme, Dawnclaw, Thunderous Sovereign and Chorus Drake already did.',
        ],
      },
      {
        category: 'Card Change',
        text: 'The Empty Graves quest reward now triggers Echoes at full strength.',
        details: [
          'The marked minion\'s "Rally: trigger your leftmost Echo" ignored every Echo multiplier (Sylus, Uron, Funeral Engine, first-Echo bonuses) and the marked minion\'s gilding — it now counts them all, like every other Echo trigger.',
          'The quest\'s reward text was also rewritten — it still described an older design.',
        ],
      },
      {
        category: 'Card Change',
        text: 'A gilded Exgalloper now summons gilded copies of itself.',
        details: [
          'Its copies are exact copies without the Echo — so a gilded body\'s copies now carry the Gilded badge too, matching Mirrorhide Rhino.',
        ],
      },
    ],
  },
  {
    date: '2026-08-27',
    label: 'Rune Duplicates',
    changes: [
      { category: 'Rune Change', text: 'Owning a second copy of a rune now always does something — every duplicate stacks, pays again, or refunds you.', details: [
        'Recurring runes (Coffers, Flagship, Scales, the Deep, Seller\'s Market, …) fire once more per copy — two Flagships give your Dwarves +4/+4 per Shop spell.',
        'Meter runes (Foundry, Returning Pack, the Vault, Golden Splinter, …) keep ONE meter but pay double at each trip — two Returning Packs hand over 2 Beasts per 6 combat summons.',
        'Repeat runes (Wishbone, Shared Pour, the Conduit, Mastery, Corrupted Tome, …) add one more repetition per copy — two Wishbones fire your Hero Power 3 times.',
        'One-shot runes (Small Fortune, Spare Parts, the Armory, the Altar, the Muster, Treasure Map) simply grant again — a second Treasure Map schedules its own payout.',
        'Start-of-Combat and combat-trigger runes (Rallying, Five Banners, Warding, the Underdog, Savagery, …) fire once per copy in every fight.',
        'Engine runes double their output where a doubling makes sense — two Runes of Structure hand you 2 Shop spells per Attachment, two Contrabands smuggle 2 Ales / 2 Rubies, two Thrifts make stat spells cost 4 less.',
        'A duplicate that genuinely cannot stack (e.g. Twin Gilding) instead pays Gold equal to half the rune\'s cost (rounded up) plus a free refresh — never a dead buy.',
        'The Runeforge stops offering runes you own whose duplicate would only pay that refund; Rune of Duplication can still reach them deliberately.',
      ] },
      { category: 'Rune Change', text: 'Rune of Held Strength reworked: now "Start of Combat: give your left and right-most minions the stats of the left-most minion card in your hand" — a standing effect read fresh every fight, instead of a one-shot on purchase.' },
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
        'Fast Track, Friends and Family, Grave Invitation, Parting Gifts, Second Calling, Special Delivery and Unbridled Might each get their art — 14 of the 15 Gifts are now illustrated.',
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
        text: 'You can now report a problem from the main menu too — hit "Report a Problem" (or Ctrl+B) on the title screen to describe something you saw earlier, no run needed.',
        details: [
          'A menu report carries your description and build info — perfect for logging something you spotted mid-game and wanted to write up later.',
        ],
      },
      {
        category: 'UI / Info',
        text: 'Press Ctrl+B any time during a run to report a problem — the game attaches the details automatically and the shop timer pauses while you type.',
        details: [
          'Describe what happened in your own words; the current turn and latest combat details ride along on their own.',
          'Reports send in the background and never interrupt play — submitted while offline, a report is kept safe and sends when you reconnect.',
        ],
      },
    ],
  },
  {
    date: '2026-08-26',
    label: 'Rulebook rulings',
    changes: [
      { category: 'Card Change', text: 'Six Echo and death-watcher minions now work in the Shop phase too — anything that fires an Echo or destroys a minion during the Shop (Funeral on Loan, Ossuary Rite, Deathsayer and friends) now sets them off, instead of only combat.', details: [
        'Malphas: its Echo gives Shop minions +8/+8 when fired in the Shop.',
        'Runesnout Archivist: its Echo casts every remembered spell on your Beasts in the Shop.',
        'Scavvers: its Echo triggers an adjacent Rally in the Shop.',
        'Ashen Heir: an Imp destroyed in the Shop hands its stats to a living Imp — or to the next Imp you summon.',
        'Brood Matron: friends dying in the Shop breed Imps (still max 3 per turn).',
        'Echo Mimic: gains the Echo of a friendly minion that dies in the Shop.',
      ] },
      { category: 'Card Change', text: 'Reflector now also reflects Rubies played on it during combat — one bonus Ruby spread to a random friendly minion, once per fight.' },
      { category: 'Card Change', text: 'Veinstorm now folds your spell power into the Rubies it puts on the Shop, like every other stat-granting Shop spell.' },
      { category: 'Card Change', text: 'Pack Leader’s text now says what it always did: it grows from Beasts played in the Shop while it’s on your board.' },
    ],
  },
  {
    date: '2026-08-26',
    label: 'Fixes',
    changes: [
      { category: 'Rune Change', text: 'Unused Shout charges no longer go to waste at combat — Rune of the War Drum and Warm Embers now carry an unspent charge into the fight.', details: [
        'Rune of the War Drum: if you didn’t play a Shout this shop, the first Shout that triggers during combat (a Parting Cry, Ryme, and friends) fires the extra times instead.',
        'Warm Embers’ banked double-charges work the same way: charges you didn’t spend in the shop double the next Shouts triggered in combat.',
        'Both still work exactly as before when you spend them in the shop — this only rescues charges that would have evaporated.',
      ] },
    ],
  },
  {
    date: '2026-08-26',
    label: 'Fixes',
    changes: [
      { category: 'Card Change', text: 'Pack Leader now counts the same Beasts for everyone — when your board is served as an opponent, its Pack Leader fights at full strength (an all-types minion you played was being missed).' },
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
      { category: 'Rune Change', text: 'Rune of Thrift actually works now — every Shop spell that gives stats really is 2 Gold cheaper, Ales included, and the shown price matches what you pay.' },
      { category: 'Card Change', text: 'Conductor now fires during combat. Anything that re-triggers its Shout mid-fight — a Parting Cry, Ryme, Dawnclaw, Rune of Shared Scripture — now buffs its neighbours for the full snowballed amount, instead of doing nothing.' },
      { category: 'Card Change', text: 'Conductor’s card text now tracks what it will really give.', details: [
        'On your board and in combat it shows the buff it grants RIGHT NOW — it used to read one step high, as if you were about to play another copy.',
        'In the shop it still shows what playing it would grant.',
        'An opponent’s Conductor now shows the opponent’s number, and carries their full snowball into the fight.',
      ] },
      { category: 'Card Change', text: 'Gangplank now triggers for every card that reaches your hand — bought Shop spells, minted Rubies, Discover picks, a full Buyout, and more. It was only counting a few of them.' },
      { category: 'Card Change', text: 'Funeral on Loan: a borrowed Echo minion that summons now fits its summon into the slot the borrowed body leaves behind, instead of doing nothing on a full-looking board.' },
      { category: 'Rune Change', text: 'Rune of the Ornate Clock now MOVES your Epic Runeforge to next turn instead of also giving you the turn-9 one.' },
    ],
  },
  {
    date: '2026-08-26',
    label: 'Gifts',
    changes: [
      { category: 'New Card', text: 'Gifts arrive — a new kind of free spell you are given rather than bought.', details: [
        'A Gift is handed to you by a rune or a hero, never sold in the Shop.',
        'Casting one counts as casting a spell, but a Gift is not a Shop Spell — so nothing can copy or repeat it.',
        'Fifteen to collect, from doubling a minion’s Health to robbing the whole Shop.',
      ] },
      { category: 'New Hero', text: 'Kindness joins the roster. Great Presence Discovers a Gift every 4 turns.', details: [
        'Starts with 15 Armor.',
        'Every fourth turn, choose one Gift from three.',
      ] },
      { category: 'New Rune', text: 'Happy Birthday (Basic) gives a random Gift right away, then another every 2 turns.' },
      { category: 'New Rune', text: 'Merry Christmas (Epic) lets you Discover a Gift immediately, then again every Start of Turn.' },
      { category: 'New Card', text: 'Great Pot — a Tier 4 spell that gives a minion of each type +4/+4.' },
    ],
  },
  {
    date: '2026-08-26',
    label: 'Fixes',
    changes: [
      { category: 'Card Change', text: 'Kringle again shows its full grant — its text was dropping the Health half the moment you played a card.' },
      { category: 'Rune Change', text: 'A shop buffed “for this turn” now sticks to the minion you buy.', details: [
        'Rune of the Merchant’s Chorus and Night Market Horror buff minions in the shop for the turn — buying one used to pay only part of what the shop showed.',
        'The bought minion now arrives with the advertised stats and keeps them on the board.',
      ] },
    ],
  },
  {
    date: '2026-08-25',
    label: 'Practice Bots',
    changes: [
      { category: 'UI / Info', text: 'Practice bot games are much shorter — bots now tier up as the rounds go on, hit harder, and knock each other out instead of stalling in draws.', details: [
        'Bots climb tavern tiers over the game (faster on higher difficulties), so a lost round actually costs Resolve.',
        'Bot damage scales with difficulty — Easy hits softest, Hard hardest.',
        'Each bot now fields a slightly different board, so bot-vs-bot fights resolve instead of mirroring into draws.',
        'Bots start on less health than you, so the table thins out at a sensible pace.',
      ] },
    ],
  },
  {
    date: '2026-08-25',
    label: 'Fixes',
    changes: [
      { category: 'Card Change', text: 'Resonance now works on Baby Gastrid — re-firing its Shout buffs a random friendly Dwarf instead of doing nothing.' },
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
      { category: 'UI / Info', text: 'New look for the load screen before the game opens — a larger logo on a deep-blue glow — and its loading bar now fills smoothly over three seconds before the menu appears.' },
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
      { category: 'UI / Info', text: 'Fixed Practice bot games reporting the wrong placement — beating the bots now correctly reads as 1st, and your finish reflects how many of the fights you won.' },
      { category: 'UI / Info', text: 'Practice bots now show real portrait icons and random player-style names instead of “Bot 1–7”.' },
      { category: 'UI / Info', text: 'When one player holds two seats in a lobby, the second reads with an adjective (e.g. “Sneaky Orangez”) instead of “Orangez (2)”.' },
    ],
  },
  {
    date: '2026-08-24',
    label: 'Practice Options',
    changes: [
      { category: 'UI / Info', text: 'Practice now opens a setup screen — pick your opponents (real players, or scaling bots with Easy / Medium / Hard), health (unlimited or normal elimination), shop-timer speed (1–4×), and an optional tribe surge.', details: [
        'Opponents: real players’ recorded warbands, or effectless bots that only grow in stats.',
        'Bot difficulty: Easy / Medium / Hard curves (only shown when Bots is chosen).',
        'Health: Unlimited (you can’t be eliminated) or Normal (real damage, last one standing).',
        'Time: 1– 4× shop-timer speed.',
        'Tribe surge: doubles how often a chosen tribe’s cards appear.',
        'Everything is unrated, and your choices are remembered for next time.',
      ] },
      { category: 'UI / Info', text: 'Bots are simple, effectless opponents that only grow in stats round over round — a low-pressure way to practice the real game, at three difficulty curves.' },
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
