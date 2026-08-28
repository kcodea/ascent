/**
 * Heroes — data-driven, like cards. A hero is an id, a name, and a hero power.
 * The reducer (`heroPower` action) resolves the power by `kind`; the UI reads the
 * same registry to draw the hero panel and the (eventual) hero-select screen.
 *
 * Adding a hero = a new entry here + (only if it needs a brand-new effect) a new
 * `kind` branch in the reducer. No bespoke classes, no scene plumbing per hero.
 */

export type HeroPowerKind =
  | 'fortify' // (unused by default) give a minion +Tier/+Tier (scales with Tavern Tier)
  | 'gild' // Indy: make a friendly minion Golden (recharges after every 75 Gold spent)
  | 'replayBattlecry' // Myra: re-trigger a friendly minion's Battlecry
  | 'replayEndOfTurn' // (legacy) proc a single friendly minion's End of Turn now
  | 'replayAllEndOfTurn' // Djinn: trigger EVERY friendly minion's End of Turn effect now (untargeted)
  | 'resummon' // Soren: at start of combat, destroy a marked minion (procs its Deathrattle) + resummon a copy
  | 'spellAmplify' // Rohan (passive): stat-granting spells give +X/+X more, X scaling every 10 spells cast
  | 'gainMaxMana' // Nadja: gain +1 max Gold permanently (id stays `gainMaxMana`)
  | 'grantWard' // Warden: spend Gold — give a friendly minion a permanent Ward (Divine Shield) (active, targeted)
  | 'scalingGold' // Bagger Ben: gain Gold now, the payout climbing +1 each turn (active, untargeted, once/game)
  | 'cheapMinions' // Hermit Hank (passive): shop minions cost 2 Gold, but tavern-ups cost 2 more
  | 'summitLock' // Brackus (passive): turn-1 Tier 7 Discover, locked until 70 Gold is spent this run
  | 'discoLock' // Disco Dan (passive): turn-1 sequential Discover T6→T4→T2, each locked in hand until that shop tier
  | 'questChronos' // Chronos (passive): buy 4 End-of-Turn minions → get a Chronos (resolved in the buy case)
  | 'heroQuest' // Fi & Coran (passive): on turn 1, Discover ONE of two quests from that hero's own private list
  | 'lesserQuest' // RETIRED Fi power (2026-08-21). Kept so pre-rework saves/replays still resolve their turn-4 offer
  | 'collision' // Cassen (passive): after killing 5 enemy minions, get a minion of your most common type (carry-back)
  | 'quest' // Drakko (passive): buy 5 Battlecry minions → get Drakko the Drummer (resolved in the buy case)
  | 'chaos' // Chaos (passive): starts with a 1/1 all-type Magnetic token; gets another at the start of every 5th turn
  | 'sellGold' // Robin (passive): each minion you sell banks +1 Gold for the START of next turn
  | 'displace' // Darah: swap a friendly minion with a random tavern minion (active, targeted)
  | 'grantReborn' // Lord of the Risen: give a friendly minion Rise for the next combat (active, targeted)
  | 'recurringGoldcrafter' // RETIRED Gildmaster passive (kept for old saves/replays)
  | 'greatPresence' // Kindness (passive): Discover a Gift at the start of every 4th turn
  | 'gildcrafter' // Gildmaster (active, 3 Gold, 3×/game): complete a triple from 2 copies of a minion
  | 'runeforge' // Runesmith (passive): on turn 5 the Runeforge opens — buy ONE of a random 3 runes (a run-long buff)
  | 'epicRuneforge' // Guardian (passive): the EPIC Runeforge opens on turn 8 (scheduled via `epicForgeWave` at run start)
  | 'pathfinder' // RETIRED Coran power (2026-08-21). Kept so pre-rework saves/replays still resolve their turn-10 offer
  | 'dynamiteDig' // Jensen: Discover a minion of your tier — free first, +1 Gold each later use (active, untargeted)
  | 'dragonTamer' // Tiff: 5 Gold Discover a Dragon — the cost drops 1 per Dragon/spell bought, resetting on use
  | 'secondHand' // Re-Pete (passive): at the END of every 3rd turn, a plain copy of the left-most card in hand (conjured, no pool take)
  | 'possession' // RETIRED with Atrius (2026-07-20). Kept so saves/replays of old runs still resolve;
  //                the Start-of-Combat machinery in simulate.ts remains as an unused primitive.
  | 'fourPeat' // Gorr (passive): buy 3 minions in one turn → a plain copy of one of them at random (once/turn)
  | 'pocketMagic' // Merrin: get a random Shop spell to hand (active, untargeted, 1 Gold)
  | 'dice' // Gambler: roll a die, gain that much Gold, then the power is locked for that many turns (active, 1 Gold)
  | 'copyMachine' // Xerox: copy a friendly board minion into your hand (active, targeted, once per game)
  | 'clearance' // Frantic Frank: refresh the Shop; its minions cost 2 Gold this turn (active, untargeted, once per turn)
  | 'contraband' // Pete (passive): every 3rd refresh appends a minion from the tier above your Shop tier
  | 'companyRate' // Foreman Flint (passive): Dwarf Shop minions cost 2 Gold
  | 'unitedFront' // Emissary (passive): SoC — one friendly of each type +1/+1 per spell cast this game
  | 'archive' // Quillen: once/turn, archive a chosen friendly/Shop minion; every 3rd → Discover from those tribes
  | 'roundedSpellbook' // Hunch: a copy of the last spell you cast — 3 Gold, dropping 1 per turn since the last use
  | 'vanguard' // Emerald Warden (passive): every tavern-up also hands you a random minion of the tier you just reached
  | 'soulkeeper' // Underdweller: 3 Gold — Discover among the minions that DIED last combat, either side
  | 'empowerment' // Albus: 1 Gold — a Shop minion becomes a Discover from the tier above it
  | 'investment' // Bram: 1 Gold/turn banked; the 5th Gold invested pays out a random Gilded minion
  | 'luckySeat' // Croupier Ayse (passive): each Shop roll may arrive Enchanted; 3 Enchanted buys pay a prize
  | 'exhibition' // Odelle (passive): play a minion BETWEEN two others of three distinct types → all three buffed
  | 'buyout' // Harlan: take the whole Shop, then reroll it. 11 Gold, −1 per turn, re-based on use
  | 'soulbind' // Sable: bond your outermost minions for a turn — a stat gain on one mirrors onto the other
  | 'allIn' // Rascal: bank 1 Gold + 2 more per turn since the last use; twice a game
  | 'startingReflector' // Yirin (passive): the run opens with a Reflector token in hand
  | 'commission' // Cassen: pick one of three DELAYED payouts; it matures in 1-3 turns
  | 'devour' // Devourer: 1 Gold — eat a friendly minion, spitting its stats onto a random other friendly
  | 'memory' // Membrance: 1 Gold — restock the Shop with plain copies of your last opponent's board
  | 'baldgecoin' // Juggler (passive): every 3 minions bought → a Carnival Coin (1 Gold + a board buff)
  | 'midasTouch' // Midas (passive): Gild at 2 copies, and a Gild pays a Gold Pouch instead of a Triple Reward
  | 'firstOrLast' // Flash: 1 Gold — claim a copy of the FIRST or LAST minion you kill next combat
  | 'crownTally' // Keshi (passive): bank each purchased card's tier; at 25 grant a Triple Reward, then reset
  | 'preparation' // Aster the Guide (tutorial-only): give a friendly minion +1/+1; recharges every other turn (active, targeted)
  | 'empoweringVines' // Rayse (passive): minions summoned in combat gain +2/+3 and Taunt
  | 'mimic' // Mimic (passive): at the start of EVERY turn, Discover a hero power (2 options) to wield this turn
  | 'voidTwin' // Void (passive): at the start of turn 4, Discover TWO hero powers (sequential 2-option picks) for the rest of the run
  | 'tempest' // Aevor (passive): from 15 run kills, End of Turn gives your left+right-most +4/+4, another +4/+4 per 15
  | 'bladeMastery' // Gorun (passive): a friendly attack grants the attacker +3 Attack for the fight, +3 more per 8 run attacks
  | 'hoard' // Cindara (passive): Avenge (4) summons a Whelp that strikes now, then improves every Whelp you own by +2/+2
  | 'rubyWealth'; // Fibbsy: 1 Gold — get 2 Rubies; usable TWICE per turn

export interface HeroPower {
  name: string;
  /** Full sentence for the tooltip. */
  text: string;
  kind: HeroPowerKind;
  /** Once-per-game powers lock after a single use (vs the default once-per-wave). */
  oncePerGame?: boolean;
  /** Total-game activation cap (Gildmaster: 2). Still gated once-per-turn by `heroReady`; the count rides
   *  in `RunState.heroPowerUses`. Distinct from `oncePerGame` (which is a hard single use). */
  maxUses?: number;
  /** PER-TURN activation cap (Fibbsy: 2). The power may fire this many times each turn, resetting every turn —
   *  unlike `maxUses`, which is a whole-game budget. Gated on `RunState.heroUsesThisTurn` rather than the plain
   *  once-per-turn `heroReady`. Absent = the normal once-per-turn rule. */
  usesPerTurn?: number;
  /** The wave (turn) the power first becomes usable; undefined = turn 1 (available immediately). */
  unlockWave?: number;
  /** Passive powers are always-on (no activation/target) — the panel shows them, but you can't arm them. */
  passive?: boolean;
  /** Active powers that need no target — they fire immediately on click (Nadja's Gold Font). */
  untargeted?: boolean;
  /** Gold cost to activate, spent on use (on top of the once-per-turn / -game gate). 0/undefined = free. */
  cost?: number;
}

export interface HeroDef {
  id: string;
  name: string;
  /** One-line flavour for the hero-select screen. */
  blurb: string;
  /** Starting + max Resolve (the hero's HP). All 30 today; will diverge per hero over time. */
  resolve: number;
  /** Starting Armor — extra effective HP that sits ON TOP of Resolve. Functionally identical to health: loss
   *  damage chips Armor first, then Resolve; it just doesn't regenerate (no max/heal). Varies per hero (2–20
   *  today) as a balance dial — a strong power tends to carry less armor. */
  armor: number;
  power: HeroPower;
  /** Work-in-progress: kept in the registry (so the engine + saves resolve it) but withheld from the hero
   *  picker until it's fully wired. Cleared once the hero ships (Runesmith → when the Runeforge UI lands). */
  wip?: boolean;
  /** PRACTICE-ONLY: playable, but withheld from PLAY mode — the Ascent picker and generated rival seats.
   *  Distinct from `wip`, which hides a hero from every picker including Practice. This is for a hero that
   *  works but is being reworked: the owner can still play it in Practice while it is off the ladder.
   *
   *  **No hero carries this today.** Its only users were Fi + Coran (2026-08-23), and the 2026-08-28 ruling
   *  archived that pair outright — Practice included — so they moved to `wip`. The flag is kept because the
   *  middle ground it expresses ("off the ladder, still playable") is a real one we will want again. */
  practiceOnly?: boolean;
  /** This hero's HENCHMAN (owner spec 2026-08-03): a hero-bound minion recruitable once per run for `cost`
   *  Gold, where the effective price falls every round — WIN −3, LOSS −2 — floored at 0 (`henchmanCostOf`).
   *  The card lives in the global henchman registry (`@game/content` cards/henchmen.ts), never in a shop
   *  pool. Optional while the roster is authored; every hero is meant to carry one eventually. */
  henchman?: { cardId: string; cost: number };
}

export const HEROES: HeroDef[] = [
  {
    id: 'warden',
    name: 'Warden',
    blurb: 'A shield for the one who needs it — bought and paid for in Gold.',
    resolve: 30,
    armor: 11, // owner balance 2026-08-17
    // PLACEHOLDER henchman: proves the whole loop in the Scene Builder (and pins it in tests). The real
    // per-hero roster replaces this as it is designed.
    henchman: { cardId: 'hm_test_squire', cost: 10 },
    power: {
      name: 'Aegis',
      kind: 'grantWard',
      cost: 4,
      // The +X/+Y scales with Tavern Tier, so the printed value is filled in live by `heroPowerText`
      // (the card-text rule). This static string is the fallback shape only.
      text: 'Give a friendly minion permanent **Ward**, and give your minions with **Ward** **+1/+1**.',
    },
  },
  {
    id: 'indy',
    name: 'Indy',
    blurb: 'One perfect moment — gild a single minion and make it count.',
    resolve: 30,
    armor: 12, // owner balance 2026-08-17,
    power: {
      name: 'Masterwork',
      kind: 'gild',
      oncePerGame: true, // one charge at a time; the charge recharges after every 75 Gold spent (see reducer)
      text: 'Make a friendly minion **Gilded**. Recharges after you spend 75 Gold.',
    },
  },
  {
    id: 'myra', // id kept stable (saves / references); display name is Auctioneer
    name: 'Auctioneer',
    blurb: 'A conductor of entrances — call a minion to take its bow again.',
    resolve: 30,
    armor: 10, // owner balance 2026-08-17
    power: {
      name: 'Pulse',
      kind: 'replayBattlecry',
      // `unlockWave: 3` removed (owner ask 2026-08-22) — the Pulse is live from turn 1.
      text: "Trigger a friendly minion's **Shout**.",
    },
  },
  {
    id: 'soren',
    name: 'Soren',
    blurb: 'Death is a doorway — send a minion through it and it blooms back.',
    resolve: 30,
    armor: 10,
    power: {
      name: 'Reclaim',
      kind: 'resummon',
      text: 'Choose a friendly minion. At the start of combat, destroy it and resummon a copy when there is room.',
    },
  },
  {
    id: 'rohan', // id kept stable (saves / references); display name is Yirin
    name: 'Yirin',
    blurb: 'Words sharpen in skilled hands — and sharpen further the more you speak them.',
    resolve: 30,
    armor: 8, // owner balance 2026-08-16: 17 -> 8, alongside the power swap below
    power: {
      // Reworked off `spellAmplify` (owner 2026-08-16). `spellAmplify` stays in the union + `spellStatBonus`
      // as a retired kind — no hero uses it now, and its policy key goes with it (the no-ghosts tripwire).
      name: 'Reflector',
      kind: 'startingReflector',
      passive: true,
      text: 'Start the game with a **Reflector**.',
    },
  },
  {
    id: 'djinn',
    name: 'Djinni',
    blurb: 'Calls the whole board to its close early — once a turn, on your terms.',
    resolve: 30,
    armor: 20,
    wip: true, // disabled by the owner 2026-07-28 (withheld from every picker, incl. Practice)
    power: {
      name: 'Cadence',
      kind: 'replayAllEndOfTurn',
      untargeted: true,
      text: 'Trigger all friendly **End of Turn** effects.',
    },
  },
  {
    id: 'nadja',
    name: 'Nadja',
    blurb: 'The well runs deeper each turn — more Gold, more room to scheme.',
    resolve: 30,
    armor: 17, // owner balance 2026-08-17,
    power: {
      name: 'Goldspring',
      kind: 'gainMaxMana',
      untargeted: true,
      cost: 3,
      text: 'Gain 1 maximum Gold.',
    },
  },
  {
    id: 'cassen',
    name: 'Cassen',
    blurb: 'Every clash leaves a mark — break enough of them and the spoils find you.',
    resolve: 30,
    armor: 13, // re-enabled 2026-08-16 with a brand-new power (owner)
    power: {
      // Reworked off `collision` (owner 2026-08-16). `collision` stays in the union + settleCombat as a
      // retired kind; no hero uses it, so its policy key goes (the no-ghosts rule).
      name: 'Commission',
      kind: 'commission',
      untargeted: true,
      // The offered options change every use, so the live text is built by `heroPowerText`.
      text: 'Choose a commission — it pays out in a few turns.',
    },
  },
  {
    id: 'drakko',
    name: 'Drakko',
    blurb: 'Every entrance is a downbeat — buy enough, and he joins the band.',
    resolve: 30,
    armor: 13,
    power: {
      name: 'Drumline',
      kind: 'quest',
      passive: true, // a quest — the work happens in the buy case, nothing to arm
      oncePerGame: true,
      text: 'After you buy 5 **Shout** minions, get Drakko the Drummer.',
    },
  },
  {
    id: 'chaos',
    name: 'Chaos',
    blurb: 'A bond that transcends all tribes — every kind bends to the connection.',
    resolve: 30,
    armor: 13,
    wip: true, // temporarily withheld from the picker (owner 2026-07-13)
    power: {
      name: 'Chaos Bond',
      kind: 'chaos',
      passive: true,
      text: 'Start with a **Chaos Attachment**. Get another every 5 turns.',
    },
  },
  {
    id: 'robin',
    name: 'Robin',
    blurb: 'Patience pays — every minion sold lines next turn\'s purse.',
    resolve: 30,
    armor: 4, // owner balance 2026-08-17,
    power: {
      name: 'Spoils',
      kind: 'sellGold',
      passive: true,
      text: 'For each minion you sell, gain 1 Gold next turn.',
    },
  },
  {
    id: 'darah',
    name: 'Darah',
    blurb: 'A sleight of fate — trade a piece on your board for a stranger from the tavern.',
    resolve: 30,
    armor: 18,
    power: {
      name: 'Swap',
      kind: 'displace',
      text: 'Swap a friendly minion with a random minion in the Shop.',
    },
  },
  {
    id: 'risen',
    name: 'Lord of the Risen',
    blurb: 'Death is a rehearsal — each turn, one soldier returns for an encore.',
    resolve: 30,
    armor: 14, // owner balance 2026-08-17,
    power: {
      name: 'Undying',
      kind: 'grantReborn',
      text: 'Give a friendly minion **Rise** for the next combat.',
    },
  },
  {
    id: 'gildmaster',
    name: 'Gildmaster',
    blurb: 'The gold never stops coming — a fresh crafter arrives like clockwork.',
    resolve: 30,
    armor: 14,
    power: {
      name: 'Gildcrafter',
      kind: 'gildcrafter',
      cost: 3,
      maxUses: 3, // three times per game
      untargeted: true,
      text: 'When you have **2 copies** of a minion, this grants a third.',
    },
  },
  {
    id: 'discodan',
    name: 'Disco Dan',
    blurb: 'All the hits, none of them ready yet — a hand of tomorrows.',
    resolve: 30,
    armor: 14,
    power: {
      name: 'Setlist',
      kind: 'discoLock',
      passive: true, // resolved at run start (the three locked Discovers) + the play-gate on locked cards
      text: 'On turn 1, Discover Tier 6, Tier 4, and Tier 2 minions. Each unlocks when you reach its Shop tier.',
    },
  },
  {
    // The Tier 7 door, opened early but paid for late: a Summit pick on turn 1 that you cannot play until
    // the run has spent 70 Gold. High armour prices in the tempo you give up sitting on a dead card.
    id: 'brackus',
    name: 'Brackus',
    blurb: 'He shows you the summit on day one. Climbing it is your problem.',
    resolve: 30,
    armor: 11,
    power: {
      name: 'Summit',
      kind: 'summitLock',
      passive: true, // resolved at run start (the locked Tier 7 Discover) + the play-gate on the locked card
      text: 'At the start of the game, **Discover** a **Tier 7** minion. It is locked until you spend **70 Gold**.',
    },
  },
  {
    id: 'baggerben',
    name: 'Rascal',
    blurb: 'The tip jar only ever grows — a little more set aside each turn.',
    resolve: 30,
    armor: 9, // owner balance 2026-08-17
    power: {
      name: 'All In',
      // Reworked off `scalingGold` onto its own kind (owner 2026-08-16): the payout now steps by 2 (not 1)
      // and RE-BASES on use, which the old kind could not express. `scalingGold` stays in the union + reducer
      // as a retired kind (the `possession` precedent) but no hero uses it. The live value is
      // `allInPayoutOf`, shared with the panel tally so the number shown is the number paid.
      kind: 'allIn',
      untargeted: true,
      maxUses: 2, // two activations a game (still once per turn via heroReady) — NOT `oncePerGame`
      text: 'Gain **1 Gold**, plus **2** for every turn since you last used this.',
    },
  },
  {
    id: 'hermithank', // id kept stable (saves / art file); display name is Tradesman
    name: 'Tradesman',
    blurb: 'Cheap to shop, dear to climb — the trader hoards his tiers.',
    resolve: 30,
    armor: 9,
    power: {
      name: 'Frugal',
      kind: 'cheapMinions',
      passive: true,
      text: 'Shop minions cost 2 Gold. Shop upgrades cost 2 more, and rerolls cost 2 Gold.',
    },
  },
  {
    id: 'fi',
    // ARCHIVED 2026-08-28 pending redesign — the quest system is retired (owner: "coran and fi should be
    // archived for now. they will be redesigned and should not show in our hero list for practice nor play").
    // `wip` (not the old `practiceOnly`) is the flag that means exactly that: out of Play AND Practice AND the
    // Mimic/Void/Power-Shifter Discover pools, while the def stays in HEROES so old saves and replays resolve.
    wip: true,
    name: 'Fi',
    blurb: 'Sets out on turn one and never looks back — the road pays early.',
    resolve: 30,
    armor: 11,
    power: {
      name: 'Errand',
      kind: 'heroQuest',
      passive: true, // resolved on the turn-1 advance: a two-option quest Discover from Fi's own list
      text: 'On turn 1, choose one of two **Errands**. Play a minion, cast a spell or upgrade to travel.',
    },
  },
  {
    id: 'chronoshero',
    name: 'Chronos',
    blurb: 'Buy enough endings and time itself enlists.',
    resolve: 30,
    armor: 13,
    wip: true, // disabled by the owner 2026-07-28 (withheld from every picker, incl. Practice)
    power: {
      name: 'Timelapse',
      kind: 'questChronos',
      passive: true, // a quest — resolved in the buy case (buy 4 End-of-Turn minions)
      oncePerGame: true,
      text: 'After you buy 4 **End of Turn** minions, get Chronos.',
    },
  },
  {
    id: 'runesmith',
    name: 'Runesmith',
    blurb: 'The forge fires once — spend well, for its rune lasts the whole climb.',
    resolve: 30,
    armor: 8, // owner balance 2026-08-17,
    power: {
      name: 'Forgemaster',
      kind: 'runeforge',
      passive: true, // fires on the turn-6 advance (opens the Runeforge offer); resolved by `buyRune` / `skipRuneforge`
      oncePerGame: true, // the forge opens exactly once, on turn 5
      text: 'On turn 5, visit the Runeforge.',
    },
  },
  {
    id: 'runeguard',
    name: 'Guardian',
    blurb: 'Sworn to the forge — its greater runes answer only to those who hold the line.',
    resolve: 30,
    armor: 10, // owner balance 2026-08-17,
    power: {
      name: 'Runeguard',
      kind: 'epicRuneforge',
      passive: true, // scheduled at run start (createRun sets `epicForgeWave = 8`); opens via advanceCombat sequencing
      text: 'On turn 8, visit the Epic Runeforge.',
    },
  },
  {
    id: 'coran',
    // ARCHIVED 2026-08-28 pending redesign — the quest system is retired. See Fi above; same ruling.
    wip: true,
    name: 'Coran',
    blurb: 'Reads the whole trail on the first morning — and walks it to the summit.',
    resolve: 30,
    armor: 15,
    power: {
      name: 'Pathfinder',
      kind: 'heroQuest',
      passive: true, // resolved on the turn-1 advance: a two-option quest Discover from Coran's own list
      text: 'On turn 1, choose one of two **Passages**. Play a minion, cast a spell or upgrade to travel.',
    },
  },
  {
    id: 'tiff',
    name: 'Tiff',
    blurb: 'Every wyrm answers her whistle — and the tavern picks up the tab.',
    resolve: 30,
    armor: 12, // owner balance 2026-08-17,
    // Re-added to the pool 2026-08-14 (owner) — the wip withhold is lifted.
    power: {
      name: 'Dragon Tamer',
      kind: 'dragonTamer',
      // Fires immediately: Discover a Dragon. NO static `cost` — the shrinking price (5 − a discount per
      // Dragon/spell bought since the last use, floor 0) is charged in the reducer, and the cost coin shows
      // the LIVE value (the dynamiteDig pattern; a def-level cost would double-charge via the shared block).
      untargeted: true,
      text: '**Discover** a Dragon. Costs **5 Gold** — reduced by 1 when you buy a Dragon or a spell.',
    },
  },
  {
    id: 'jenkins',
    name: 'Jensen',
    blurb: 'Every dig turns up something — for a price that only ever climbs.',
    resolve: 30,
    armor: 15, // re-enabled by the owner 2026-08-17
    power: {
      name: 'Dynamite Dig',
      kind: 'dynamiteDig',
      untargeted: true, // fires immediately: Discover a minion of your tier; the escalating cost is handled in the reducer
      text: 'Discover a minion from your Shop tier. The first is free; each use costs 1 more Gold.',
    },
  },
  {
    id: 'repete',
    name: 'Re-Pete',
    blurb: 'Anything worth having is worth having twice.',
    resolve: 30,
    armor: 13, // owner balance 2026-08-17,
    power: {
      name: 'Second Hand',
      kind: 'secondHand',
      passive: true, // resolved at the END of every 3rd turn (turns 3, 6, 9, …) — in the faceOmen case
      text: 'At the end of every 3rd turn, get a plain copy of the left-most card in your hand.',
    },
  },
  {
    id: 'gorr',
    name: 'Gorr',
    blurb: 'Buy three, and a fourth walks itself home.',
    resolve: 30,
    armor: 13,
    power: {
      name: 'Four Peat',
      kind: 'fourPeat',
      passive: true, // resolved in the buy case: the 3rd minion bought each turn conjures a random plain copy
      text: 'When you buy 3 minions in a turn, get a plain copy of one of them at random.',
    },
  },
  {
    // KINDNESS (owner design 2026-08-26) — the Gift hero. Its power is a PASSIVE schedule, so there is no
    // button to arm: every 4th turn (4, 8, 12, …) it opens a Discover over the whole Gift class.
    // Owner ruling 2026-08-26: fully discoverable — Mimic, Void and Power Shifter may all offer it.
    id: 'kindness',
    name: 'Kindness',
    blurb: 'The best presents are the ones nobody had to ask for.',
    resolve: 30,
    armor: 15,
    power: {
      name: 'Great Presence',
      kind: 'greatPresence',
      cost: 0,
      passive: true, // a schedule — the work happens at start of turn, nothing to arm
      text: 'Discover a **Gift** every 4 turns.',
    },
  },
  {
    id: 'merrin',
    name: 'Merrin',
    blurb: 'There is always a spell in the other pocket.',
    resolve: 30,
    armor: 10,
    power: {
      name: 'Pocket Magic',
      kind: 'pocketMagic',
      cost: 1,
      untargeted: true, // fires immediately: a random Shop spell to hand
      text: 'Get a random Shop spell.',
    },
  },
  {
    id: 'gambler',
    name: 'Gambler',
    blurb: 'The house always wins — unless the house is you.',
    resolve: 30,
    armor: 8, // owner balance 2026-08-17,
    power: {
      name: 'Dice',
      kind: 'dice',
      cost: 1,
      untargeted: true, // roll a die, gain that Gold, then the power locks for that many turns (handled in the reducer)
      text: 'Roll a die: gain that much Gold. This power then locks for that many turns.',
    },
  },
  {
    id: 'xerox',
    name: 'Xerox',
    blurb: 'Why build one when you can print two?',
    resolve: 30,
    armor: 12,
    power: {
      name: 'Copy Machine',
      kind: 'copyMachine',
      oncePerGame: true,
      // Targeted (no `untargeted`): pick a friendly board minion; a plain copy is summoned beside it.
      text: 'Summon a copy of a friendly minion. Needs a free board slot. Once per game.',
    },
  },
  {
    id: 'frank',
    name: 'Frantic Frank',
    blurb: 'Everything must go — today only.',
    resolve: 30,
    armor: 9, // owner balance 2026-08-17,
    power: {
      name: 'Clearance',
      kind: 'clearance',
      cost: 1,
      untargeted: true, // refreshes the Shop + marks its minions 2 Gold this turn; once per turn (heroReady)
      text: 'Refresh the Shop. Its minions cost 2 Gold this turn.',
    },
  },
  {
    id: 'pete',
    name: 'Pete',
    blurb: 'He knows a guy who knows a guy.',
    resolve: 30,
    armor: 9, // owner balance 2026-08-17,
    power: {
      name: 'Contrabanana',
      kind: 'contraband',
      passive: true, // resolved in the roll case: every 3rd refresh upgrades the right-most offer a tier
      text: 'Every third refresh, the right-most Shop minion is from the tier above your Shop tier.',
    },
  },
  {
    id: 'flint',
    name: 'Foreman Flint',
    blurb: 'Union rates. Dwarves come cheap by the dozen.',
    resolve: 30,
    armor: 10,
    power: {
      name: 'Company Rate',
      kind: 'companyRate',
      passive: true, // resolved in the buy case: Dwarf offers cost 2 Gold
      text: 'Dwarves cost 2 Gold.',
    },
  },
  {
    id: 'vale',
    name: 'Emissary',
    blurb: 'Every banner rallies to the same horn.',
    resolve: 30,
    armor: 10, // owner balance 2026-08-17,
    power: {
      name: 'United Front',
      kind: 'unitedFront',
      passive: true, // SoC one-of-each-type buff (in simulate); the live number is printed by `heroPowerText`
      text: 'Start of Combat: give a friendly minion of each type +1/+1 for every spell cast this game.',
    },
  },
  {
    id: 'quillen',
    name: 'Quillen',
    blurb: 'Nothing is ever truly gone — only filed.',
    resolve: 30,
    armor: 10, // owner balance 2026-08-17,
    power: {
      name: 'Archive',
      kind: 'archive',
      // Targeted at a friendly BOARD minion or a SHOP offer. Once per turn (heroReady).
      // The archived TYPES are shown separately by the panel, in each tribe's own colour — a plain string
      // cannot carry that, so the rule stays generic and the state is rendered beside it.
      text: 'Archive a friendly or shop minion. When full, discover a minion of those types.',
    },
  },
  {
    id: 'hunch',
    name: 'Hunch',
    blurb: 'He never forgets a page — he just waits for the price to drop.',
    resolve: 30,
    armor: 10,
    power: {
      name: 'Rounded Spellbook',
      kind: 'roundedSpellbook',
      // NO static `cost` — the shrinking price (3, −1 per turn since the last use, floor 0) is charged in the
      // reducer and the coin shows the LIVE value (the dragonTamer/dynamiteDig pattern; a def-level cost would
      // double-charge via the shared block).
      untargeted: true,
      text: 'Get a copy of the last spell you cast. Costs **3 Gold**, reduced by 1 each turn.',
    },
  },
  {
    id: 'emeraldwarden',
    name: 'Emerald Warden',
    blurb: 'Every door she opens has something waiting on the other side.',
    resolve: 30,
    armor: 8, // owner spec 2026-08-16 — a free minion per tavern-up is a lot of tempo, so the armor is thin
    power: {
      name: 'Vanguard',
      kind: 'vanguard',
      passive: true,
      text: 'When you tier up, get a random minion from the new tier.',
    },
  },
  {
    id: 'underdweller',
    name: 'Underdweller',
    blurb: 'Nothing that falls down here stays lost for long.',
    resolve: 30,
    armor: 9,
    power: {
      name: 'Soulkeeper',
      kind: 'soulkeeper',
      cost: 2, // owner balance 2026-08-16: 3 -> 2
      untargeted: true,
      text: 'Discover a minion that died last combat — from **either** side.',
    },
  },
  {
    id: 'albus',
    name: 'Albus',
    blurb: 'He does not buy what the shop offers. He improves it first.',
    resolve: 30,
    armor: 14,
    power: {
      name: 'Empowerment',
      kind: 'empowerment',
      cost: 1,
      text: 'Choose a Shop minion. Discover a minion from the tier above it for it to become.',
    },
  },
  {
    id: 'devourer',
    name: 'Devourer',
    blurb: 'Nothing is wasted. What one body cannot use, another will.',
    resolve: 30,
    armor: 10,
    power: {
      name: 'Devour',
      kind: 'devour',
      cost: 1,
      text: 'Consume a friendly minion and give its stats to a random other friendly minion.',
    },
  },
  {
    id: 'flash',
    name: 'Flash',
    blurb: 'He only ever watches the opening blow — or the closing one.',
    resolve: 30,
    armor: 9,
    power: {
      name: 'First or Last',
      kind: 'firstOrLast',
      cost: 1,
      // A CHOICE, so the button opens a picker rather than firing (the `commission` pattern). Untargeted in
      // the sense that it takes no board target; the choice itself is the input.
      untargeted: true,
      text: 'Claim a copy of the **first** or **last** minion you kill next combat.',
    },
  },
  {
    id: 'midas',
    name: 'Midas',
    blurb: 'Everything doubles into gold. The third of anything is simply waste.',
    resolve: 30,
    armor: 11,
    power: {
      name: "Midas' Touch",
      kind: 'midasTouch',
      passive: true,
      text: 'You need only **2** copies to Gild. Gilding grants a **Gold Pouch** instead of a Triple Reward.',
    },
  },
  {
    id: 'juggler',
    name: 'Juggler',
    blurb: 'Coins go up, coins come down. Somebody always ends up richer.',
    resolve: 30,
    armor: 12,
    power: {
      name: 'Carnival Coin',
      kind: 'baldgecoin',
      passive: true,
      text: 'Every **3** minions you buy, get a **Carnival Coin**.',
    },
  },
  {
    id: 'membrance',
    name: 'Membrance',
    blurb: 'She remembers every board that ever stood against her — and sells you the copy.',
    resolve: 30,
    armor: 8,
    power: {
      name: 'Memory',
      kind: 'memory',
      cost: 1,
      untargeted: true,
      text: "Refresh the Shop with plain copies of your last opponent's board.",
    },
  },
  {
    id: 'bram', // id kept stable (saves / art file); display name is Braum
    name: 'Braum',
    blurb: 'Small deposits, patiently made. The vault pays out in gold leaf.',
    resolve: 30,
    armor: 16,
    power: {
      name: 'Investment',
      kind: 'investment',
      cost: 1,
      untargeted: true,
      text: 'Invest **1 Gold**. After investing **5**, get a random **Gilded** minion, then reset.',
    },
  },
  {
    // The ID stays `cia` through the rename to Ayse (owner 2026-08-22) — the same rule Yirin (`rohan`) and
    // Chaos (`symbiote`) follow. Ids key SAVES, baked opponent boards, replays, art files (`cia.png`,
    // `cia-hearts.png`) and every `power.kind === 'luckySeat'` site; the display NAME is the only thing a
    // player ever sees, so renaming the id would break old runs to change nothing on screen.
    id: 'cia',
    name: 'Ayse',
    blurb: 'The house always seats you somewhere interesting.',
    resolve: 30,
    armor: 10,
    power: {
      name: 'Lucky Seat',
      kind: 'luckySeat',
      passive: true,
      text: 'Buy **3** Enchanted cards for a reward.',
    },
  },
  {
    id: 'odelle',
    name: 'Odelle',
    blurb: 'She curates the row. Nothing beside anything it merely repeats.',
    resolve: 30,
    armor: 10, // owner balance 2026-08-17,
    power: {
      name: 'Exhibition',
      kind: 'exhibition',
      passive: true,
      text: 'Play a minion between two others of three different types: all three gain **+1/+1**. Improves **+1/+1** every 4 cards played.',
    },
  },
  {
    id: 'harlan',
    name: 'Harlan',
    blurb: 'He does not browse. He buys the shelf.',
    resolve: 30,
    armor: 9,
    power: {
      name: 'Buyout',
      // NO static `cost`: the shrinking price (11, −1 per turn, re-based on use) is charged in the reducer and
      // the coin shows the live value — the dragonTamer/roundedSpellbook pattern. A def-level cost would
      // double-charge through the shared block.
      kind: 'buyout',
      untargeted: true,
      text: 'Take every card in the Shop, then refresh it. Costs **11 Gold**, reduced by 1 each turn.',
    },
  },
  {
    id: 'sable',
    name: 'Sable',
    blurb: 'Two ends of one chain. Pull on either and both come along.',
    resolve: 30,
    armor: 10,
    power: {
      name: 'Soulbind',
      kind: 'soulbind',
      untargeted: true,
      maxUses: 3, // three activations a game (still once per turn via heroReady)
      text: 'Bind your left-most and right-most minions this turn: stats gained by one are gained by the other.',
    },
  },
  {
    id: 'keshi',
    name: 'Keshi the Protector',
    blurb: 'Tend the tavern and it tends you — every card bought coaxes the crown into bloom.',
    resolve: 30,
    armor: 10, // owner spec 2026-08-16 — a repeatable run-long Triple Reward engine, so the armor sits with
    //            the strong-passive band (Flint/Pete/Merrin 10) rather than the quest heroes' 13
    power: {
      name: 'Keshi’s Crown',
      kind: 'crownTally',
      passive: true,
      text: 'Get a **Triple Reward** every 25 shop tiers worth of cards you purchase.',
    },
  },
  {
    id: 'rayse',
    name: 'Rayse',
    blurb: 'Everything that grows through her garden comes out thorned.',
    resolve: 30,
    armor: 14,
    power: {
      name: 'Empowering Vines',
      kind: 'empoweringVines',
      passive: true, // combat-side: threaded into simulate via questCombatMods (the Hatchery channel)
      text: 'Minions summoned in combat gain **+2/+3** and **Taunt**.',
    },
  },
  // ── Batch 2026-08-23 (owner spec). Three passives, each riding a RUN-LIFETIME tally that combat already
  // counts and carries back: `questTally.slaughter` (kills) for Aevor, `questTally.attack` for Gorun, and a
  // banked Whelp level for Cindara. Nothing here needed a new counter — only somewhere to keep the total.
  {
    id: 'aevor',
    name: 'Aevor',
    blurb: 'The storm keeps its own count, and settles it at dusk.',
    resolve: 30,
    armor: 16,
    power: {
      name: 'Tempest',
      kind: 'tempest',
      passive: true, // recruit-side: fires from `applyEndOfTurn`; the live numbers come from `heroPowerText`
      text: 'Unlocks after your minions kill **15** enemies. **End of Turn:** give your left and right-most minions **+4/+4**. Upgrades every **15** kills.',
    },
  },
  {
    id: 'gorun',
    name: 'Gorun',
    blurb: 'Every swing is a lesson, and he has never stopped taking notes.',
    resolve: 30,
    armor: 11,
    power: {
      name: 'Blade Mastery',
      kind: 'bladeMastery',
      passive: true, // combat-side: threaded into simulate via questCombatMods, per side
      text: 'When your minions attack, give them **+3 Attack**. Improves every **8** attacks.',
    },
  },
  {
    id: 'cindara',
    name: 'Cindara',
    blurb: 'She counts the fallen in scales, and the pile only ever grows.',
    resolve: 30,
    armor: 9,
    power: {
      name: 'Hoard',
      kind: 'hoard',
      passive: true, // combat-side: an Avenge (4) registration in simulate, banked run-wide between fights
      text: '**Avenge (4):** summon a **1/1** Whelp that attacks immediately. Improve your Whelps **+2/+2**.',
    },
  },
  {
    id: 'fibbsy',
    name: 'Fibbsy',
    blurb: 'Turns a single coin into a fistful of gems, twice over, every morning.',
    resolve: 30,
    armor: 15,
    power: {
      name: 'Ruby Wealth',
      kind: 'rubyWealth',
      cost: 1,
      untargeted: true, // fires on click — no board target
      usesPerTurn: 2,
      text: 'Get **2 Rubies**. Usable **twice** per turn.',
    },
  },
  {
    id: 'mimic',
    name: 'Mimic',
    blurb: 'Whoever you needed today — that is who sat down.',
    resolve: 30,
    armor: 10,
    power: {
      name: 'Mimicry',
      kind: 'mimic',
      passive: true, // resolved by the turn-start power Discover; the ADOPTED power is what the run wields
      text: 'At the start of every turn, **Discover** a hero power to wield this turn.',
    },
  },
  {
    id: 'voidhero',
    name: 'Void',
    blurb: 'It reached into the space between heroes and pulled out two.',
    resolve: 30,
    armor: 14,
    power: {
      name: 'Twin Voids',
      kind: 'voidTwin',
      passive: true, // resolved on the turn-4 advance: two sequential power Discovers, kept for the run
      text: 'On turn 4, **Discover** two hero powers to keep for the rest of the run.',
    },
  },
  {
    // TUTORIAL-ONLY hero for the Learn Ascent course. `wip: true` keeps it in the registry (so the engine and
    // saves resolve it) while hiding it from every picker + opponent seat — the tutorial hands it out by
    // passing `heroId: 'aster'` explicitly. A tutorial-only hero means roster balance changes can never break
    // the course (blueprint §6.2). Its power is deliberately simple: an active, targeted, fixed +1/+1.
    id: 'aster',
    name: 'Aster, the Guide',
    blurb: 'Steady hands for a first climb — a little help, right where it’s needed.',
    resolve: 30,
    armor: 15,
    wip: true,
    power: {
      name: 'Preparation',
      kind: 'preparation',
      text: 'Give a friendly minion **+1/+1**. Recharges every other turn.',
    },
  },
];

/**
 * TURNS REMAINING on a recharge-locked hero power, or 0 when it is available.
 *
 * `RunState.heroReady` is NOT the whole story for these powers: it resets to `true` on every wave advance, so
 * a power that recharges every OTHER turn reads "ready" on its locked turn. Each such power carries its own
 * `…LockUntil` wave, and THAT is the real gate the reducer checks. Two consumers must agree with the reducer
 * or they lie to the player: the hero-power BUTTON (a locked power must not look armed — clicking it no-ops)
 * and the TUTORIAL's `heroPowerReady` predicate (a coached "use your power" step must clear itself on a
 * locked turn instead of waiting forever). Found 2026-08-21: Aster's Preparation had neither, which
 * hard-locked the tutorial's round-2 power step.
 */
export function heroPowerLockTurns(run: {
  wave: number;
  heroDiceLockUntil?: number;
  preparationLockUntil?: number;
}, powerKind: HeroPowerKind): number {
  if (powerKind === 'dice') return Math.max(0, (run.heroDiceLockUntil ?? 0) - run.wave);
  if (powerKind === 'preparation') return Math.max(0, (run.preparationLockUntil ?? 0) - run.wave);
  return 0;
}

/**
 * How many copies a Gild (triple) needs for this run — 3 normally, 2 under Rune of Twin Gilding or Midas'
 * Touch (either one is enough; they cannot stack down to 1).
 *
 * Shared so the SHOP'S "buying this completes a Gild" indicator and the reducer's `checkTriples` can never
 * disagree. They did: the indicator hardcoded "you already hold 2", so a Midas player — who Gilds at 2 — got
 * no highlight on the duplicate that would have completed it right now (owner report 2026-08-21).
 */
export function gildCopiesNeeded(run: { heroId: string; runeTwinGilding?: boolean; gildCopies?: number; adoptedPowerId?: string; mimicPowerId?: string; voidPowerIds?: string[] }): number {
  // Coran's Gilded Shortcut writes the count it grants straight into `gildCopies`, so a future "Gild at 2"
  // source needs no new branch here — and the sources cannot stack down to 1 (each only ever says 2).
  if (run.gildCopies) return Math.max(2, Math.min(3, run.gildCopies));
  // `hasPower`, not the hero id: a Mimic wearing Midas' Touch (or a Void holding it) Gilds at 2 exactly as
  // Midas does — the wielded power is the rule, the id is just the portrait (2026-08-22 hardening pass).
  return run.runeTwinGilding || hasPower(run, 'midasTouch') ? 2 : 3;
}

/**
 * DYNAMIC POWER RESOLUTION (Mimic / Void, 2026-08-22).
 *
 * Until these two heroes, "the hero's power" and `getHero(run.heroId).power` were the same thing, and ~130
 * sites read it directly. Mimic WIELDS a different hero's power each turn (`adoptedPowerId`) and Void wields
 * TWO for the run (`voidPowerIds`), so behaviour sites now ask `hasPower(run, kind)` / `activePowers(run)`
 * instead. `getHero(run.heroId).power` remains correct for IDENTITY sites — scheduling keyed to the native
 * hero (Fi/Coran's turn-1 quest, Runesmith's forge), beat identity, save/opponent keys — which is why the
 * accessor is additive rather than a rewrite of getHero.
 */
interface PowerCarrier { heroId: string; adoptedPowerId?: string; mimicPowerId?: string; voidPowerIds?: string[] }

/** The power(s) this run is wielding RIGHT NOW — one for everyone, one adopted for Mimic, two for a
 *  post-turn-4 Void. Before Mimic's first pick / Void's turn 4, the base placeholder power stands. */
export function activePowers(run: PowerCarrier): HeroPower[] {
  const base = HERO_INDEX[run.heroId]?.power ?? HEROES[0]!.power;
  // VOID's pair first: it is the only carrier that wields TWO, and Power Shifter replaces its slot 0 in place
  // (see `pickPower`) rather than collapsing the pair to one.
  if (base.kind === 'voidTwin' && run.voidPowerIds?.length) return run.voidPowerIds.map((id) => getHero(id).power);
  // An ADOPTED power replaces the native one for ANY hero — Mimic's per-turn disguise, or Power Shifter's
  // permanent swap on a hero who never had a Discover of their own. `mimicPowerId` is the pre-rename key,
  // read so a run saved between the two same-day merges keeps its disguise.
  const adopted = run.adoptedPowerId ?? run.mimicPowerId;
  if (adopted && HERO_INDEX[adopted]) return [getHero(adopted).power];
  return [base];
}

/** Does ANY currently-wielded power have this kind? The drop-in replacement for
 *  `getHero(run.heroId).power.kind === kind` at every BEHAVIOUR site. */
export function hasPower(run: PowerCarrier, kind: HeroPowerKind): boolean {
  return activePowers(run).some((p) => p.kind === kind);
}

/** The slot-0 power — what the main power button shows and fires. */
export function primaryPower(run: PowerCarrier): HeroPower {
  return activePowers(run)[0]!;
}

/**
 * ⚠️ ADDING A HERO? ASK THE OWNER WHETHER ITS POWER JOINS THE DISCOVERABLE POOL. (standing instruction,
 * owner 2026-08-22.)
 *
 * A new hero is offerable by DEFAULT — the pools below are deny-lists, so anything not named here becomes a
 * Mimic disguise, a Void pick and a Power Shifter option the moment it ships. That default is usually right,
 * but it is never automatic: a power that only acts at run creation, is tied to a schedule, or would be
 * degenerate on a one-turn Mimic disguise belongs in an exclusion list instead. Three consumers ride this
 * one decision — Mimic, Void, and the Power Shifter spell — so the question is worth asking once per hero
 * rather than discovering the answer in play.
 */
/** Power kinds that no live hero carries (or that only ever act at run creation) — never discoverable. */
const UNDISCOVERABLE_KINDS = new Set<HeroPowerKind>([
  'possession', 'recurringGoldcrafter', 'replayEndOfTurn', 'lesserQuest', 'pathfinder', // retired
  'mimic', 'voidTwin', // the discoverers themselves
  'heroQuest', 'preparation', // turn-1 identity / tutorial-only
]);

/** Owner's exclusion list for MIMIC (2026-08-22), by hero id (display names in the spec):
 *  Yirin, Drakko, Disco Dan, Cassen, Fi, Runesmith, Guardian, Coran, Re-Pete, Emissary, Quillen, Braum, Keshi.
 *  Power Shifter draws from THIS same list (see `powerDiscoverPool('mimic')` in reducer + recruit), so an id
 *  here is out of both. + Brackus (owner 2026-08-24): his Summit is a START-OF-GAME Tier-7 Discover, so
 *  adopting it mid-run does nothing but burn the pick. Still available to Void, which the owner did not ask
 *  to change. */
const MIMIC_EXCLUDED = new Set(['rohan', 'drakko', 'discodan', 'cassen', 'fi', 'runesmith', 'runeguard', 'coran', 'repete', 'vale', 'quillen', 'bram', 'keshi', 'brackus']);

/** Owner's exclusion list for VOID (2026-08-22): Disco Dan, Runesmith, Coran, Fi, Emissary. */
const VOID_EXCLUDED = new Set(['discodan', 'runesmith', 'coran', 'fi', 'vale']);

/**
 * The hero ids whose powers a power-Discover may offer. `who` picks the owner's exclusion list; `exclude`
 * drops ids already taken this pick sequence (Void's second Discover must not re-offer the first).
 * `wip` heroes (Aster) never appear — same rule every picker follows.
 */
/** The heroes PLAY mode may use — the Ascent picker and generated rival seats. Practice deliberately does not
 *  call this: a `practiceOnly` hero is still fully playable there. `wip` heroes are out of both. */
export function playableHeroes(): HeroDef[] {
  return HEROES.filter((h) => !h.wip && !h.practiceOnly);
}

/** The heroes PRACTICE may use — everything except `wip`. */
export function practiceHeroes(): HeroDef[] {
  return HEROES.filter((h) => !h.wip);
}

export function powerDiscoverPool(who: 'mimic' | 'void', exclude: readonly string[] = []): string[] {
  const banned = who === 'mimic' ? MIMIC_EXCLUDED : VOID_EXCLUDED;
  return HEROES
    .filter((h) => !h.wip && !banned.has(h.id) && !UNDISCOVERABLE_KINDS.has(h.power.kind) && !exclude.includes(h.id))
    .map((h) => h.id);
}

/** Rohan's Attunement bonus: +1/+1 to stat-granting spells, rising by 1 every 10 spells CAST this run
 *  (+1 for casts 0–9, +2 for 10–19, +3 for 20–29, …). Keyed off `RunState.spellsCast`. A starting dial. */
export function spellAmplifyBonus(spellsCast: number): number {
  return 1 + Math.floor(spellsCast / 10);
}

export const HERO_INDEX: Record<string, HeroDef> = Object.fromEntries(
  HEROES.map((h) => [h.id, h]),
);

export const DEFAULT_HERO_ID = 'warden';

/** Legacy hero-id aliases — old saves and baked opponent boards may carry a since-renamed id (Symbiote→Chaos). */
const HERO_ID_ALIAS: Record<string, string> = { symbiote: 'chaos' };

/** Resolve a hero by id, falling back to the default so a bad/old save never crashes. */
export function getHero(id: string | undefined): HeroDef {
  const resolved = id ? (HERO_ID_ALIAS[id] ?? id) : id;
  return (resolved && HERO_INDEX[resolved]) || HERO_INDEX[DEFAULT_HERO_ID];
}
