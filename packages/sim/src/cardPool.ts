import { combatTierCeiling, inRunTribes, legalRandomMinions, type CardDef } from '@game/core';
import type { CardPool, SetId } from '@game/content';
import { poolFor } from '@game/content';
import type { RunState } from './state';

/**
 * The card pool a RUN draws from — resolved from the set pinned on the run, never from the live registry.
 *
 * This is the single seam between "which set is switched on right now" and "which set this run is being
 * played under". Every draw site goes through it, so flipping the active set mid-session can never change
 * what an in-flight or replayed run rolls. `activeSet()` is for creating a NEW run and nothing else.
 *
 * Saves written before sets existed carry no `setId`; they resolve to `set1`, which is exactly the pool
 * they were played under, so old saves and replays keep working untouched.
 */
export function poolOf(state: Pick<RunState, 'setId'> & Partial<Pick<RunState, 'tribes' | 'practiceConfig' | 'mode'>>): CardPool {
  const set = poolFor(state.setId ?? 'set1');
  // VERSUS (owner ruling 2026-10-13, R-VERSUS-POOL-01): "Pre-emptive Assault ... just remove this spell from
  // versus." Every attack-first source is out of a Versus run's pool, so it can never be shopped, Discovered or
  // granted, and the resolver's chair only decides the seeded tie-break.
  const base = state.mode === 'versus' ? versusPool(set) : set;
  // PRACTICE TRIBES (owner 2026-09-27: "that tribe's cards plus neutral cards, and all spells associated"): a
  // Practice game played with picked tribes draws from a pool NARROWED to them, so every random pick, not only
  // the gated shop/Discover sites (a "random minion" grant, a combat-generated card), stays on those tribes plus
  // neutral. Tokens stay: they are made by specific cards, never drawn. Every other run (Normal Practice
  // included) gets the set's pool untouched, so nothing else moves.
  const picked = state.practiceConfig?.tribes;
  if (!picked || picked.length === 0 || !state.tribes || state.tribes.length === 0) return base;
  return narrowedPool(base, state.tribes);
}

/** A card that makes its side strike first (Pre-emptive Assault today): read from the effect data, so a future
 *  attack-first card is excluded from Versus without a list to keep. */
export function isVersusExcludedCard(c: Pick<CardDef, 'effects'>): boolean {
  return (c.effects ?? []).some((e) => e.do === 'spellAttackFirst');
}

const VERSUS_POOLS = new Map<string, CardPool>();
function versusPool(base: CardPool): CardPool {
  const hit = VERSUS_POOLS.get(base.setId);
  if (hit) return hit;
  const keep = (c: CardDef): boolean => !isVersusExcludedCard(c);
  const pool: CardPool = { setId: base.setId, all: base.all.filter(keep), buyable: base.buyable.filter(keep), spells: base.spells.filter(keep) };
  VERSUS_POOLS.set(base.setId, pool);
  return pool;
}

const NARROWED = new Map<string, CardPool>();
function narrowedPool(base: CardPool, tribes: readonly string[]): CardPool {
  const key = `${base.setId}|${base.all.length}|${[...tribes].sort().join(',')}`;
  const hit = NARROWED.get(key);
  if (hit) return hit;
  const all = base.all.filter((c) => c.token || inRunTribes(c, tribes));
  const pool: CardPool = {
    setId: base.setId,
    all,
    buyable: all.filter((c) => !c.token && !c.spell),
    spells: all.filter((c) => c.spell && !c.token),
  };
  NARROWED.set(key, pool);
  return pool;
}

/**
 * The tier CEILING a random effect may reach for this run RIGHT NOW: Tier 7 only while your Shop actually stands at
 * Tier 7, otherwise 6. R-RANDOM-TIER7-01 (owner 2026-10-21, "cant be getting t7s in combat either"): Tier-7 ACCESS
 * alone (the Summit rift, Open Road / Summit Passage's `tier7Access`) with a Tier 6 Shop no longer opens Tier 7 to a
 * random picker. The SAME rule as combat's `combatTierCeiling`, so the two phases cannot drift. Effects whose text
 * names Tier 7 (Rune of the Deep, Beyond the Summit, Pete, Strange Revision) ask for it explicitly and skip this.
 */
export function randomTierCeiling(state: Pick<RunState, 'tier'>): number {
  return combatTierCeiling(state.tier);
}

/**
 * The DEFAULT Discover clamp (`offerDiscover` with no `maxTier`) and Elevation Ritual's offer cap. Owner ruling
 * 2026-10-21 (R-RANDOM-TIER7-02, "yes for now, may change this"): these follow R-RANDOM-TIER7-01 too, so a Summit
 * rift run reaches Tier 7 here only while its Shop actually stands at Tier 7. Before the ruling both read
 * `maxTierFor(state.rift)` (7 on ANY Summit run). TO REVERT: return `maxTierFor(state.rift)` here; nothing else moves.
 */
export function discoverElevateCeiling(state: Pick<RunState, 'tier'>): number {
  return randomTierCeiling(state);
}

/**
 * THE LEGAL RANDOM MINIONS of a run (owner reports 2026-10-20, R-RANDOM-POOL-01): the run's pinned buyable pool
 * minus spells, Rubies, tokens and henchmen, at or below `randomTierCeiling` (or a tighter `maxTier`, e.g. "up to
 * your Shop tier"). Every "summon / get a random minion" picker in the Shop starts here, so a card the Shop could
 * never sell (Elderhorn, Orivax and every other Tier 7 in a normal run) cannot come out of one. Order is the
 * pool's, so seeded picks replay faithfully. Tribe / effect predicates stay with the caller.
 */
export function legalRandomMinionPool(
  state: Pick<RunState, 'setId' | 'tier'> & Partial<Pick<RunState, 'tribes' | 'practiceConfig' | 'mode'>>,
  opts?: { maxTier?: number },
): CardDef[] {
  const ceiling = Math.min(randomTierCeiling(state), opts?.maxTier ?? Infinity);
  return legalRandomMinions(poolOf(state).buyable, ceiling);
}

/** The set a run is pinned to, defaulted for pre-sets saves. */
export function setIdOf(state: Pick<RunState, 'setId'>): SetId {
  return state.setId ?? 'set1';
}
