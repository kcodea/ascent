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
  | 'discoLock' // Disco Dan (passive): turn-1 sequential Discover T6→T4→T2, each locked in hand until that shop tier
  | 'questChronos' // Chronos (passive): buy 4 End-of-Turn minions → get a Chronos (resolved in the buy case)
  | 'lesserQuest' // Fi (passive): an extra, lower-tier quest shop on turn 3
  | 'collision' // Cassen (passive): after killing 5 enemy minions, get a minion of your most common type (carry-back)
  | 'quest' // Drakko (passive): buy 5 Battlecry minions → get Drakko the Drummer (resolved in the buy case)
  | 'chaos' // Chaos (passive): starts with a 1/1 all-type Magnetic token; gets another at the start of every 5th turn
  | 'sellGold' // Robin (passive): each minion you sell banks +1 Gold for the START of next turn
  | 'displace' // Darah: swap a friendly minion with a random tavern minion (active, targeted)
  | 'grantReborn' // Lord of the Risen: give a friendly minion Rise for the next combat (active, targeted)
  | 'recurringGoldcrafter' // Gildmaster (passive): get a Goldcrafter (gild-a-minion spell) every 4 turns
  | 'runeforge' // Runesmith (passive): on turn 7 the Runeforge opens — buy ONE of a random 3 runes (a run-long buff)
  | 'epicRuneforge' // Runeguard (passive): the EPIC Runeforge opens on turn 12 (scheduled via `epicForgeWave` at run start)
  | 'pathfinder' // Coran (passive): skips the turn-5 quest; gets the turn-11 (late) quest early, on turn 7
  | 'dynamiteDig'; // Jenkins: 1 Gold Discover a minion of your tier — costs 1 more Gold each use (active, untargeted)

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
      text: 'Spend 4 Gold: give a friendly minion a **Ward** (permanent). (Once per turn)',
    },
  },
  {
    id: 'indy',
    name: 'Indy',
    blurb: 'One perfect moment — gild a single minion and make it count.',
    resolve: 30,
    armor: 15,
    power: {
      name: 'Gild',
      kind: 'gild',
      oncePerGame: true, // one charge at a time; the charge recharges after every 40 Gold spent (see reducer)
      text: 'Gild: Make a friendly minion golden. Refreshes after you spend 40 Gold.',
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
      text: "Pulse: Trigger a friendly minion's Battlecry effect. (Once per turn)",
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
      text: 'Reclaim: Mark a minion. At the start of combat, that minion is destroyed and returns when possible.',
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
      text: 'Attunement: Spells gain +1/+1. Improve this every 10 spells cast.',
    },
  },
  {
    id: 'djinn',
    name: 'Djinn',
    blurb: 'Calls the whole board to its close early — once a turn, on your terms.',
    resolve: 30,
    armor: 15,
    power: {
      name: 'Cadence',
      kind: 'replayAllEndOfTurn',
      untargeted: true,
      text: 'Cadence: Trigger EVERY friendly minion\'s End of Turn effect. (Once per turn)',
    },
  },
  {
    id: 'nadja',
    name: 'Nadja',
    blurb: 'The well runs deeper each turn — more Gold, more room to scheme.',
    resolve: 30,
    armor: 19,
    power: {
      name: 'Gold Font',
      kind: 'gainMaxMana',
      untargeted: true,
      cost: 3,
      text: 'Gold Font: Spend 3 Gold to gain +1 max Gold permanently.',
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
      text: 'Collision: After you kill 5 enemy minions, get a minion of your most common type.',
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
      text: 'Drumline: Buy 5 Battlecry minions to get Drakko the Drummer. (Once per game)',
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
      text: 'Start with a **Chaos Attachment** in hand. Get another at the start of every 5th turn.',
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
      text: 'When you sell a minion, gain 1 Gold at the start of next turn.',
    },
  },
  {
    id: 'darah',
    name: 'Darah',
    blurb: 'A sleight of fate — trade a piece on your board for a stranger from the tavern.',
    resolve: 30,
    armor: 12,
    power: {
      name: 'Displace',
      kind: 'displace',
      text: 'Choose a friendly minion — swap it with a random minion in the tavern.',
    },
  },
  {
    id: 'risen',
    name: 'Lord of the Risen',
    blurb: 'Death is a rehearsal — each turn, one soldier returns for an encore.',
    resolve: 30,
    armor: 8,
    power: {
      name: 'Rise Again',
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
      text: 'Get a **Goldcrafter** every 4 turns (a spell that makes a friendly minion golden).',
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
      text: 'Turn 1: Discover a Tier 6, then Tier 4, then Tier 2 minion. Each is locked in your hand until you reach that shop tier.',
    },
  },
  {
    id: 'baggerben',
    name: 'Bagger Ben',
    blurb: 'The tip jar only ever grows — a little more set aside each turn.',
    resolve: 30,
    armor: 15,
    power: {
      name: 'Bag It',
      kind: 'scalingGold',
      untargeted: true,
      oncePerGame: true,
      text: 'Bag It: Gain Gold now — the payout grows +1 every turn you wait. (Once per game)',
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
      text: 'Shop minions cost 2 Gold. Tavern upgrades cost 2 more. Rerolls cost 2.',
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
      passive: true, // resolved on the turn-3 advance (an extra, lower-tier quest offer)
      text: 'Turn 3: choose from an extra, lower-tier quest.',
    },
  },
  {
    id: 'chronoshero',
    name: 'Chronos',
    blurb: 'Buy enough endings and time itself enlists.',
    resolve: 30,
    armor: 8,
    power: {
      name: 'Encore',
      kind: 'questChronos',
      passive: true, // a quest — resolved in the buy case (buy 4 End-of-Turn minions)
      oncePerGame: true,
      text: 'Encore: Buy 4 End-of-Turn minions to get a Chronos. (Once per game)',
    },
  },
  {
    id: 'runesmith',
    name: 'Runesmith',
    blurb: 'The forge fires once — spend well, for its rune lasts the whole climb.',
    resolve: 30,
    armor: 8,
    power: {
      name: 'Runeforge',
      kind: 'runeforge',
      passive: true, // fires on the turn-6 advance (opens the Runeforge offer); resolved by `buyRune` / `skipRuneforge`
      oncePerGame: true, // the forge opens exactly once, on turn 7
      text: 'Runeforge: On turn 7, buy one of a random 3 Runes (re-roll once for 2 Gold) — a permanent buff for the run.',
    },
  },
  {
    id: 'runeguard',
    name: 'Runeguard',
    blurb: 'Sworn to the forge — its greater runes answer only to those who hold the line.',
    resolve: 30,
    armor: 8,
    power: {
      name: 'Defend the Forge',
      kind: 'epicRuneforge',
      passive: true, // scheduled at run start (createRun sets `epicForgeWave = 10`); opens via advanceCombat sequencing
      text: 'Defend the Forge: Visit the Epic Runeforge on turn 12 — buy one Epic Rune (a permanent buff for the run).',
    },
  },
  {
    id: 'coran',
    name: 'Coran',
    blurb: 'Reads the trail ahead — the great trials come early, the small ones not at all.',
    resolve: 30,
    armor: 10,
    power: {
      name: 'Pathfinder',
      kind: 'pathfinder',
      passive: true, // resolved on the turn-advance quest schedule (skips the turn-5 quest; the turn-11 quest arrives on turn 7)
      text: 'Pathfinder: You skip the first quest, and reach your big quest early — on turn 7 instead of turn 11.',
    },
  },
  {
    id: 'jenkins',
    name: 'Jenkins',
    blurb: 'Every dig turns up something — for a price that only ever climbs.',
    resolve: 30,
    armor: 10,
    power: {
      name: 'Dynamite Dig',
      kind: 'dynamiteDig',
      untargeted: true, // fires immediately: Discover a minion of your tier; the escalating cost is handled in the reducer
      text: 'Dynamite Dig: Spend 1 Gold to Discover a minion of your tier. Costs 1 more Gold each use.',
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
