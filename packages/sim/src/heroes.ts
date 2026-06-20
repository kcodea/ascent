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
  | 'gild' // Oner: make a friendly minion Golden
  | 'replayBattlecry' // Myra: re-trigger a friendly minion's Battlecry
  | 'replayEndOfTurn' // Dusk: proc a friendly minion's End of Turn now
  | 'resummon' // The Reclaimer: at start of combat, destroy a marked minion (procs its Deathrattle) + resummon a copy
  | 'spellAmplify'; // The Spellbinder (passive): stat-granting spells give +X/+X more, X scaling every 3 waves

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
}

export interface HeroDef {
  id: string;
  name: string;
  /** One-line flavour for the hero-select screen. */
  blurb: string;
  /** Starting + max Resolve (the hero's HP). All 30 today; will diverge per hero over time. */
  resolve: number;
  power: HeroPower;
}

export const HEROES: HeroDef[] = [
  {
    id: 'warden',
    name: 'Warden',
    blurb: 'Steady, scaling muscle — every wave a minion grows with you.',
    resolve: 30,
    power: {
      name: 'Fortify',
      kind: 'fortify',
      text: 'Each wave: give a minion +X/+X, where X is your Tavern Tier.',
    },
  },
  {
    id: 'oner',
    name: 'Oner',
    blurb: 'One perfect moment — gild a single minion and make it count.',
    resolve: 30,
    power: {
      name: 'Gild',
      kind: 'gild',
      oncePerGame: true,
      text: 'Once per game: make a friendly minion Golden (doubles its base stats).',
    },
  },
  {
    id: 'myra',
    name: 'Myra',
    blurb: 'A conductor of entrances — call a minion to take its bow again.',
    resolve: 30,
    power: {
      name: 'Encore',
      kind: 'replayBattlecry',
      unlockWave: 3,
      text: "Each turn (from turn 3): trigger a friendly minion's Battlecry again.",
    },
  },
  {
    id: 'sporen',
    name: 'Sporen',
    blurb: 'Death is a doorway — send a minion through it and it blooms back.',
    resolve: 30,
    power: {
      name: 'Reclaim',
      kind: 'resummon',
      text: "Each turn: mark a minion. At the start of combat it's destroyed (its Deathrattle fires) and an exact copy returns if there's room.",
    },
  },
  {
    id: 'rohan',
    name: 'Rohan',
    blurb: 'Words sharpen in skilled hands — and sharpen further as the climb wears on.',
    resolve: 30,
    power: {
      name: 'Attunement',
      kind: 'spellAmplify',
      passive: true,
      text: 'Passive: your stat-granting spells give +X/+X more. X starts at 1 and rises every 3 turns.',
    },
  },
  {
    id: 'djinn',
    name: 'Djinn',
    blurb: 'Calls the day to its close early — once a turn, on your terms.',
    resolve: 30,
    power: {
      name: 'Cadence',
      kind: 'replayEndOfTurn',
      text: "Each turn: trigger a friendly minion's End of Turn effect now.",
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

/** Resolve a hero by id, falling back to the default so a bad/old save never crashes. */
export function getHero(id: string | undefined): HeroDef {
  return (id && HERO_INDEX[id]) || HERO_INDEX[DEFAULT_HERO_ID];
}
