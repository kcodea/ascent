/**
 * Opponent board source (M3 step 4 — "serve realistic boards"). The enemy board for a wave can be drawn
 * from a pool of real `BoardSnapshot`s (captured player boards / authored boards) instead of the
 * procedural `omen`-minion threat board. `pickOpponent` is deterministic (seeded) and only returns a board
 * when the pool has a strength-matched candidate for the wave; otherwise it returns null and the caller
 * falls back to the procedural threat (`buildEnemyBoard`). So a thin pool degrades gracefully.
 *
 * Determinism scope (be honest about it): the pool is static FOR A SESSION — registered once at startup
 * from (a) the committed synthetic floor, (b) the local board library, and (c) the live Supabase fetch —
 * and never mutated mid-run, so every replay/odds-sim within the session is byte-identical. ACROSS
 * sessions the fetched remote boards can differ, so re-deriving an old run from its (seed, actions)
 * replay may serve different opponents than were actually fought. If exact cross-session reconstruction
 * ever matters (run archives, server-side replay validation), stamp the served opponent into the run
 * record at faceOmen — see the roadmap's async-PvP hardening note.
 */
import type { BoardMinion, Rng } from '@game/core';
import { CARD_INDEX } from '@game/content';
import type { BoardSnapshot } from './snapshot';

/**
 * The served-opponent pool. Starts empty and is filled ONCE at startup via `registerOpponents` (committed
 * synthetic floor + local board library + the Supabase fetch), then stays fixed for the session — see the
 * determinism-scope note above.
 */
export const OPPONENT_POOL: BoardSnapshot[] = [];

/**
 * Pick an opponent by WAVE — you face a board at the same development stage (same amount of shopping). This
 * matters: matching by win count instead served over-developed boards to early players (a wave-5 board with
 * 0 wins — a struggling run — landed on a turn-1 player as Tier-2 units). Within that wave, opponents are
 * served by SOURCE PRIORITY and otherwise FULLY RANDOM (no power weighting):
 *   1) the live Supabase shared pool (`remote`), then
 *   2) any local player / friend board (`origin` self/friend), then
 *   3) the committed synthetic floor —
 * picking uniformly at random within the highest non-empty tier. So you always face real player boards when
 * any exist (freshest from Supabase first), falling to synthetic only when there are none for the wave.
 * Widens to the closest wave if none match exactly; null only on an empty pool (→ procedural fallback, rng
 * untouched). Consumes `rng` only when it returns a board. `power` is retained for signature stability but no
 * longer weights the pick (selection is fully random within the chosen tier).
 */
/** A stable identity for "the same opponent" — the board's stamped id when present (real self / friend / remote
 *  boards), else a content-derived key (committed / synthetic boards carry no id). Two boards with the same key
 *  are treated as the same opponent for the no-repeat rule. */
export function oppKey(s: BoardSnapshot): string {
  return s.id ? `id:${s.id}` : `k:${s.author ?? ''}:${s.seed}:${s.wave}:${s.power}:${s.minions.length}`;
}

export function pickOpponent(
  wave: number,
  power: number,
  rng: Rng,
  pool: BoardSnapshot[] = OPPONENT_POOL,
  /** Identities (`oppKey`) of boards the player faced too recently to serve again (the last N rounds). Excluded
   *  from the pick unless doing so would leave nothing to serve, in which case a repeat beats no opponent. */
  exclude: Set<string> = new Set(),
): BoardSnapshot | null {
  void power; // no longer weights the pick — kept so the call signature (and the recruit preview) stays stable
  if (pool.length === 0) return null;
  // 1) Same WAVE (same development stage); widen to the closest available wave if none match exactly.
  let candidates = pool.filter((s) => s.wave === wave);
  if (candidates.length === 0) {
    const minDist = Math.min(...pool.map((s) => Math.abs(s.wave - wave)));
    candidates = pool.filter((s) => Math.abs(s.wave - wave) === minDist);
  }
  // 2) No-repeat: drop boards fought in the last few rounds (owner rule) — before source-tiering, so a fresh
  //    lower-priority board is preferred over repeating a higher-priority one. Fall back to the full set only
  //    when excluding would empty it (a small pool → a repeat is unavoidable).
  if (exclude.size) {
    const fresh = candidates.filter((s) => !exclude.has(oppKey(s)));
    if (fresh.length) candidates = fresh;
  }
  // 3) Source priority: live Supabase pool → local player/friend boards → committed synthetic floor.
  const remote = candidates.filter((s) => s.remote);
  const real = candidates.filter((s) => s.origin === 'self' || s.origin === 'friend');
  const tier = remote.length ? remote : real.length ? real : candidates;
  // 4) Fully random within the chosen tier (uniform — no similar-power bias).
  return tier[rng.int(tier.length)] ?? null;
}

/** A fresh, mutation-safe clone of a snapshot's board for handing to `simulate` (protects the static pool). */
export function opponentBoard(snap: BoardSnapshot): BoardMinion[] {
  const board: BoardMinion[] = snap.minions.map((m) => ({
    cardId: m.cardId,
    attack: m.attack,
    health: m.health,
    keywords: [...(m.keywords ?? [])],
    ...(m.golden ? { golden: true } : {}),
    ...(m.addedTribes && m.addedTribes.length ? { addedTribes: [...m.addedTribes] } : {}), // Anomaly Reactor: spell-added tribe → combat tribe2
    ...(m.bloodlust ? { bloodlust: true } : {}), // Bloodlust: pending Start-of-Combat immune strike
    ...(m.summonBonus ? { summonBonus: m.summonBonus } : {}),
    // Per-minion accruals the snapshot persisted (see `cleanBoard`): carry them ALL so a served board is as
    // strong AND reads as accurately as the board it was captured from. `instantiate` seeds each into the
    // combat Minion, and the combat snapshot re-emits them, so the enemy card shows the OPPONENT's real value
    // (a served Sergeant's improved HP-grant, Tara's ascend progress) — not the printed base. Dropping these
    // (the old bug) made every served enemy read its base rule text + fight weaker than the real board.
    ...(m.hpGrantBonus ? { hpGrantBonus: m.hpGrantBonus } : {}), // Sergeant: improved Deathrattle HP grant
    ...(m.ascendProgress ? { ascendProgress: m.ascendProgress } : {}), // Tara: ascend progress toward Taragosa
    ...(m.spellProgress ? { spellProgress: m.spellProgress } : {}), // Archmagus Guel: on-board spell tally
    ...(m.overflowBonus ? { overflowBonus: m.overflowBonus } : {}), // Flowing Monk: flat triple-combine grant bonus
    ...(m.rallyMechAtk ? { rallyMechAtk: m.rallyMechAtk } : {}), // Better Bot Rally welded onto a host Mech
    ...(m.rallySpellWeld ? { rallySpellWeld: m.rallySpellWeld } : {}), // Perfect Core Rally welded onto a host
    // Per-instance COMBAT state — must be restored or the served board fights differently than it was captured:
    ...(m.copiedEcho?.length ? { copiedEcho: m.copiedEcho.map((e) => ({ ...e, ...(e.params ? { params: { ...e.params } } : {}) })) } : {}), // Gravetwin: copied Echo procs on combat death
    ...(m.bloodbinderMode ? { bloodbinderMode: m.bloodbinderMode } : {}), // Bloodbinder: this fight's Rally stat (atk/hp)
    ...(m.bloodlustRally ? { bloodlustRally: true as const } : {}), // Bloodlust weld: on-attack Rally
    ...(m.universalTribe ? { universalTribe: true as const } : {}), // Anomaly Reactor "All": every tribe in combat
    // Display-only accruals (no combat behavior) — carried so the served enemy's live card text reads its real
    // per-tick / cadence / sell value, not the printed base:
    ...(m.eotBonus ? { eotBonus: m.eotBonus } : {}), // Ritualist: accrued End-of-Turn grant
    ...(m.sellBonus ? { sellBonus: m.sellBonus } : {}), // Trail Forager: accrued sell value
    ...(m.eotTick ? { eotTick: m.eotTick } : {}), // Frontdrake / Money Maker / Vineweaver: cadence counter
    ...(m.buffs && m.buffs.length ? { buffs: m.buffs.map((b) => ({ ...b })) } : {}), // recruit-buff breakdown for inspect
  }));
  // Enemy hero power — Soren's Reclaim: a board captured from a Soren run arms it, so ONE enemy minion is
  // destroyed at Start of Combat (its Deathrattle fires) and an exact copy is resummoned when there's room. The
  // capture doesn't record which minion the player marked, so pick the best deterministic target: the
  // highest-stat minion that HAS a Deathrattle (the only kind worth reclaiming — a vanilla minion would just be
  // a tempo loss). Ties break to the earliest slot; if no minion has a Deathrattle, mark nothing.
  if (snap.heroId === 'soren') {
    let best = -1, bestScore = -1;
    for (let i = 0; i < board.length; i++) {
      if (!CARD_INDEX[board[i]!.cardId]?.effects.some((e) => e.on === 'onDeath')) continue;
      const score = board[i]!.attack + board[i]!.health;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best >= 0) board[best]!.resummon = true;
  }
  return board;
}

/** A snapshot is servable only if EVERY minion's cardId still exists in the current build. A board captured
 *  by an older version can reference a card a later patch removed/renamed (e.g. Corrupted Lifebinder); serving
 *  it would throw `Unknown card` in `instantiate` and hard-lock combat (the End-Turn freeze). Drop such boards
 *  at the door so the pool only ever holds boards this build can actually fight. */
export function isServableBoard(snap: BoardSnapshot): boolean {
  return snap.minions.every((m) => CARD_INDEX[m.cardId] !== undefined);
}

/**
 * Append boards to the served pool. The app calls this ONCE at startup (with the deterministic bootstrap
 * pool), and step 3's library will grow it in batches. Keep it static for a session — inject before any run
 * faces combat and don't mutate mid-run, or replays stop being byte-identical.
 *
 * Stale boards (referencing a card this build no longer has) are filtered out here — they'd otherwise crash
 * combat when served. Both sources (bootstrap pool + persisted player boards) route through this, so neither
 * can poison the pool with an unfightable board.
 */
export function registerOpponents(snaps: BoardSnapshot[]): void {
  OPPONENT_POOL.push(...snaps.filter(isServableBoard));
}
