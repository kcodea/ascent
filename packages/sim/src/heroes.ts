/**
 * Heroes — data-driven, like cards. A hero is an id, a name, and a hero power.
 * The reducer (`heroPower` action) resolves the power by `kind`; the UI reads the
 * same registry to draw the hero panel and the (eventual) hero-select screen.
 *
 * Adding a hero = a new entry here + (only if it needs a brand-new effect) a new
 * `kind` branch in the reducer. No bespoke classes, no scene plumbing per hero.
 */

export type HeroPowerKind =
  | 'fortify' // Warden: give a minion +Tier/+Tier (scales with Tavern Tier)
  | 'gild' // Indy: make a friendly minion Golden
  | 'replayBattlecry' // Myra: re-trigger a friendly minion's Battlecry
  | 'replayEndOfTurn' // Djinn: proc a friendly minion's End of Turn now
  | 'resummon' // Soren: at start of combat, destroy a marked minion (procs its Deathrattle) + resummon a copy
  | 'spellAmplify' // Rohan (passive): stat-granting spells give +X/+X more, X scaling every 3 waves
  | 'gainMaxMana' // Nadja: gain +1 max Gold permanently (id stays `gainMaxMana`)
  | 'collision' // Cassen (passive): after killing 5 enemy minions, get a minion of your most common type (carry-back)
  | 'quest' // Drakko (passive): buy 5 Battlecry minions → get Drakko the Drummer (resolved in the buy case)
  | 'chaos' // Chaos (passive): starts with a 1/1 all-type Magnetic token; gets another at the start of every 5th turn
  | 'sellGold' // Robin (passive): each minion you sell banks +1 Gold for the START of next turn
  | 'displace'; // Darah: swap a friendly minion with a random tavern minion (active, targeted)

export interface HeroPower {
  name: string;
  /** Full sentence for the tooltip. */
  text: string;
  kind: HeroPowerKind;
  /** Once-per-game powers lock after a single use (vs the default once-per-wave). */
  oncePerGame?: boolean;
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
   *  damage chips Armor first, then Resolve; it just doesn't regenerate (no max/heal). Most heroes start with
   *  15; Warden, Robin, Chaos, and Drakko start with 8. */
  armor: number;
  power: HeroPower;
}

export const HEROES: HeroDef[] = [
  {
    id: 'warden',
    name: 'Warden',
    blurb: 'Steady, scaling muscle — every wave a minion grows with you.',
    resolve: 30,
    armor: 8,
    power: {
      name: 'Fortify',
      kind: 'fortify',
      text: 'Give a minion +1/+1. Improve this when you tavern up.',
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
      oncePerGame: true,
      text: 'Gild: Make a friendly minion golden. (Once per game)',
    },
  },
  {
    id: 'myra',
    name: 'Myra',
    blurb: 'A conductor of entrances — call a minion to take its bow again.',
    resolve: 30,
    armor: 15,
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
    armor: 15,
    power: {
      name: 'Reclaim',
      kind: 'resummon',
      text: 'Reclaim: Mark a minion. At the start of combat, that minion is destroyed and returns when possible.',
    },
  },
  {
    id: 'rohan',
    name: 'Rohan',
    blurb: 'Words sharpen in skilled hands — and sharpen further as the climb wears on.',
    resolve: 30,
    armor: 15,
    power: {
      name: 'Attunement',
      kind: 'spellAmplify',
      passive: true,
      text: 'Attunement: Spells gain +1/+1. Improve this every 3 turns.',
    },
  },
  {
    id: 'djinn',
    name: 'Djinn',
    blurb: 'Calls the day to its close early — once a turn, on your terms.',
    resolve: 30,
    armor: 15,
    power: {
      name: 'Cadence',
      kind: 'replayEndOfTurn',
      text: "Cadence: Trigger a friendly minion's End of Turn effect. (Once per turn)",
    },
  },
  {
    id: 'nadja',
    name: 'Nadja',
    blurb: 'The well runs deeper each turn — more Gold, more room to scheme.',
    resolve: 30,
    armor: 15,
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
    armor: 15,
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
    armor: 15,
    power: {
      name: 'Displace',
      kind: 'displace',
      text: 'Choose a friendly minion — swap it with a random minion in the tavern.',
    },
  },
];

/** The Spellbinder's spell bonus: +1/+1 to stat-granting spells, rising by 1 every 3 turns
 *  (+1 on turns 1–3, +2 on 4–6, +3 on 7–9, …). A starting dial. */
export function spellAmplifyBonus(wave: number): number {
  return 1 + Math.floor((wave - 1) / 3);
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
