/**
 * Board SYNTHESIS — "print" competitive boards by recombining + mutating REAL captured boards, validated
 * against the wave-relative rating.
 *
 * The smart bot can't build strong high-wave boards: it has to survive a whole run and plays greedily (no
 * positioning, naive sequencing), so its high-wave output is mediocre and the pool goes thin + weak up there.
 * Real captured boards CAN reach those strengths — so instead of asking the bot to *earn* a board through
 * play, we take a real board, swap in minions seen on OTHER real boards at the same wave, nudge stats for a
 * strength dial, and KEEP it only if `simulate` (via `rateBoardForWave`) says it lands at/above the target
 * band. That makes "competitive" empirical (it actually wins fights), stays coherent (anchored in real boards
 * + real minions — the data on what players actually build), and lets us bulk up the thin, strong high-wave
 * cells the bot leaves empty. Tagged `origin:'synthetic'`.
 *
 * Deterministic (seeded rng). Tool-time only (used by `npm run pool`); not on any runtime path.
 */
import { makeRng, type BoardMinion, type CardDef, type Rng, type Tribe } from '@game/core';
import { CARD_INDEX, poolFor, type SetId } from '@game/content';
import type { BoardSnapshot } from './snapshot';
import { HEROES } from './heroes';
import { opponentBoard } from './opponents';
import { rateBoardForWave, ratingBand, type WaveLadders } from './rating';
import { buildEnemyBoard, THREAT_IDS } from './threats';

const power = (b: BoardMinion[]): number => b.reduce((s, m) => s + m.attack + m.health, 0);

/** A stable identity for a board's minion set, so identical variants (and re-emitted real boards) dedupe. */
const signature = (b: BoardMinion[]): string =>
  b.map((m) => `${m.cardId}:${m.attack}/${m.health}:${(m.keywords ?? []).slice().sort().join('')}${m.golden ? 'g' : ''}`).sort().join(',');

/**
 * Mutate a board into a fresh variant: recombine (swap 0–2 minions for `donors` — minions seen on real boards
 * at this wave) then nudge every minion's stats by a shared ×0.8–1.3 factor (a strength dial). Returns a NEW
 * `BoardMinion[]` (never mutates the input). Stays coherent because it's anchored in a real board + real
 * minions; opponents only need to be the right STRENGTH, not buildable, and the rating validates that.
 */
export function mutateBoard(board: BoardMinion[], donors: BoardMinion[], rng: Rng): BoardMinion[] {
  const out = board.map((m) => ({ ...m, keywords: [...(m.keywords ?? [])] }));
  if (donors.length > 0) {
    const swaps = rng.int(3); // 0, 1, or 2 minion swaps
    for (let i = 0; i < swaps && out.length > 0; i++) {
      const d = donors[rng.int(donors.length)]!;
      out[rng.int(out.length)] = { ...d, keywords: [...(d.keywords ?? [])] };
    }
  }
  const factor = 0.8 + rng.next() * 0.5; // ×0.8–1.3 strength dial
  for (const m of out) {
    m.attack = Math.max(1, Math.round(m.attack * factor));
    m.health = Math.max(1, Math.round(m.health * factor));
  }
  return out;
}

export interface SynthOptions {
  /** Reject synthetic boards whose wave-relative band is below this (keep them competitive). */
  floorBand: number;
  /** Stamp on every synthetic board (e.g. the bake's patch / date). */
  patch?: string;
  capturedAt?: string;
}

/**
 * Synthesize up to `count` validated boards for `wave` by mutating the real boards `reals` (the real captured
 * boards AT this wave). Each candidate must be servable (every cardId still exists) and rate at or above
 * `opts.floorBand`; duplicates (by minion signature, including the seed reals) are skipped. Deterministic for
 * a given `seed`. Returns boards tagged `origin:'synthetic'` with a baked wave-relative `rating`; gives up
 * after a bounded number of attempts if the cell just can't be filled (e.g. only one weak real board to draw
 * from).
 */
export function synthesizeForWave(
  reals: BoardSnapshot[],
  wave: number,
  ladders: WaveLadders,
  count: number,
  seed: number,
  opts: SynthOptions,
): BoardSnapshot[] {
  if (reals.length === 0 || count <= 0) return [];
  const rng = makeRng(seed);
  const donors = reals.flatMap((b) => opponentBoard(b));
  const seen = new Set(reals.map((b) => signature(opponentBoard(b)))); // never re-emit a real board verbatim
  const out: BoardSnapshot[] = [];
  for (let attempt = 0; out.length < count && attempt < count * 30; attempt++) {
    const base = reals[rng.int(reals.length)]!;
    const minions = mutateBoard(opponentBoard(base), donors, rng);
    if (minions.length === 0 || !minions.every((m) => !!CARD_INDEX[m.cardId])) continue;
    const sig = signature(minions);
    if (seen.has(sig)) continue;
    const rating = +rateBoardForWave(minions, wave, ladders, base.tier).toFixed(3);
    if (ratingBand(rating) < opts.floorBand) continue; // not competitive enough → drop
    seen.add(sig);
    out.push({
      ...base,
      minions,
      power: power(minions),
      rating,
      origin: 'synthetic',
      author: undefined,
      patch: opts.patch ?? base.patch,
      capturedAt: opts.capturedAt ?? base.capturedAt,
    });
  }
  return out;
}

// ── From-scratch synthesis (no bot, no real seed) ────────────────────────────────────────────
// The bot only survives to ~wave 9, so it can't seed a pool for waves 10–20. Instead we build boards
// straight from the card set, scaled to MATCH THE TUNED ENEMY CURVE: for each wave we take the procedural
// threat boards (`buildEnemyBoard` — the `enemyScaling` dial, defined for all 20 waves across the 5 threat
// archetypes), copy their width + power (the "power banding" anchor), and fill that shape with real tribe
// cards scaled to hit it. The cardIds carry real keywords/effects (so a served board fights like a real
// tribe board), and `rateBoardForWave` (now ladder-backed at every wave) bands them. Opponents only need the
// right STRENGTH, not buildability — so this is principled, deterministic, and covers waves 1–20.

const SYNTH_TRIBES: Tribe[] = ['beast', 'dragon', 'undead', 'mech', 'demon'];
/**
 * Per-tribe buyable minion pools for a SET (a card counts for either of its tribes), memoized per set.
 *
 * This used to be a module-level const over the flat pool — the exact shape that silently ignores which set
 * is live. Synthetic opponent boards are built from real cardIds, so a board baked from set 1 is unservable
 * in a set-2 run (`isServableBoard` drops any board naming a card the index doesn't have). The bake has to
 * know its set; see `npm run pool`.
 */
const tribePools = new Map<SetId, Record<string, CardDef[]>>();
function tribePoolFor(setId: SetId): Record<string, CardDef[]> {
  const hit = tribePools.get(setId);
  if (hit) return hit;
  const buyable = poolFor(setId).buyable;
  const byTribe: Record<string, CardDef[]> = Object.fromEntries(
    SYNTH_TRIBES.map((t) => [t, buyable.filter((c) => c.tribe === t || c.tribe2 === t)]),
  );
  tribePools.set(setId, byTribe);
  return byTribe;
}
/** A plausible tavern tier for a wave — opponent-frame intel + a soft cap on which cards a board draws from. */
const tierForWave = (wave: number): number => Math.max(1, Math.min(6, Math.round(wave / 3) + 1));

/** Keep `cap` boards from `list`, spread evenly across the Σ(atk+hp) power range (not clustered). */
function spreadByPowerMinions(list: BoardMinion[][], cap: number): BoardMinion[][] {
  if (list.length <= cap) return list;
  const sorted = [...list].sort((a, b) => power(a) - power(b));
  const out: BoardMinion[][] = [];
  for (let i = 0; i < cap; i++) out.push(sorted[Math.round((i * (sorted.length - 1)) / (cap - 1))]!);
  return out;
}

/** Build one coherent tribe board of `n` minions, stat-scaled uniformly to hit `targetPower`. Real cardIds
 *  (so keywords/effects are real); cards are drawn from the tribe's pool at/under `maxTier` for era-fit. */
function buildTribeBoard(tribe: Tribe, n: number, targetPower: number, maxTier: number, rng: Rng, setId: SetId): BoardMinion[] {
  const byTribe = tribePoolFor(setId);
  let pool = byTribe[tribe]!.filter((c) => c.tier <= maxTier);
  if (pool.length < 2) pool = byTribe[tribe]!;
  const picks: CardDef[] = [];
  for (let i = 0; i < n; i++) picks.push(pool[rng.int(pool.length)]!);
  const base = picks.reduce((s, c) => s + c.attack + c.health, 0) || 1;
  const factor = targetPower / base; // uniform stat dial → Σ(atk+hp) ≈ targetPower
  return picks.map((c) => ({
    cardId: c.id,
    attack: Math.max(1, Math.round(c.attack * factor)),
    health: Math.max(1, Math.round(c.health * factor)),
    keywords: [...c.keywords],
  }));
}

export interface CurveSynthOptions {
  /** How many boards to emit for the wave (the per-wave pool size, e.g. 5–8). */
  perWave: number;
  /** Procedural reference seeds per threat (more = a finer power spread to sample from). */
  proceduralSeeds?: number;
  patch?: string;
  capturedAt?: string;
  /** Which set's cards to build boards from. Defaults to `set1` so existing bakes are byte-identical. */
  setId?: SetId;
}

/**
 * Synthesize `opts.perWave` boards for `wave`, banded to the tuned enemy curve. Deterministic for a given
 * `seed`. Each board mirrors a procedural threat board's WIDTH + POWER (spread weak→strong across the wave's
 * archetypes, with a small jitter) but is filled with real tribe cards (tribe cycles for variety). Returns
 * `origin:'synthetic'` snapshots carrying a baked wave-relative `rating`. No bot, no real seed needed.
 */
export function synthesizeWaveFromCurve(
  wave: number,
  ladders: WaveLadders,
  seed: number,
  opts: CurveSynthOptions,
): BoardSnapshot[] {
  // Fail LOUDLY on an empty set. Without this the tribe pools are empty, `buildTribeBoard` indexes into
  // nothing, and the bake dies ~40 frames later with "Cannot read properties of undefined (reading
  // 'attack')" — which says nothing about the actual cause. You hit this by baking a set before its cards
  // land, which is exactly what happens while a new set is being authored.
  const setId = opts.setId ?? 'set1';
  if (poolFor(setId).buyable.length === 0) {
    throw new Error(
      `Cannot synthesize opponent boards: set '${setId}' has no buyable minions. ` +
      `Add cards to SETS.${setId}.own (or give it an \`inherits\`) before baking its pool — see docs/card-sets.md.`,
    );
  }
  const rng = makeRng(seed);
  const procSeeds = opts.proceduralSeeds ?? 4;
  // The tuned enemy curve at this wave: 5 archetypes × procSeeds, spanning width + power weak→strong.
  const refs: BoardMinion[][] = [];
  THREAT_IDS.forEach((threat, ti) => {
    for (let k = 0; k < procSeeds; k++) refs.push(buildEnemyBoard(threat, wave, makeRng(seed + ti * 131 + k * 17 + 1)));
  });
  const chosen = spreadByPowerMinions(refs.filter((b) => b.length > 0), opts.perWave);
  const tier = tierForWave(wave);
  const out: BoardSnapshot[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < chosen.length; i++) {
    const ref = chosen[i]!;
    const targetPower = Math.max(2, Math.round(power(ref) * (0.9 + rng.next() * 0.3))); // ×0.9–1.2 band jitter
    const tribe = SYNTH_TRIBES[(wave + i) % SYNTH_TRIBES.length]!; // cycle tribes for synergy variety
    const minions = buildTribeBoard(tribe, ref.length, targetPower, tier, rng, opts.setId ?? 'set1');
    const sig = signature(minions);
    if (seen.has(sig)) continue;
    seen.add(sig);
    const rating = +rateBoardForWave(minions, wave, ladders, tier).toFixed(3);
    out.push({
      v: 1,
      wave,
      heroId: HEROES[(wave * 7 + i) % HEROES.length]!.id,
      resolve: 30,
      tier,
      triples: 0,
      tribes: [...SYNTH_TRIBES],
      threat: THREAT_IDS[rng.int(THREAT_IDS.length)]!,
      power: power(minions),
      minions,
      seed,
      origin: 'synthetic',
      author: undefined,
      capturedAt: opts.capturedAt,
      patch: opts.patch,
      // Stamp the set the board was BUILT from. Without this a set-2 bake emits unstamped boards, which
      // default to set1 at pick time and get served into set-1 runs made of cards that run cannot have.
      setId: opts.setId ?? 'set1',
      rating,
    });
  }
  return out;
}
