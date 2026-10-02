import type { GauntletRound, GauntletStage } from './types';

/**
 * GAUNTLET RUN BUFFS — the authored opponent's run-WIDE scalers, round by round (owner ask 2026-10-02: "kobolds
 * buff gems throughout a match, but theres no way for me to reflect that, so rubys stay at 1/1").
 *
 * A real run accumulates these in its own state (Ruby strength, spell power, the Imp aura, Pack Leader's count, …)
 * and a recorded board carries them on its `BoardSnapshot`, which `sideFromSnapshot` threads into combat. An
 * authored opponent has no run, so the author sets them here. Every key is the SAME name as the `BoardSnapshot`
 * field it feeds (the engine spreads them straight on; `@game/sim` pins that at compile time), and only the SIMPLE
 * numeric scalers are exposed — per-card `cardBuffs`, hand contents, remembered/last spell ids, the `tribesPlayed`
 * map, `handMinions` and `questMods` are not author-friendly numbers (owner 2026-10-02).
 *
 * CARRY-FORWARD: a round's `buffs` holds only the values the author SET on that round; every other value is
 * inherited from the latest earlier round that set it (0 when none did). `effectiveBuffs` is that fold.
 */

export interface GauntletBuffPair { attack: number; health: number }

export interface GauntletBuffs {
  // Kobold
  rubyBonus: GauntletBuffPair;
  rubyCasts: number;
  cardsBoughtThisTurn: number;
  // Spell
  spellPower: GauntletBuffPair;
  spellEscalation: GauntletBuffPair;
  spellsThisTurn: number;
  spellsCast: number;
  growthBonus: number;
  // Demon
  impAura: GauntletBuffPair;
  fodderConsumed: GauntletBuffPair;
  // Undead
  undeadAura: GauntletBuffPair;
  undeadBuyAtk: number;
  // Mech
  magneticAura: GauntletBuffPair;
  // Beast
  beastBuyAtk: number;
  beastsPlayed: number;
  wildHuntGrown: number;
  beastHuntExtra: number;
  beastRitualExtra: number;
  squirlScoutBuff: number;
  // Dwarf
  alesLastTurn: number;
  goldSpentThisTurn: number;
  // Spirit
  spiritsPlayed: number;
  revelerX: number;
  // Counters
  deathrattles: number;
  conductorBuff: number;
}

export type GauntletBuffKey = keyof GauntletBuffs;

export const GAUNTLET_BUFF_GROUPS = ['Kobold', 'Spell', 'Demon', 'Undead', 'Mech', 'Beast', 'Dwarf', 'Spirit', 'Counters'] as const;
export type GauntletBuffGroup = (typeof GAUNTLET_BUFF_GROUPS)[number];

export interface GauntletBuffField {
  key: GauntletBuffKey;
  label: string;
  group: GauntletBuffGroup;
  /** `pair` = an Attack/Health pair; `number` = a single count. */
  kind: 'pair' | 'number';
  /** What reads it — shown to the author as the field's description. */
  hint: string;
}

/** The catalogue, keyed so a `GauntletBuffs` member without an entry fails to compile. Order = display order. */
const FIELD_TABLE: Record<GauntletBuffKey, Omit<GauntletBuffField, 'key'>> = {
  rubyBonus: { label: 'Ruby strength', group: 'Kobold', kind: 'pair', hint: 'Extra stats every Ruby carries on top of 1/1 (Gemstorm, Geode Guardian, Blazer, Candle Conduit)' },
  rubyCasts: { label: 'Rubies cast', group: 'Kobold', kind: 'number', hint: 'Lifetime Ruby casts (Vaultkeeper text)' },
  cardsBoughtThisTurn: { label: 'Cards bought this turn', group: 'Kobold', kind: 'number', hint: 'Frenzied Excavator' },
  spellPower: { label: 'Spell power', group: 'Spell', kind: 'pair', hint: 'Bonus stats on spells (Taragosa, Watcher, Hoardbreaker)' },
  spellEscalation: { label: 'Front to Back', group: 'Spell', kind: 'pair', hint: "Quil's Front to Back escalation" },
  spellsThisTurn: { label: 'Spells this turn', group: 'Spell', kind: 'number', hint: 'Runescale Drake' },
  spellsCast: { label: 'Spells cast (run)', group: 'Spell', kind: 'number', hint: 'Lifetime spells cast (Umbral Energy)' },
  growthBonus: { label: 'Growth bonus', group: 'Spell', kind: 'number', hint: 'Rune of Living Growth' },
  impAura: { label: 'Imp aura', group: 'Demon', kind: 'pair', hint: 'Imp summons (Imp King, Brood Matron, Chef Raag)' },
  fodderConsumed: { label: 'Fodder consumed', group: 'Demon', kind: 'pair', hint: 'Abhorrent Horror' },
  undeadAura: { label: 'Undead aura', group: 'Undead', kind: 'pair', hint: 'Lantern of Souls / Watcher (all Undead in combat)' },
  undeadBuyAtk: { label: 'Undead buy Attack', group: 'Undead', kind: 'number', hint: 'Deathswarmer, Forsaken Weaver, Karthus' },
  magneticAura: { label: 'Attachment aura', group: 'Mech', kind: 'pair', hint: 'Scrap Herald, Banksly' },
  beastBuyAtk: { label: 'Beast Attack aura', group: 'Beast', kind: 'number', hint: 'Run-wide Beast Attack' },
  beastsPlayed: { label: 'Beasts played this turn', group: 'Beast', kind: 'number', hint: 'Pack Leader' },
  wildHuntGrown: { label: 'Wild Hunt growth', group: 'Beast', kind: 'number', hint: 'Rune of the Wild Hunt' },
  beastHuntExtra: { label: 'Elderhorn: Hunt', group: 'Beast', kind: 'number', hint: 'Extra Rally/Slaughter fires' },
  beastRitualExtra: { label: 'Elderhorn: Ritual', group: 'Beast', kind: 'number', hint: 'Extra Echo fires' },
  squirlScoutBuff: { label: 'Squirl Scout', group: 'Beast', kind: 'number', hint: "Squirl Scout's snowball" },
  alesLastTurn: { label: 'Ales last turn', group: 'Dwarf', kind: 'number', hint: 'Bucky' },
  goldSpentThisTurn: { label: 'Gold spent this turn', group: 'Dwarf', kind: 'number', hint: 'Baby Gastrid' },
  spiritsPlayed: { label: 'Spirits played this turn', group: 'Spirit', kind: 'number', hint: 'Kindled Sprite' },
  revelerX: { label: 'Reveler value', group: 'Spirit', kind: 'number', hint: 'Revelers / Luminary' },
  deathrattles: { label: 'Deathrattles (run)', group: 'Counters', kind: 'number', hint: 'Deathrattles triggered so far (Grim)' },
  conductorBuff: { label: 'Conductor', group: 'Counters', kind: 'number', hint: "Conductor's snowball N" },
};

export const GAUNTLET_BUFF_FIELDS: readonly GauntletBuffField[] =
  (Object.keys(FIELD_TABLE) as GauntletBuffKey[]).map((key) => ({ key, ...FIELD_TABLE[key] }));

export const isBuffPair = (v: unknown): v is GauntletBuffPair =>
  typeof v === 'object' && v !== null && 'attack' in v && 'health' in v;

/** Every buff at 0 — the start of the carry-forward fold. */
export function emptyBuffs(): GauntletBuffs {
  const out: Record<string, number | GauntletBuffPair> = {};
  for (const f of GAUNTLET_BUFF_FIELDS) out[f.key] = f.kind === 'pair' ? { attack: 0, health: 0 } : 0;
  return out as unknown as GauntletBuffs;
}

const copyValue = <V extends number | GauntletBuffPair>(v: V): V => (isBuffPair(v) ? { attack: v.attack, health: v.health } as V : v);

/** The buffs in force on a (1-based) round: each value from the latest round ≤ `round` that set it, else 0. */
export function effectiveBuffs(stage: Pick<GauntletStage, 'rounds'>, round: number): GauntletBuffs {
  const out = emptyBuffs() as unknown as Record<GauntletBuffKey, number | GauntletBuffPair>;
  const last = Math.min(round, stage.rounds.length);
  for (let i = 0; i < last; i++) {
    const set = stage.rounds[i]?.buffs;
    if (!set) continue;
    for (const k of Object.keys(set) as GauntletBuffKey[]) {
      const v = set[k];
      if (v !== undefined && k in FIELD_TABLE) out[k] = copyValue(v);
    }
  }
  return out as unknown as GauntletBuffs;
}

/** The round whose override is in force for `key` on `round` (that round itself when it sets it), or null when
 *  no round ≤ `round` sets it (the value is the 0 default). */
export function buffSourceRound(stage: Pick<GauntletStage, 'rounds'>, round: number, key: GauntletBuffKey): number | null {
  for (let i = Math.min(round, stage.rounds.length) - 1; i >= 0; i--) {
    if (stage.rounds[i]?.buffs?.[key] !== undefined) return i + 1;
  }
  return null;
}

export const isZeroBuff = (v: number | GauntletBuffPair): boolean => (isBuffPair(v) ? v.attack === 0 && v.health === 0 : v === 0);

/** Only the non-zero buffs — what a snapshot carries (a 0 is the scaler's absent default anyway). */
export function nonZeroBuffs(b: GauntletBuffs): Partial<GauntletBuffs> {
  const out: Record<string, number | GauntletBuffPair> = {};
  for (const f of GAUNTLET_BUFF_FIELDS) {
    const v = b[f.key];
    if (!isZeroBuff(v)) out[f.key] = copyValue(v);
  }
  return out as Partial<GauntletBuffs>;
}

/** Set (`value`) or clear (`undefined`) one buff override on a round, dropping an emptied `buffs` key so a cleared
 *  round compares equal to a never-touched one. Pure. */
export function withBuffOverride<K extends GauntletBuffKey>(r: GauntletRound, key: K, value: GauntletBuffs[K] | undefined): GauntletRound {
  const buffs: Partial<GauntletBuffs> = { ...(r.buffs ?? {}) };
  if (value === undefined) delete buffs[key];
  else buffs[key] = copyValue(value);
  const next: GauntletRound = { ...r, buffs };
  if (Object.keys(buffs).length === 0) delete next.buffs;
  return next;
}

/** Two rounds' authored overrides are identical (same keys, same values). */
export function buffOverridesEqual(a: Partial<GauntletBuffs> | undefined, b: Partial<GauntletBuffs> | undefined): boolean {
  const ka = Object.keys(a ?? {}) as GauntletBuffKey[];
  if (ka.length !== Object.keys(b ?? {}).length) return false;
  return ka.every((k) => {
    const x = a![k];
    const y = b?.[k];
    if (y === undefined || x === undefined) return false;
    return isBuffPair(x) && isBuffPair(y) ? x.attack === y.attack && x.health === y.health : x === y;
  });
}
