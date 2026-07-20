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
  | 'gild' // Indy: make a friendly minion Golden (recharges after every 40 Gold spent)
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
  | 'lesserQuest' // Fi (passive): an extra, lower-tier quest shop on turn 4
  | 'collision' // Cassen (passive): after killing 5 enemy minions, get a minion of your most common type (carry-back)
  | 'quest' // Drakko (passive): buy 5 Battlecry minions → get Drakko the Drummer (resolved in the buy case)
  | 'chaos' // Chaos (passive): starts with a 1/1 all-type Magnetic token; gets another at the start of every 5th turn
  | 'sellGold' // Robin (passive): each minion you sell banks +1 Gold for the START of next turn
  | 'displace' // Darah: swap a friendly minion with a random tavern minion (active, targeted)
  | 'grantReborn' // Lord of the Risen: give a friendly minion Rise for the next combat (active, targeted)
  | 'recurringGoldcrafter' // Gildmaster (passive): get a Goldcrafter (gild-a-minion spell) every 4 turns
  | 'runeforge' // Runesmith (passive): on turn 7 the Runeforge opens — buy ONE of a random 3 runes (a run-long buff)
  | 'epicRuneforge' // Guardian (passive): the EPIC Runeforge opens on turn 10 (scheduled via `epicForgeWave` at run start)
  | 'pathfinder' // Coran (passive): a bonus late-bucket (Capstone) quest on turn 10, on top of the normal 5 & 11
  | 'dynamiteDig' // Jensen: Discover a minion of your tier — free first, +1 Gold each later use (active, untargeted)
  | 'dragonTamer' // Tiff: 5 Gold Discover a Dragon — the cost drops 1 per Dragon/spell bought, resetting on use
  | 'secondHand' // Re-Pete (passive): at the END of every 3rd turn, a plain copy of the left-most card in hand (conjured, no pool take)
  | 'possession' // RETIRED with Atrius (2026-07-20). Kept so saves/replays of old runs still resolve;
  //                the Start-of-Combat machinery in simulate.ts remains as an unused primitive.
  | 'fourPeat'; // Gorr (passive): buy 3 minions in one turn → a plain copy of one of them at random (once/turn)

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
   *  damage chips Armor first, then Resolve; it just doesn't regenerate (no max/heal). Varies per hero (8–19
   *  today) as a balance dial — a strong power tends to carry less armor. */
  armor: number;
  power: HeroPower;
  /** Work-in-progress: kept in the registry (so the engine + saves resolve it) but withheld from the hero
   *  picker until it's fully wired. Cleared once the hero ships (Runesmith → when the Runeforge UI lands). */
  wip?: boolean;
}

export const HEROES: HeroDef[] = [
  {
    id: 'warden',
    name: 'Warden',
    blurb: 'A shield for the one who needs it — bought and paid for in Gold.',
    resolve: 30,
    armor: 12,
    wip: true, // temporarily withheld from the picker (owner 2026-07-13)
    power: {
      name: 'Aegis',
      kind: 'grantWard',
      cost: 4,
      text: 'Give a friendly minion permanent **Ward**.',
    },
  },
  {
    id: 'indy',
    name: 'Indy',
    blurb: 'One perfect moment — gild a single minion and make it count.',
    resolve: 30,
    armor: 15,
    power: {
      name: 'Masterwork',
      kind: 'gild',
      oncePerGame: true, // one charge at a time; the charge recharges after every 40 Gold spent (see reducer)
      text: 'Make a friendly minion **Gilded**. Recharges after you spend 40 Gold.',
    },
  },
  {
    id: 'myra',
    name: 'Myra',
    blurb: 'A conductor of entrances — call a minion to take its bow again.',
    resolve: 30,
    armor: 15,
    wip: true, // temporarily withheld from the picker (owner 2026-07-13)
    power: {
      name: 'Pulse',
      kind: 'replayBattlecry',
      unlockWave: 3,
      text: "Trigger a friendly minion's **Shout**.",
    },
  },
  {
    id: 'soren',
    name: 'Soren',
    blurb: 'Death is a doorway — send a minion through it and it blooms back.',
    resolve: 30,
    armor: 8,
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
    armor: 15,
    power: {
      name: 'Attunement',
      kind: 'spellAmplify',
      passive: true,
      text: 'Your spells give +1/+1 more. Improves every 10 spells you cast.',
    },
  },
  {
    id: 'djinn',
    name: 'Djinni',
    blurb: 'Calls the whole board to its close early — once a turn, on your terms.',
    resolve: 30,
    armor: 15,
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
    armor: 19,
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
    armor: 8,
    power: {
      name: 'Collision',
      kind: 'collision',
      passive: true, // a carry-back — the work happens after combat (settleCombat), nothing to arm
      text: 'Every 5 enemy minions you kill, get a minion of your most common type.',
    },
  },
  {
    id: 'drakko',
    name: 'Drakko',
    blurb: 'Every entrance is a downbeat — buy enough, and he joins the band.',
    resolve: 30,
    armor: 8,
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
    armor: 8,
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
    armor: 8,
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
    armor: 12,
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
    armor: 8,
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
    armor: 15,
    power: {
      name: 'Goldcrafter',
      kind: 'recurringGoldcrafter',
      passive: true, // resolved at each turn setup (turns 4, 8, 12, …) — conjures a Goldcrafter to hand
      text: 'Every 4 turns, get a **Goldcrafter**.',
    },
  },
  {
    id: 'discodan',
    name: 'Disco Dan',
    blurb: 'All the hits, none of them ready yet — a hand of tomorrows.',
    resolve: 30,
    armor: 15,
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
    armor: 15,
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
    armor: 15,
    power: {
      name: 'All In',
      kind: 'scalingGold',
      untargeted: true,
      oncePerGame: true,
      text: 'Gain Gold. The amount increases by 1 each turn you wait.',
    },
  },
  {
    id: 'hermithank', // id kept stable (saves / art file); display name is Tradesman
    name: 'Tradesman',
    blurb: 'Cheap to shop, dear to climb — the trader hoards his tiers.',
    resolve: 30,
    armor: 8,
    power: {
      name: 'Frugal',
      kind: 'cheapMinions',
      passive: true,
      text: 'Shop minions cost 2 Gold. Shop upgrades cost 2 more, and rerolls cost 2 Gold.',
    },
  },
  {
    id: 'fi',
    name: 'Fi',
    blurb: 'An early errand for an early edge — a small quest, ahead of schedule.',
    resolve: 30,
    armor: 8,
    power: {
      name: 'Errand',
      kind: 'lesserQuest',
      passive: true, // resolved on the turn-4 advance (an extra, lower-tier quest offer)
      text: 'On turn 4, choose an extra **Lesser Quest**.',
    },
  },
  {
    id: 'chronoshero',
    name: 'Chronos',
    blurb: 'Buy enough endings and time itself enlists.',
    resolve: 30,
    armor: 8,
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
    armor: 8,
    power: {
      name: 'Forgemaster',
      kind: 'runeforge',
      passive: true, // fires on the turn-6 advance (opens the Runeforge offer); resolved by `buyRune` / `skipRuneforge`
      oncePerGame: true, // the forge opens exactly once, on turn 7
      text: 'On turn 7, visit the Runeforge.',
    },
  },
  {
    id: 'runeguard',
    name: 'Guardian',
    blurb: 'Sworn to the forge — its greater runes answer only to those who hold the line.',
    resolve: 30,
    armor: 8,
    power: {
      name: 'Runeguard',
      kind: 'epicRuneforge',
      passive: true, // scheduled at run start (createRun sets `epicForgeWave = 10`); opens via advanceCombat sequencing
      text: 'On turn 10, visit the Epic Runeforge.',
    },
  },
  {
    id: 'coran',
    name: 'Coran',
    blurb: 'Reads the trail ahead — and calls down an extra great trial before the summit.',
    resolve: 30,
    armor: 10,
    power: {
      name: 'Pathfinder',
      kind: 'pathfinder',
      passive: true, // resolved on the turn-advance quest schedule (a bonus turn-11-bucket quest on turn 10, on top of the normal 5 & 11)
      text: 'On turn 10, choose an extra late-game Quest.',
    },
  },
  {
    id: 'tiff',
    name: 'Tiff',
    blurb: 'Every wyrm answers her whistle — and the tavern picks up the tab.',
    resolve: 30,
    armor: 14,
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
    armor: 10,
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
    armor: 9,
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
    armor: 10,
    power: {
      name: 'Four Peat',
      kind: 'fourPeat',
      passive: true, // resolved in the buy case: the 3rd minion bought each turn conjures a random plain copy
      text: 'When you buy 3 minions in a turn, get a plain copy of one of them at random.',
    },
  },
];

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
